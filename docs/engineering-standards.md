# Sync Engineering Standards

These are the rules the Sync codebase follows from the first commit. They exist so that one founder and an AI pair can ship quickly for years without the repo rotting. Every rule here is a decision, not a suggestion. If a rule turns out to be wrong, change the document in the same PR that breaks it.

Stack, decided: Next.js App Router, TypeScript strict, Supabase (Postgres, Auth, Storage) with the Supabase CLI for local dev and migrations, Inngest for jobs and webhooks, Stripe Billing, Resend, PostHog, Vitest, Playwright, pnpm, GitHub Actions, Vercel.

Lint and format: **Biome**, one tool, one config, sub-second on the whole repo, and it replaces ESLint plus Prettier plus their plugin graph, which is exactly the maintenance surface a solo repo cannot afford.

---

## 1. Repository layout

One Next.js application. No workspace packages until a second deployable exists.

```
/
  app/                    Next.js routes, layouts, server actions, route handlers. Thin.
  src/
    domain/               Pure business logic. No I/O. No framework imports.
      catalog/            Product, SKU, variant rules
      ledger/             Stock ledger: events, reducer, invariants
      margin/             Fee schedules, net profit calculation
      analyst/            Rules that produce findings
    connectors/           One folder per channel, each implementing ChannelConnector
      ebay/
      amazon/
      tiktok/
      depop/
      _shared/            Normalised types, error taxonomy, test harness
    jobs/                 Inngest functions: webhook ingest, push queue, reconcilers, digests
    db/                   Typed queries and repositories. The only place SQL lives.
    lib/                  crypto, http client, logger, env, money, ids
  supabase/
    migrations/           Forward-only SQL migrations
    seed.sql              Local dev data
  docs/                   This file, ADRs, runbooks
  tests/
    unit/                 Mirrors src/domain
    contract/             Connector tests against recorded fixtures
    integration/          Against local Supabase
    e2e/                  Playwright
```

**The dependency rule.** Arrows point inward only.

```
app  ->  jobs  ->  db, connectors, domain
connectors  ->  domain types, lib
db  ->  domain types, lib
domain  ->  nothing except lib/money and lib/ids
```

`src/domain` imports nothing from `app`, `connectors`, `db`, `jobs`, Next.js, Supabase, or Inngest. This is enforced by a Biome `noRestrictedImports` rule and a unit test that walks the import graph. A PR that breaks the rule fails CI.

---

## 2. Domain purity and the hexagonal boundary

The stock ledger is the product. It is therefore the most tested code in the repo, and the way it earns that is by being pure.

A ledger is a list of events. The current state of a SKU is a fold over those events. Deciding what to do about a new event is a function from `(state, event)` to `(newState, effects)`. None of that needs a database.

```ts
// src/domain/ledger/reduce.ts
export function applyEvent(state: SkuState, event: LedgerEvent): SkuState

// src/domain/ledger/decide.ts
export function decide(state: SkuState, incoming: InboundEvent): Decision
// Decision = { accept: LedgerEvent[]; effects: Effect[]; rejected?: RejectReason }
// Effect = PushStock | Delist | RaiseOversellAlert
```

I/O lives at the edges. An Inngest job loads the SKU's events from `db`, calls `decide`, persists the accepted events in one transaction, then enqueues the effects. The job is ten lines of glue. The intelligence is in `domain`, where it can be tested with plain arrays in under a millisecond per case.

Consequences that follow from this:

- A connector never decides anything. It translates.
- A job never contains business rules. It sequences.
- If you are writing an `if` about quantities inside `jobs/` or `connectors/`, stop and move it to `domain/`.

---

## 3. Connector contract

Every channel implements one interface. The interface is the product's promise that adding a channel never changes the ledger.

```ts
// src/connectors/_shared/connector.ts
export interface ChannelConnector {
  readonly channel: Channel;                       // 'ebay' | 'amazon' | 'tiktok' | ...
  connect(input: ConnectInput): Promise<Result<ChannelAccountCredentials, ConnectorError>>;
  healthCheck(acct: ChannelAccount): Promise<Result<Health, ConnectorError>>;
  pushListing(acct: ChannelAccount, listing: NormalisedListing): Promise<Result<ExternalListingRef, ConnectorError>>;
  pushStock(acct: ChannelAccount, ref: ExternalListingRef, qty: number): Promise<Result<void, ConnectorError>>;
  pushPrice(acct: ChannelAccount, ref: ExternalListingRef, price: Money): Promise<Result<void, ConnectorError>>;
  delist(acct: ChannelAccount, ref: ExternalListingRef): Promise<Result<void, ConnectorError>>;
  pullOrders(acct: ChannelAccount, since: IsoDate): Promise<Result<NormalisedOrder[], ConnectorError>>;
  handleWebhook(raw: RawWebhook): Promise<Result<InboundEvent[], ConnectorError>>;
}
```

**Normalised types** live in `src/connectors/_shared/types.ts` and are the only vocabulary the rest of the system speaks: `NormalisedListing`, `NormalisedOrder`, `NormalisedOrderLine`, `InboundEvent` (`sale`, `cancellation`, `return`, `listing_ended`, `auth_revoked`), `ExternalListingRef` (`{ channelAccountId, externalId, externalSku? }`). A connector maps marketplace JSON into these and back. Marketplace-specific fields that the domain does not need go in an `extra: Record<string, unknown>` bag and stay there.

**Error taxonomy.** Every connector failure is one of four classes, and the push queue behaves differently for each.

| Class | Meaning | Queue behaviour |
|---|---|---|
| `RetryableError` | Network, 5xx, timeout | Exponential backoff, up to 8 attempts over about 6 hours |
| `RateLimitedError` | 429 or channel quota | Respect `retryAfter`, throttle the channel account key |
| `AuthRevokedError` | Token invalid, seller disconnected | Stop the account, mark it disconnected, notify the seller |
| `TerminalError` | Validation rejected, listing does not exist, category invalid | Fail the job, surface to seller with the channel's message |

```ts
export type ConnectorError =
  | { kind: 'retryable'; cause: unknown }
  | { kind: 'rate_limited'; retryAfterMs: number }
  | { kind: 'auth_revoked' }
  | { kind: 'terminal'; code: string; sellerMessage: string; cause?: unknown };
```

A connector that throws instead of returning a `ConnectorError` is a bug.

**The rule that matters most.** A connector never reads or writes the ledger, never touches `db`, and never calls another connector. `handleWebhook` returns `InboundEvent[]`. The job that called it hands those to the ledger. This is what keeps a broken TikTok API from ever corrupting eBay stock.

Every connector ships with a `fixtures/` folder of recorded sandbox responses and a `README.md` stating: auth model, rate limits, webhook topics used, known quirks, and the date the fixtures were recorded.

---

## 4. Types and validation

TypeScript `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`. `any` is banned by Biome. `as` casts need a comment explaining why the type system is wrong.

**Zod at every boundary.** Anything that enters the process from outside is parsed, never trusted:

- HTTP request bodies and search params in route handlers and server actions
- Webhook payloads, after signature verification
- Marketplace API responses, before they are mapped to normalised types
- Environment variables, at boot
- Inngest event payloads

```ts
const EbayOrderSchema = z.object({ orderId: z.string(), lineItems: z.array(LineItemSchema) /* ... */ });
const parsed = EbayOrderSchema.safeParse(json);
if (!parsed.success) return err({ kind: 'terminal', code: 'ebay.order.shape', sellerMessage: '...', cause: parsed.error });
```

**Database types are generated**, never hand-written: `pnpm db:types` runs `supabase gen types typescript` into `src/db/types.gen.ts`. CI fails if the generated file is stale.

**Branded ids.** Every id is a branded string so a `SkuId` cannot be passed where a `WorkspaceId` is expected.

```ts
type Brand<T, B extends string> = T & { readonly __brand: B };
export type WorkspaceId = Brand<string, 'WorkspaceId'>;
export type SkuId = Brand<string, 'SkuId'>;
export type ChannelAccountId = Brand<string, 'ChannelAccountId'>;
```

**Money** is `{ amountMinor: number; currency: 'GBP' | 'EUR' | 'USD' }`. Integers only. Arithmetic goes through `src/lib/money.ts`. A `number` representing pounds with a decimal point is a bug wherever it appears.

**Dates** are ISO 8601 strings with timezone in every transport type, every event, every database column (`timestamptz`). Convert to `Date` only at the point of arithmetic or display, and convert back immediately.

---

## 5. Database conventions

- Tables and columns: `snake_case`, plural table names, `id uuid primary key default gen_random_uuid()`.
- **Every tenant-scoped table has `workspace_id uuid not null references workspaces(id)`** and an index on it. No exceptions. Reference tables (fee schedules, channel taxonomies) are the only tables without it.
- **RLS is enabled on every table** in the same migration that creates it. Tenant tables get the standard policy: `workspace_id = (select auth.workspace_id())`. Service-role access from jobs bypasses RLS by design and is the only path that does; the job code must therefore always filter by `workspace_id` explicitly. A table created without RLS fails the migration test.
- `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()` with the shared trigger. Every table.
- Soft delete (`deleted_at`) only on `products`, `skus`, `listings`. Everything else is hard delete or append-only.
- Ledger tables are append-only. `ledger_events` has no `UPDATE` or `DELETE` grant for any role. Corrections are new events.
- Idempotency: `ledger_events` has a unique index on `(channel_account_id, external_event_id)`. Duplicate webhooks are a no-op at the database, not just in code.
- Credentials: `channel_accounts.credentials` is `bytea`, encrypted with AES-256-GCM in `src/lib/crypto.ts` using a key from the environment, never stored in plaintext, never selected by any query that returns rows to the browser.

**Migrations are forward only.** No down migrations. Breaking changes use expand-contract: add the new column, backfill, switch the code, drop the old column in a later release. A migration file is named `YYYYMMDDHHMMSS_verb_noun.sql` and does one thing.

**Writing a migration:**

1. `pnpm supabase migration new add_channel_accounts`
2. Write the SQL: table, indexes, RLS enable, policies, `updated_at` trigger.
3. `pnpm db:reset` applies all migrations plus `seed.sql` locally.
4. `pnpm db:types` regenerates types.
5. Add or update the integration test that exercises the table, including one test that proves a second workspace cannot read the row.
6. The PR includes the migration, the types diff, and the test.

`supabase/seed.sql` creates two workspaces, one with an eBay account and thirty products (ten unique, twenty stocked), and one empty. Every integration test starts from this state.

---

## 6. Testing standard

Targets by end of v1. These are floors, not goals to hit exactly.

| Layer | Tool | Count | Speed |
|---|---|---|---|
| Domain unit and property | Vitest, fast-check | 300+ | whole suite under 5 seconds |
| Connector contract | Vitest, recorded fixtures | 30+ per channel | under 10 seconds |
| Integration | Vitest against local Supabase | 60+ | under 2 minutes |
| End to end | Playwright | 3 flows | under 5 minutes |

**Ledger property tests** are the heart of the suite. Using fast-check, generate random event sequences and assert the invariants:

- Applying the same inbound event twice yields the same state as applying it once (idempotency).
- Available quantity is never negative.
- A unique item that receives a sale emits exactly one delist effect per other connected channel, and never a second one.
- A stocked item at quantity N receiving N sales across channels reaches zero and emits delists; the N+1th sale is rejected with an oversell reason.
- Events replayed in any order that respects per-channel causality produce the same final state.

**Connector contract tests** run every connector against recorded sandbox fixtures and assert the normalised output. The same test file runs for every connector via a shared harness, so a connector cannot skip a case. Fixtures are re-recorded from each sandbox at most every 90 days and the recording date is asserted in the test.

**Integration tests** hit a real local Supabase via `pnpm supabase start`. They cover repositories, RLS isolation, the webhook ingest job end to end with a fake connector, and Stripe webhook handling with Stripe's fixtures.

**End to end** is three Playwright flows only: sign up to first margin table, connect eBay sandbox and import, a sale on eBay sandbox delisting a unique item elsewhere. Anything more belongs in a lower layer.

**CI blocks on:** typecheck, Biome, unit, contract, integration, stale generated types, import-graph rule, migration applies cleanly from empty, no secrets in diff. E2E runs on `main` and on PRs labelled `e2e`.

---

## 7. Error handling and logging

**Rule: `Result` for expected failures, exceptions for bugs.** Anything that can fail as part of normal operation (a marketplace says no, a token expired, validation failed) returns `Result<T, E>`. Exceptions are reserved for programmer errors and are never caught except at the process boundary where they become a 500 and a Sentry event.

```ts
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
```

Error classes: `ConnectorError` (section 3), `LedgerRejection` (`oversell`, `unknown_sku`, `stale_event`), `ValidationError` (from zod, with path), `BillingError`. Each carries a `sellerMessage` when the seller will see it.

**Structured logger** in `src/lib/log.ts` wrapping pino. Every log line has: `level`, `msg`, `workspaceId` (when known), `requestId` or `jobId`, `channel` and `channelAccountId` (when relevant), `durationMs` for anything that did I/O. JSON in production, pretty locally.

**Never logged, enforced by a redaction list in the logger:** access tokens, refresh tokens, client secrets, Stripe secrets, buyer names, buyer addresses, buyer emails, buyer phone numbers, full order payloads. Log ids and counts instead. A PR that logs a raw webhook body is rejected.

**Errors to the seller** are written in plain English on the sync page, with the channel's own message quoted when it helps: "eBay rejected the price update for SKU 4421: 'Item is in an ended state.' Sync has stopped pushing to this listing. Relist it on eBay or remove it here." Never a stack trace, never an error code alone.

---

## 8. Feature flags and config

**Environment** is parsed once at boot by `src/lib/env.ts` with a zod schema. A missing or malformed variable crashes the process at startup with the variable name, never at request time. Server-only variables are never imported from client components; Biome restricts `env.server` imports to server files.

**Per-workspace flags** live in a `workspace_flags` table (`workspace_id`, `flag`, `enabled`, `updated_at`). Read through `getFlag(workspaceId, 'analyst_digest')` with a 60 second cache. Flags are for rolling features out to the founding cohort one at a time, not for permanent configuration.

**Kill switches** are global: a `connector_switches` table with one row per channel and `push_enabled`, `pull_enabled`, `webhooks_enabled`. Flipping `push_enabled` false for eBay pauses every outbound eBay job at the queue without losing it. This is the first thing you reach for when a marketplace changes an API on a Friday.

---

## 9. Git and delivery

Trunk-based. `main` is always deployable. Branches live under two days and are named `type/short-description`.

**Conventional commits**: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`, `db:` for migrations. Scope in parentheses when useful: `feat(ebay): handle ORDER_CONFIRMATION`.

**PR template checklist:**

- [ ] Tests added or updated for the change
- [ ] If a migration: reviewed for RLS, indexes, expand-contract, and applied locally from empty
- [ ] If a new table: RLS enabled and an isolation test exists
- [ ] No secrets, tokens, or PII in the diff or in new log lines
- [ ] Generated types are current
- [ ] Any change to outbound pushes has been run against a sandbox and the output pasted
- [ ] Docs updated if a rule or contract changed

**CI pipeline**, total budget 8 minutes on a PR:

1. Install with cache, typecheck, Biome (about 1 minute)
2. Unit and contract (under 30 seconds)
3. Local Supabase up, migrations from empty, integration (about 3 minutes)
4. Build (about 2 minutes)
5. E2E on `main` only or on label

**Deploys.** Every PR gets a Vercel preview with a Supabase branch database. Merge to `main` deploys to production automatically after CI. Migrations run in CI before the Vercel promotion via `supabase db push` against production, and a failed migration aborts the deploy. Releases are tagged `v0.x.y` weekly from `main` with a generated changelog.

**Rollback** is `vercel rollback` to the previous deployment, which is safe because migrations are expand-contract and the previous code runs against the new schema. A migration that cannot satisfy that must ship in two releases.

---

## 10. AI-assisted development rules

Claude Code is a pair, not an author of record. The founder reviews every diff before merge.

- Generated code follows this document. When Claude proposes something that conflicts with it, the document wins unless the PR also changes the document.
- Claude may create branches, write code and tests, run the suite, and open PRs. Claude does not merge, does not run migrations against production, does not rotate secrets, and does not push to any marketplace production account.
- **Mandatory human review before merge**, line by line: migrations and RLS policies, `src/lib/crypto.ts` and anything touching credentials, Stripe billing and webhooks, anything under `src/jobs/push*` or a connector's `push*` and `delist` methods, the account deletion endpoint, the logger redaction list.
- Claude states what it tested and how in every PR description. "Tests pass" without the command and the count is not acceptable.
- Sandbox credentials only in Claude's environment. Production credentials never.
- Every session that changes a contract (connector interface, normalised types, ledger event shape) updates the relevant doc in the same PR.

---

## 11. Definition of done

A feature is done when all of the following are true:

1. The behaviour is covered by tests at the lowest layer that can prove it, and CI is green.
2. Any new table has RLS, an isolation test, and generated types.
3. Any new external input is parsed with zod.
4. Any new outbound push has been executed against the channel sandbox and the result recorded in the PR.
5. Errors the seller can hit have a plain-English message on the sync page.
6. Logs for the feature carry `workspaceId` and never carry a secret or buyer PII.
7. The feature is behind a workspace flag if it changes what the seller sees, and the flag is on for the founder's own workspace.
8. Docs are updated if a contract, rule, or runbook changed.
9. It has been used once, by a human, on the preview deploy, doing the real thing.

---

## 12. Glossary

- **Workspace.** One seller's tenant. Every row of seller data belongs to exactly one.
- **Channel.** A marketplace we integrate with: eBay, Amazon, TikTok Shop, Depop, Etsy, Vinted Pro, OnBuy, or the seller's own storefront.
- **Channel account.** One authorised account on one channel within a workspace. A workspace can have two eBay accounts; each is a channel account with its own credentials and health.
- **Product.** A catalog entry: title, description, photos, attributes, cost price.
- **SKU.** The unit of stock. A product with no variants has one SKU; a product with variants has one SKU per variant. The ledger is keyed by SKU.
- **Unique item.** A SKU with quantity exactly one. A sale anywhere delists it everywhere.
- **Stocked item.** A SKU with quantity N. A sale anywhere decrements it everywhere.
- **Listing.** The projection of a SKU onto one channel account: the external listing id, channel-specific title and price, and sync status.
- **Ledger event.** An append-only record of something that changed a SKU's quantity: sale, cancellation, return, restock, manual adjustment, sync failure. The ledger is the only writer of stock.
- **Push job.** A queued outbound call to a channel: push stock, push price, push listing, delist. Retried per the error taxonomy, visible on the sync page.
- **Projection.** What a marketplace shows is a projection of the catalog and ledger. Sync writes projections; it never treats a marketplace as the source of truth.
