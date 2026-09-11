# Sync — Reliability and Operations Standard

Status: v1 draft, 9 September 2026. Owner: Salekh. Review cadence: monthly until 100 sellers, then quarterly.

This document is the bar. The core promise is "a sale anywhere updates everywhere in seconds and you never oversell". Every number below is either a **target we chose** (marked *target*) or a **limit a vendor imposes** (marked *vendor*). When they conflict, the vendor limit wins and the target moves.

Stack assumed: Next.js App Router on Vercel, Supabase Postgres with PITR, Inngest for jobs, webhooks, retries, throttling and cron, Stripe, Resend, PostHog.

---

## 1. Service level objectives

| SLO | Target | Measured how | Window |
|---|---|---|---|
| Sync propagation latency, p50 | ≤ 5 s *target* | `ledger_events.received_at` to the last `push_jobs.completed_at` for the same event | 7 days rolling |
| Sync propagation latency, p95 | ≤ 30 s *target* | same | 7 days rolling |
| Sync propagation latency, p99 | ≤ 120 s *target* (allows one retry with backoff) | same | 7 days rolling |
| Push success rate | ≥ 99.5% *target* | `push_jobs` in state `succeeded` ÷ all terminal jobs, excluding jobs failed because the seller revoked the token | 30 days rolling |
| Oversell incidents | 0 *target*, hard alert on any | `oversell_flags` rows where second sale was accepted by a channel after ledger quantity hit 0 | per incident |
| Webhook acknowledgement latency | p99 ≤ 200 ms *target* | Vercel function duration for `/api/webhooks/*` routes | 24 h |
| Webhook loss | 0 unacked after 3 vendor retries *target* | reconciliation finds an order the ledger never saw | per incident |
| App availability (dashboard, catalog, sync page) | 99.9% monthly *target* (43 min/month) | external uptime probe every 60 s on `/api/health` and the sign-in page | calendar month |
| Reconciliation freshness | every channel account polled within 2× its interval | `channel_accounts.last_reconciled_at` | continuous |

Latency clock starts when our webhook handler receives the request, not when the buyer paid. Marketplace-side delay (eBay notifications are often 10 to 90 s behind the sale) is reported separately as `channel_lag` so we know what we own.

**Error budgets.** Propagation p95 has a budget of 5% of events per week above 30 s. Push success has 0.5% of jobs per month. When a budget is more than half burned in the first half of its window, feature work stops and the week goes to the connector that is burning it. When a budget is fully burned, no deploys touching that connector until a post-mortem is written. Oversell has no budget: one incident is a Sev 1 and a post-mortem.

---

## 2. The stock ledger as the persistence core

Nothing writes quantity except the ledger. Marketplaces, the UI, imports and the analyst all produce **ledger events**; quantity is a projection of them.

### Tables

```
ledger_events
  id                bigserial PK            -- global order
  workspace_id      uuid not null
  sku_id            uuid not null
  seq               bigint generated always as identity -- global monotonic sequence; per-SKU order follows from the row lock
  type              text not null           -- sale | cancellation | return | restock | manual_adjust | import | sync_failure | oversell_flag
  delta             integer not null        -- signed quantity change; 0 for informational
  source_channel_account_id uuid null
  idempotency_key   text not null           -- see below
  external_ref      jsonb                   -- order id, line id, event id, raw ids for audit
  received_at       timestamptz not null default now()
  occurred_at       timestamptz not null    -- marketplace timestamp if given, else received_at
  actor             text not null           -- 'webhook:ebay' | 'user:<id>' | 'reconcile:tiktok' | 'import'
  UNIQUE (workspace_id, idempotency_key)
  UNIQUE (sku_id, seq)

sku_stock  (projection, one row per SKU)
  sku_id            uuid PK
  quantity          integer not null
  last_seq          bigint not null
  updated_at        timestamptz not null

push_jobs  (outbox)
  id, workspace_id, channel_account_id, sku_id, ledger_event_id,
  kind              text   -- set_quantity | delist | set_price | publish
  target_quantity   integer
  sku_seq           bigint -- the ledger seq this job represents
  state             text   -- pending | running | succeeded | failed_retryable | failed_terminal | superseded
  attempts, next_attempt_at, last_error, created_at, completed_at
```

The table is **append only**: no UPDATE or DELETE grants on `ledger_events` for the application role. Corrections are new events with `type = manual_adjust` and a reason.

### Idempotency keys

| Source | Key |
|---|---|
| Marketplace order line | `{channel}:{channel_account_id}:order:{order_id}:line:{line_id}:{status}` |
| Marketplace notification with its own id | `{channel}:notif:{notification_id}` as a second dedupe row in `webhook_receipts`, not the ledger key. The ledger key is always derived from the business object so two different notifications about the same line collapse. |
| Cancellation / return | same as the line, with status `cancelled` or `returned` |
| Manual adjust | `user:{user_id}:{client_generated_uuid}` |
| Import | `import:{import_id}:{external_listing_id}` |
| Reconciliation | `reconcile:{channel_account_id}:{external_order_id}:{line_id}:{status}` — identical shape to the webhook key on purpose, so whichever arrives first wins and the other is a no-op |

### Exactly-once effect under at-least-once delivery

Every marketplace retries webhooks; Inngest retries steps. The rule that makes this safe: **inserting a ledger event is the only side effect that matters, and it is guarded by a unique index.** The insert, the per-SKU `seq` assignment, the `sku_stock` update and the `push_jobs` outbox rows happen in **one Postgres transaction**:

1. `SELECT ... FROM sku_stock WHERE sku_id = $1 FOR UPDATE` (serialises per SKU)
2. `INSERT INTO ledger_events ... ON CONFLICT (workspace_id, idempotency_key) DO NOTHING RETURNING id, seq`
3. If nothing returned: commit and stop. The event was already applied.
4. `UPDATE sku_stock SET quantity = quantity + delta, last_seq = seq`
5. If `on_hand` would go below 0: still insert the sale (it happened), let the projection go negative so the seller sees exactly how many buyers are owed, clamp `desired_quantity` on every channel to 0, and insert an `incidents` row of kind `oversell` in the same transaction.
6. `INSERT INTO push_jobs` one row per **other** connected channel account for that SKU with `target_quantity = new quantity` and `sku_seq = seq`. For a unique item (quantity 1 → 0) the job kind is `delist`.
7. Commit. Then, and only then, `inngest.send("push.requested", { job_ids })`.

If the process dies between commit and the send, an Inngest cron every 60 s picks up `push_jobs` with `state = pending` and `created_at < now() - 60s` and sends them. This is the outbox pattern: the job row is the durable intent, the event is a hint.

### Projection and cache

`sku_stock` is the source for every read. It is recomputable: `SELECT sku_id, SUM(delta) FROM ledger_events GROUP BY sku_id` must equal `sku_stock.quantity` for every SKU; a nightly job checks this and alerts on any mismatch (Sev 2). No Redis in v1; Postgres row reads by primary key at our volume are under 2 ms. If a cache is added later it is a read-through cache invalidated by `last_seq`, never a write path.

---

## 3. Outbound push queue on Inngest

**One Inngest function per channel**: `push.ebay`, `push.amazon`, `push.tiktok`, `push.depop`, `push.etsy`, `push.onbuy`, `push.vinted`. A router function fans `push.requested` out by channel. Connectors are isolated: a TikTok outage cannot block eBay pushes because they are different functions with different concurrency pools.

### Concurrency and throttle keys

| Channel | Concurrency key | Concurrency limit | Throttle (Inngest `throttle`) | Basis |
|---|---|---|---|---|
| eBay | `channel_account_id` | 2 | 20 per 10 s per account | *target*; Inventory API allows 2M/day per app *vendor* |
| Amazon | `channel_account_id` | 1 | 4 per second per account, burst 5 | Listings 5/s burst 5 *vendor* |
| TikTok | `channel_account_id` | 1 | 1 per second per shop | "standard write 1–3 rps" *vendor guidance*; adaptive on 429 |
| Depop | `channel_account_id` | 2 | 10 per second | 20/s create *vendor*; we use half |
| Etsy | `app` (global) | 2 | 8 per second global, 8,000 per day global | 10/s and 10k/day per key *vendor*; 20% headroom for reconciliation |
| OnBuy | `channel_account_id` | 1 | 200 writes per hour | 240/h *vendor* |
| Vinted | `channel_account_id` | 1 | 2 per second | unspecified *vendor*; conservative |

Etsy is the only channel where the limit is per **app** not per seller. At 50 Etsy shops, 8,000 calls a day is 160 per shop per day. Reconciliation on Etsy therefore runs every 30 minutes not every 5, and we apply for a limit raise at 20 connected shops.

### Retry policy

Inngest step retries: **6 attempts**, backoff `min(2^attempt × 2 s, 300 s)` plus jitter of ±30%. So roughly 2 s, 4 s, 8 s, 16 s, 32 s, 64 s → 5 min cap. Total worst case ≈ 7 minutes before terminal failure.

| Response | Classification | Action |
|---|---|---|
| 2xx | success | mark `succeeded` |
| 429 | retryable | honour `Retry-After` if present, else backoff; increment `rate_limit_hits` metric |
| 5xx, timeout, connection reset | retryable | backoff |
| 401 / 403 token invalid | terminal, account-level | mark job `failed_terminal`, set `channel_accounts.status = needs_reauth`, pause all jobs for that account, notify seller |
| 400 / 404 listing not found | terminal, listing-level | mark `failed_terminal`, set `channel_listings.status = orphaned`, surface on sync page |
| 409 / version conflict | retryable once after re-read | re-fetch listing, re-apply |

**Dead letter**: terminal failures stay in `push_jobs` with `state = failed_terminal`. A daily digest to the founder lists them grouped by error class. Nothing is silently dropped.

### Ordering per SKU per channel

Two jobs for the same SKU and channel can be in flight if a SKU sells twice in a second. Rule: **never apply an older quantity after a newer one.**

- Before calling the channel, the job re-reads `sku_stock.last_seq`. If `last_seq > job.sku_seq`, a newer job exists: mark this one `superseded` and stop. The newer job carries the correct final quantity.
- After a successful call, `UPDATE channel_listings SET applied_ledger_seq = $seq WHERE id = $id AND applied_ledger_seq < $seq`. If zero rows updated, a newer push already landed; log and move on. The channel now has the newer value, which is correct.
- Concurrency limit 1 or 2 per account makes this a rare path, not the common one.

### Coalescing

A viral TikTok item selling 200 units in a minute produces 200 ledger events and would produce 200 × (channels − 1) push jobs. The outbox insert coalesces: when inserting a `set_quantity` job, if a `pending` job for the same `(channel_account_id, sku_id)` exists, update its `target_quantity` and `sku_seq` instead of inserting. Jobs already `running` are not touched (the ordering rule above handles them). Net effect: at most one pending job per SKU per channel at any moment.

### What the seller sees

| Job state | Sync page |
|---|---|
| pending | "Queued" with channel icon, grey |
| running | "Updating eBay…" with spinner |
| succeeded | "eBay updated 3 s ago", green, with the quantity pushed |
| failed_retryable | "Retrying eBay (attempt 3 of 6)", amber |
| failed_terminal | "eBay update failed: listing not found. Fix →", red, with a one-click retry and the raw error |
| superseded | not shown individually; the newer job is |

Each row links to the ledger event that caused it. A seller can always answer "why is my eBay quantity 3?" from the sync page alone.

---

## 4. Webhook ingress

One route per channel: `/api/webhooks/ebay`, `/api/webhooks/tiktok`, etc. Every route does exactly four things, in order, and returns in under 200 ms *target*:

1. **Read raw body** (needed for signature verification; Next.js must not parse it first).
2. **Insert into `webhook_receipts`** `(channel, external_id, signature, headers, body, received_at)` with `UNIQUE (channel, external_id)`. On conflict, return 200 immediately: this is a vendor retry we already have.
3. **Send one Inngest event** `webhook.received` with the receipt id.
4. **Return 200** (eBay account deletion accepts 200/201/202/204; TikTok and Depop want 200).

Nothing else. No signature verification, no business logic, no channel API calls in the request path. If Postgres is down the route returns 503 and the vendor retries, which is what we want.

**Verification happens in the Inngest function**, not the route, so a bad signature never delays the ack and a spike of forged requests only burns cheap inserts. Verification uses the channel's method: eBay `X-EBAY-SIGNATURE` with cached public key (1 hour TTL), TikTok HMAC of app secret, Depop `X-Depop-Signature`, Etsy signing secret, Vinted `X-Vpi-Webhook-Hmac-Sha256` over `timestamp.body` with 5-minute replay window. Failed verification: mark receipt `rejected`, count it, never process.

**Bursts.**

- eBay account deletion can send up to ~1,500 notifications a day *vendor*. Each is one insert and one Inngest event. Processing (delete user data) is a separate function with concurrency 5. Deletion must complete within the retention promise, not within seconds.
- A viral TikTok item: 500 orders in 5 minutes = ~2 webhooks/s. Vercel handles this trivially. The ledger transaction per event is ~5 ms with the per-SKU row lock, so 500 events serialise in ~3 s. The outbox coalescing means other channels receive a handful of pushes, not 500.
- `webhook_receipts` is partitioned by month and rows older than 90 days are dropped (body retained in the ledger's `external_ref` where it matters).

The eBay marketplace account deletion challenge (`GET ?challenge_code=`) lives on the same route and is the one piece of logic in the request path: SHA-256 of `challengeCode + verificationToken + endpointURL`, returned as JSON.

---

## 5. Reconciliation

Webhooks are best effort on every channel (eBay, TikTok and Depop say so in their docs). Reconciliation is the safety net and runs as Inngest cron per channel account.

| Channel | Orders poll | Listings/stock poll | Basis |
|---|---|---|---|
| eBay | every 5 min, `getOrders` filtered by `lastmodifieddate > last_reconciled_at − 10 min` | every 6 h, inventory items and offers | Fulfillment 100k/day *vendor* is ample |
| Amazon | every 5 min via `getOrders` `LastUpdatedAfter` | every 6 h via `getInventorySummaries` (FBA) and listings report | getOrders 1/min *vendor* → 5 min is safe |
| TikTok | every 5 min, order search by update time | every 6 h, inventory search | dynamic QPS *vendor* |
| Depop | every 10 min | every 6 h | |
| Etsy | every 30 min | every 12 h | 10k/day per app *vendor* |
| OnBuy | every 10 min | every 12 h | 600 GET/h per seller *vendor* |
| Vinted | every 10 min | every 6 h | |

**Drift detection.** After the listings poll, for each `channel_listing`: `channel_quantity != sku_stock.quantity` and `applied_ledger_seq == sku_stock.last_seq` (no push in flight) is drift.

**Self-healing rules.**

- Channel shows **more** than the ledger (the dangerous direction): push the ledger value immediately, priority high, and write a drift correction line to the activity log. The ledger itself is untouched because no quantity changed. This is the oversell precursor.
- Channel shows **less** than the ledger and the seller edited it on the marketplace (channel's `updated_at` is newer than our last push): treat the marketplace as a manual adjustment, write a `manual_adjust` ledger event with actor `reconcile:{channel}`, and fan out. Sellers do edit on the marketplace; fighting them is worse than following.
- Channel shows less and we did not push and it was not edited: push ours, log the correction.
- Order found by poll that the ledger never saw: apply it normally (the idempotency key matches what the webhook would have used) and increment `webhook_missed{channel}`. Three misses in an hour for one channel → Sev 2 alert.
- Drift on more than 5% of a seller's listings on one channel → stop self-healing for that account, alert Sev 2, show a banner on the sync page. Something structural is wrong (wrong account connected, migration side effect) and mass-correcting could make it worse.

---

## 6. Rate limit governance

Two layers.

**Layer 1: Inngest throttle and concurrency** (section 3) enforce per-account and per-app ceilings mechanically.

**Layer 2: a `rate_budgets` table** for daily quotas that Inngest throttle windows cannot express (eBay Trading 5,000/day per app *vendor*, Etsy 10,000/day per app *vendor*, OnBuy 12,000 GET/day per seller *vendor*). Row per `(scope, window_start)` with `used` incremented in the same transaction as the job marking `running`. A job that would exceed 90% of a daily budget is deferred to `window_start + 1 day` unless it is priority `critical`.

**Priority classes.**

| Priority | Examples | Behaviour |
|---|---|---|
| critical | delist after sale of a unique item, quantity set to 0, drift correction in the oversell direction | separate Inngest function with its own concurrency pool so it is never queued behind bulk work; may spend the last 10% of a daily budget |
| normal | quantity decrement N→N−1, price change, order poll | standard queue |
| bulk | initial import, listing publish, photo upload, taxonomy refresh | separate function, concurrency 1 per account, throttled to 25% of the account's rate, pauses entirely if any critical job for that account has waited more than 10 s |

**Bulk import of 2,000 listings.** Chunked into pages of 100 (eBay) or 20 (Amazon catalog lookups are 2/s *vendor*). Each chunk is one Inngest step so progress survives a restart. The import function checks `push_jobs` for the same account before every chunk and yields if critical work is waiting. At eBay's rate that is ~2,000 listings in 4 to 6 minutes; at Amazon ~17 minutes. The seller sees a progress bar with the count and can navigate away. Photos are fetched lazily after listings, at bulk priority, so the margin table can appear before photos finish.

---

## 7. Persistence and backup

| Item | Setting | Basis |
|---|---|---|
| Supabase plan | Pro from day one (PITR is not on Free) | *vendor* |
| PITR | enabled, 7 days retention at launch, 14 days at 100 sellers | *target* |
| Logical backup | nightly `pg_dump` via a GitHub Actions cron to Cloudflare R2 in a separate account, encrypted with age, 90 days retention | *target*; second provider so a Supabase account problem is not a data loss |
| Photos | Supabase Storage; nightly rclone sync to the same R2 bucket | *target* |
| Restore drill | quarterly: restore last night's dump to a scratch Supabase project, run the ledger-vs-projection check, run the smoke tests, record time to restore. Target under 60 minutes. | *target* |
| Secrets | Vercel env + Supabase Vault for channel tokens; tokens encrypted at rest with a key not stored in the database | *target*; Amazon DPP requires encryption at rest *vendor* |

**Migration policy: expand and contract.** Never a destructive change in one deploy.

1. Expand: add the new column/table, nullable or defaulted. Deploy code that writes both old and new.
2. Backfill in batches of 5,000 rows, rate limited, resumable.
3. Switch reads to the new shape. Deploy.
4. Contract: drop the old column in a later release, at least 7 days after step 3, after confirming no reads in logs.

Migrations run in CI against a branch database (Supabase branching) before production. `ledger_events` is never altered destructively; a schema change there is a new table plus a copy.

**Data volume estimates.**

| Sellers | Listings | Ledger events/month | Webhook receipts/month | Photos | Database size | Storage |
|---|---|---|---|---|---|---|
| 10 | 5,000 | ~15,000 | ~30,000 | 25,000 (~15 GB at 5 variants) | < 1 GB | 15 GB |
| 100 | 50,000 | ~150,000 | ~300,000 | 250,000 (~150 GB) | ~5 GB | 150 GB |
| 1,000 | 500,000 | ~1.5 M | ~3 M | 2.5 M (~1.5 TB) | ~50 GB | 1.5 TB |

Assumes 500 listings average, 3 sales per listing per year, 2 webhooks per sale, 5 photos per listing at ~600 KB across variants. Photo storage, not the database, is the cost driver at scale; see section 11.

---

## 8. Performance budgets

| Page | Budget | Mechanism |
|---|---|---|
| Catalog list, 2,000 listings | LCP ≤ 1.5 s, first 50 rows server-rendered | keyset pagination on `(updated_at desc, id desc)`, never OFFSET; 50 per page; column projection, no photo blobs in the list query |
| Sync page | LCP ≤ 1.5 s, live updates within 2 s | server-render last 100 jobs; Supabase Realtime on `push_jobs` filtered by workspace |
| Margin table, 2,000 SKUs × 4 channels | ≤ 2 s | materialised `sku_channel_margins` refreshed on fee schedule change and on sale; never computed per request |
| Product edit | save ≤ 300 ms p95 | single transaction, push jobs enqueued after commit |
| API routes (non-webhook) | p95 ≤ 500 ms | measured in Vercel |

**Indexes that must exist** (migration fails a CI check if any is missing):

```
ledger_events (sku_id, seq)                       unique
ledger_events (workspace_id, idempotency_key)     unique
ledger_events (workspace_id, received_at desc)
push_jobs (state, next_attempt_at)                partial where state in ('pending','failed_retryable')
push_jobs (channel_account_id, sku_id)            partial where state = 'pending'   -- coalescing lookup
push_jobs (workspace_id, created_at desc)
channel_listings (channel_account_id, external_listing_id) unique
channel_listings (sku_id)
webhook_receipts (channel, external_id)           unique
skus (workspace_id, sku_code)                     unique
products (workspace_id, updated_at desc, id desc)
```

**N+1 prohibition.** Every list endpoint is covered by a test that asserts query count ≤ 3 using a pg query counter. Relations are loaded with joins or `IN` batches, never per row. Server components fetch once at the top of the tree.

**Photo pipeline.** Upload goes straight to Supabase Storage via signed URL (never through a Vercel function; 4.5 MB body limit *vendor* and it wastes compute). An Inngest function generates variants on upload: original (kept), 1600 px (eBay and Amazon max 1600 long side is comfortable), 1200 px (TikTok), 800 px (Vinted, Depop), 400 px thumbnail for our UI. WebP for our UI, JPEG for channels that require it. Served through Supabase's CDN with `Cache-Control: public, max-age=31536000, immutable` and content-hashed paths. Channel pushes reference the variant URL; some channels (TikTok, Amazon) require us to upload the bytes to them, which happens in the bulk-priority function.

---

## 9. Observability

**Logs.** JSON, one line per event, via a thin logger. Mandatory fields on every line: `ts, level, msg, workspace_id, channel_account_id (nullable), channel, request_id, inngest_run_id (nullable), sku_id (nullable)`. Secrets and tokens are redacted by a serialiser allowlist, not a denylist. Vercel logs drained to Axiom (free tier to 500 GB/month is enough past 100 sellers).

**Metrics** (PostHog for product, Axiom queries for ops; no Prometheus in v1):

| Metric | Labels | Alert |
|---|---|---|
| `push.completed` count | channel, state | success rate < 99.5% over 1 h → Sev 2 |
| `push.latency_ms` histogram | channel | p95 > 30 s over 15 min → Sev 3, > 120 s → Sev 2 |
| `push.rate_limited` count | channel | > 50 in 10 min → Sev 3 |
| `webhook.received` / `webhook.rejected` | channel | rejected > 10% of received in 10 min → Sev 2 (signature or config problem) |
| `webhook.missed` (found by reconcile) | channel | ≥ 3 in 1 h → Sev 2 |
| `oversell.flagged` | channel | any → Sev 1 |
| `ledger.projection_mismatch` | — | any → Sev 2 |
| `queue.backlog` pending jobs older than 60 s | channel | > 100 → Sev 2, > 1,000 → Sev 1 |
| `channel_account.needs_reauth` | channel | informational, seller notified; > 5 accounts in 1 h on one channel → Sev 2 (probably our bug) |
| `stripe.webhook_failed` | — | any → Sev 2 |
| `db.pool_wait_ms` | — | p95 > 100 ms → Sev 2 |

**Tracing one sale end to end.** The `request_id` from the webhook route becomes the Inngest event id, which is stamped onto the ledger event and every push job it spawns. Searching one id in Axiom shows: webhook received → verified → ledger applied (with seq) → N push jobs → each channel call and response → sync page update. This is the trace and it must work before launch.

**Dashboards.** One ops dashboard: propagation p50/p95 by channel, push success by channel, queue backlog, webhook rejected rate, oversell count (should read 0 in large type), reconciliation freshness per channel. One per-seller view is the sync page itself.

**Severity and paging for a solo founder.** Alert fatigue kills on-call. Rules:

| Severity | Meaning | Delivery | Example |
|---|---|---|---|
| Sev 1 | Sellers are overselling now, or nothing is syncing | Phone call via Better Uptime / PagerDuty free tier, repeats until acked, any hour | oversell flagged, queue backlog > 1,000, app down > 3 min |
| Sev 2 | Degraded, will hurt within hours | Push notification, 08:00 to 23:00; batched to 08:00 outside | push success < 99.5%, webhook missed, projection mismatch |
| Sev 3 | Worth knowing today | Daily digest email at 08:00 | rate limit hits, p95 creeping, terminal failures list |

A Sev 1 that fires more than twice in a week with the same cause is downgraded to Sev 2 with a ticket to fix the root cause. Alerts that never fire in 90 days are reviewed for deletion.

---

## 10. Incidents and on-call for a solo founder

**Severity matrix**

| | Sev 1 | Sev 2 | Sev 3 |
|---|---|---|---|
| Response | 15 min, any hour | 2 h in waking hours | next working day |
| Seller comms | banner on sync page within 15 min, email within 1 h | banner if account-specific | none |
| Post-mortem | always, within 48 h | if repeated | no |

**Runbooks**

1. **Channel token revoked** (401/403 on push, or `AUTHORIZATION_REVOCATION` / `SELLER_DEAUTHORIZATION` webhook). Automatic: pause the account's jobs, set `needs_reauth`, email the seller a one-click reconnect link, show a red banner on their sync page. Manual: if more than 5 accounts on one channel in an hour, it is our client secret (Amazon rotates every 180 days *vendor*) or a scope change. Check secret expiry first.
2. **Channel API down** (5xx or timeouts > 50% for 5 min). Automatic: retries absorb up to 7 min. Manual: set `channel_status = degraded` in the admin panel, which raises retry cap to 20 attempts over 2 h and shows "eBay is having problems, we will retry automatically" on every affected sync page. Check the vendor status page and link it. When recovered, run an immediate reconciliation for every account on that channel.
3. **Webhook signature mismatch spike.** Check whether the vendor rotated keys (eBay public key cache: flush it). Check whether a deploy changed body parsing (raw body must be intact). If neither, it may be a probe; rejected receipts are harmless. Never disable verification.
4. **Queue backlog.** Look at which channel and which function. Rate limited → nothing to do but wait, communicate. Inngest incident → check their status; jobs are durable in `push_jobs` and the 60 s outbox sweeper will replay when they recover. Our bug throwing on every job → roll back (below), then replay with `state = pending` reset.
5. **Oversell detected.** Sev 1. Within 15 min: identify the second order (the one accepted after quantity hit 0), tell the seller in-app and by email with both order ids and a suggested message to the buyer, and offer a one-click cancel via the channel's API where supported. Then find why: was the delist job late (latency), failed (error), or never created (bug)? Post-mortem always.
6. **Stripe webhook failure.** Stripe retries for 3 days *vendor*. Check the signing secret and the endpoint. Subscription state is also re-read from Stripe on every sign-in as a fallback, so a seller is never locked out by a missed webhook. Do not manually edit subscription rows; replay the event from the Stripe dashboard.
7. **Supabase connection exhaustion** (`db.pool_wait_ms` spike, "too many connections"). All access goes through the Supavisor pooler in transaction mode, so this usually means a long transaction holding a per-SKU lock or a runaway import. Find with `pg_stat_activity` ordered by `xact_start`; terminate the offender; the job retries. Prevent: statement timeout 10 s on the app role, 60 s on the job role.
8. **Vercel deploy regression.** Every deploy is a preview first with smoke tests (sign in, load catalog, load sync page, post a fake webhook to a test workspace, assert a push job appears). Production promotion is manual. On regression: Vercel instant rollback to the previous deployment (under 1 min), then decide whether the database migration needs reverting (it should not, by the expand/contract policy).

**Rollback procedure.** Code: Vercel → Deployments → previous → Promote. Jobs: Inngest functions are versioned with the deploy; in-flight steps complete on the old code. Database: never roll back a migration in production; roll forward with a fix. If the expand step itself broke reads, the previous code still works because it ignores the new column.

**Status communication.** The sync page is the status page. A `system_notices` table drives banners: global (all sellers), per channel, or per account, each with severity, message and a link. The founder posts from the admin panel; no separate status site in v1. Sellers get an email only for Sev 1 and for account-specific problems they need to act on.

---

## 11. Capacity and cost model

Rough monthly, GBP, September 2026 list prices, excluding VAT. Marked *estimate*.

| Component | 10 sellers | 100 sellers | 1,000 sellers |
|---|---|---|---|
| Inngest runs (each push job ≈ 3 steps, each reconcile ≈ 5 steps) | ~150k steps → free tier | ~1.5M steps → Pro ~£60 | ~15M steps → ~£400 |
| Supabase | Pro £20 + compute Small £0 | Pro + Medium compute ~£75, 8 GB DB | Pro + Large/XL ~£250, 50 GB DB, read replica ~£200 |
| Supabase Storage / CDN | 15 GB ~£0 (100 GB included) | 150 GB ~£3 + egress ~£20 | 1.5 TB ~£30 + egress ~£200; consider R2 as primary at this point |
| Vercel | Pro £16 | Pro £16 + ~£20 usage | Pro ~£150 usage, or Enterprise conversation |
| Axiom logs | free | free–£20 | ~£80 |
| Resend | free | £16 | ~£70 |
| PostHog | free | free | ~£50 |
| Better Uptime / paging | free | free | £20 |
| R2 backups | £1 | £5 | £40 |
| **Total** | **~£40** | **~£300** | **~£1,500** |

Revenue at £50/seller: £500, £5,000, £50,000. Infrastructure stays under 6% of revenue at every tier; the binding constraint is founder time, not compute. The first architectural change forced by scale is photo storage egress around 500 sellers.

---

## 12. Pre-launch reliability checklist

Every item is checked before the first founding customer connects a live account.

**Ledger**
- [ ] `ledger_events` has no UPDATE/DELETE grant for the app role; test proves an update throws
- [ ] Duplicate webhook test: same eBay order line delivered 5 times → exactly one ledger event, one push job per other channel
- [ ] Unique item sold on A → delist jobs for B and C created in the same transaction
- [ ] Stocked item sold on A and B within 100 ms → both events applied, final quantity correct, one coalesced push per other channel
- [ ] Sale when quantity already 0 → event applied, `oversell_flag` created, Sev 1 alert fires in staging
- [ ] Nightly projection check passes on a seeded database with 10,000 events

**Queue**
- [ ] Older job cannot overwrite newer quantity (superseded path tested with forced delay)
- [ ] 429 with `Retry-After` is honoured, measured
- [ ] Token revoked → account paused, seller emailed, sync page banner, no further calls to that channel
- [ ] Outbox sweeper replays a job whose Inngest send was killed
- [ ] Bulk import of 2,000 sandbox listings completes and a critical delist issued mid-import lands within 10 s

**Ingress**
- [ ] All webhook routes p99 < 200 ms under 20 req/s synthetic load
- [ ] eBay challenge response verified with eBay's test notification button
- [ ] Signature rejection for every channel tested with a tampered body
- [ ] Raw body preserved through Next.js route handler (test with a body containing unicode and trailing whitespace)

**Reconciliation**
- [ ] Delete a webhook receipt manually; reconcile finds the order within one interval and `webhook.missed` increments
- [ ] Drift in the oversell direction corrected within one interval
- [ ] Seller-side edit on the marketplace propagates as `manual_adjust`

**Persistence**
- [ ] PITR enabled and verified in Supabase dashboard
- [ ] Nightly dump to R2 ran 3 nights in a row; restore drill completed once, time recorded
- [ ] Channel tokens confirmed encrypted at rest; a database dump does not contain a plaintext token
- [ ] Statement timeouts set on both roles

**Observability**
- [ ] One sale traced end to end by a single id in Axiom, screenshot in this repo
- [ ] Every Sev 1 alert has fired at least once in staging and reached the phone
- [ ] Ops dashboard shows all seven channels with live data from sandbox accounts
- [ ] Log redaction test: a token passed to the logger appears as `[redacted]`

**Operations**
- [ ] All 8 runbooks above tried once in staging
- [ ] Vercel rollback rehearsed, under 2 minutes
- [ ] `system_notices` banner posted and cleared from the admin panel
- [ ] Amazon DPP controls in place: MFA on Vercel, Supabase, GitHub, Stripe, Inngest; TLS 1.2+ only; incident contact for security@amazon.com in the runbook
- [ ] External uptime probe live on `/api/health`, which checks Postgres and Inngest reachability
