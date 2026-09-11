# Sync — Security and Compliance Standard

Version 1.0 · 9 September 2026 · Owner: Salekh Mahmood (founder, sole engineer, security owner)

This is the standard Sync is built to. Every control below is either **in force** (we do it from the first commit), **pre-launch** (must be true before the first real seller connects), or **future** (an obligation that only attaches when we take on a specific role or scale). The status is stated on each control. Nothing here is aspirational; if a control says in force, it is in the code or the vendor console, and the pre-launch checklist in section 10 is how we prove it.

Stack this document assumes: Next.js App Router on Vercel, Supabase (Postgres, Auth, Storage), Inngest (jobs and webhook processing), Stripe Billing, Resend (email), PostHog (analytics). One workspace per seller. Marketplace OAuth tokens stored per channel account.

Obligations this document maps to:

| Source | What it demands of us | Where covered |
|---|---|---|
| Amazon SP-API Data Protection Policy §1 (all developers) | Network controls, MFA, unique accounts, lockout, 24h deprovisioning, quarterly access review, least privilege, 12-char passwords, credential rotation every 12 months, TLS 1.2+, annual risk assessment, incident plan reviewed every 6 months, notify security@amazon.com within 24h, delete on request within 30 days, tag Amazon-origin data | §3, §6, §8, §9 |
| Amazon SP-API DPP §2 (only if we hold PII) | PII retention max 30 days after delivery, encryption at rest AES-128+, logs retained 12 months, vulnerability scans every 30 days, annual pentest, DLP, no PII on personal devices | §5, §9 (marked future) |
| Amazon Acceptable Use Policy | Use data only for the seller who authorised us, never pool across sellers, never market to buyers, never resell derived data | §1, §2 |
| eBay API License Agreement + DPA Exhibit A | Independent controllers, delete personal information promptly, public privacy policy, UK GDPR and SCCs, destroy eBay data within 10 days of termination, audit rights | §5, §8 |
| eBay marketplace account deletion notifications | Challenge endpoint, ack within seconds, delete the user's data irreversibly | §4, §5 |
| TikTok Shop data security and privacy review (DSPR) | Questionnaire on storage, encryption, access, retention, breach process | this whole document is the answer |
| Depop API Access Service Terms | Independent controllers under UK data protection law, 24h breach notification, delete on termination, no scraping | §5, §8 |
| Vinted Pro Integrations terms | HMAC-signed webhooks, no unofficial automation | §4 |
| UK GDPR, Data Protection Act 2018, ICO | Registration and fee, lawful basis, records of processing, DSAR within one month, breach notice to ICO within 72h | §5, §8, §9 |
| Stripe PCI DSS SAQ-A | Card data never touches our servers; Stripe Checkout and Billing portal only | §5 |
| Supabase | RLS on every tenant table, service role key server-only, Auth session handling | §2, §7 |

---

## 1. Threat model

### Assets, ranked by damage if compromised

| Rank | Asset | Why it matters | Classification |
|---|---|---|---|
| 1 | Marketplace OAuth refresh tokens (eBay, Amazon, TikTok, Depop, Etsy) and pasted API keys (Vinted, OnBuy) | Full write access to a seller's shop: relist, reprice, cancel, delist. A leak is a seller's livelihood and an immediate platform ban for us | Secret |
| 2 | Buyer PII arriving in marketplace orders (name, address, email, phone) | Legal exposure under UK GDPR, Amazon DPP §2, eBay DPA. We are a processor here | Restricted |
| 3 | Seller catalog, cost prices, margin data | Commercially sensitive. Leaked cost prices across sellers would end the business | Confidential |
| 4 | Seller account data (login, email, Stripe customer id, workspace settings) | Account takeover leads to asset 1 | Confidential |
| 5 | Our own platform credentials (Supabase service role key, Stripe secret key, Inngest signing key, encryption master key, marketplace app client secrets) | Compromise of any one is total compromise | Secret |
| 6 | Stock ledger and sync logs | Integrity failure causes oversells and double sales, the exact thing we sell against | Confidential |

### Actors

- **External attacker** with no account: targets the public app, webhook endpoints, and OAuth callbacks.
- **Malicious or compromised seller** with a valid account: tries to read another workspace's data or exhaust shared rate limits.
- **Marketplace as an adversary**: not malicious, but a forged or replayed webhook is indistinguishable from a real one without signature checks.
- **Insider**: today that is one person. The control is that one person's accounts are as hard to take over as a team's.
- **Supply chain**: a compromised npm dependency or a leaked Vercel or Supabase credential.

### Trust boundaries

1. Browser to Vercel edge: untrusted input, authenticated by Supabase session cookie.
2. Vercel to Supabase: authenticated as the user (anon key + JWT) for request-path reads and writes, or as service role only inside server code that has already established workspace scope.
3. Marketplace to webhook ingress: untrusted until signature verified.
4. Inngest to our functions: authenticated by Inngest signing key; every function receives workspace_id in its event payload and scopes every query by it.
5. Our workers to marketplace APIs: outbound, holds the seller's token, subject to their rate limits.

### Top 10 risks, ranked

| # | Risk | Likelihood | Impact | Primary control |
|---|---|---|---|---|
| 1 | Cross-tenant data read via a missing RLS policy or a service-role query without a workspace filter | Medium | Critical | §2: RLS on every table, service-role usage pattern, isolation tests in CI |
| 2 | Marketplace token exfiltration from database dump, log line, or error report | Medium | Critical | §3: envelope encryption, redaction, no tokens in logs or Sentry |
| 3 | Forged or replayed webhook creates a fake sale and delists stock everywhere | Medium | High | §4: signature verification, replay window, idempotency keys |
| 4 | Account takeover of the founder's Vercel, Supabase, Stripe, or marketplace developer account | Low | Critical | §6: hardware-key MFA everywhere, unique passwords, no shared accounts |
| 5 | SSRF via seller-supplied photo URLs or marketplace image URLs fetched server-side | Medium | High | §7: allowlisted hosts, no private ranges, size and type limits |
| 6 | Leaked Supabase service role key in a client bundle | Low | Critical | §2, §7: key only in server env, CI check for its prefix in build output |
| 7 | Buyer PII retained past legal limits | High if unmanaged | High | §5: retention job, PII columns nullable and scrubbed |
| 8 | Compromised npm dependency | Low | Critical | §7: lockfile, Dependabot, provenance, minimal deps |
| 9 | Missed credential rotation causes outage (Amazon LWA secret 180 days) | High if unmanaged | Medium | §9: compliance calendar with alerts |
| 10 | Stripe webhook forged to grant a paid plan | Low | Medium | §4: Stripe signature verification, idempotency on event id |

---

## 2. Tenant isolation

Status: **in force** from the first migration.

### The rule

Every table that holds seller data has a `workspace_id uuid not null references workspaces(id)` column, RLS enabled, and policies that compare `workspace_id` to the caller's workspace. No exceptions, including join tables, logs, and jobs. A table without `workspace_id` is either global reference data (fee schedules, category mappings) or does not exist.

### Policy pattern

Membership is resolved through a single helper so policies never repeat logic:

```sql
create or replace function auth.workspace_ids()
returns setof uuid
language sql stable security definer set search_path = public as $$
  select workspace_id from workspace_members where user_id = auth.uid()
$$;

alter table products enable row level security;

create policy products_select on products for select
  using (workspace_id in (select auth.workspace_ids()));
create policy products_insert on products for insert
  with check (workspace_id in (select auth.workspace_ids()));
create policy products_update on products for update
  using (workspace_id in (select auth.workspace_ids()))
  with check (workspace_id in (select auth.workspace_ids()));
create policy products_delete on products for delete
  using (workspace_id in (select auth.workspace_ids()));
```

Rules:
- [ ] `enable row level security` and the four policies are generated by one migration template, never hand-written per table.
- [ ] `workspace_id` is indexed on every table (it leads every composite index).
- [ ] The `anon` role has no grants on tenant tables. Only `authenticated` and `service_role`.
- [ ] Column-level: encrypted token columns are excluded from the `authenticated` role's select grant entirely, so even a policy bug cannot return ciphertext to a browser.

### Who runs as what

| Context | Client | Key | Scope enforcement |
|---|---|---|---|
| Browser | supabase-js | anon key + user JWT | RLS |
| Server Components, Route Handlers, Server Actions | `@supabase/ssr` server client | anon key + user JWT from cookie | RLS |
| Inngest functions and webhook processors | service-role client, created only in `lib/db/service.ts` | service role key (server env only) | **Application-level**: every function receives `workspace_id` in the event, calls `scopedDb(workspaceId)` which returns a query builder that injects `.eq('workspace_id', id)` on every table access. Raw service client is not exported |
| Migrations | Supabase CLI | database password | n/a |

The service role client is never used in a request handler. If a request needs to bypass RLS, that is a design error.

### Tests that prove isolation

Status: **pre-launch**, run in CI on every push.

- [ ] `rls.test.ts`: creates two workspaces with one user each, inserts a row in every tenant table for workspace A, asserts user B gets zero rows on select, zero rows affected on update and delete, and a policy violation on insert with A's id.
- [ ] `service-scope.test.ts`: every exported function in `lib/db/service.ts` requires a `workspaceId` argument; a static test asserts the raw client is not exported.
- [ ] `grants.test.ts`: queries `information_schema.role_table_grants` and asserts `anon` has no grants on any table in `public` except explicitly listed reference tables, and `authenticated` has no select on `channel_accounts.credentials_ciphertext`.
- [ ] Schema lint: a script that fails CI if any table in `public` lacks `workspace_id` and is not in the reference-table allowlist, or has RLS disabled.

---

## 3. Secrets and credentials

### Marketplace tokens at rest

Status: **in force**.

Application-level envelope encryption, so a database dump or a Supabase incident does not yield usable tokens.

- Master key: 32 bytes, base64, in Vercel env `SYNC_KEK_V1`, and mirrored in Supabase Vault for migration scripts. Never in the repo, never in `.env.example` with a real value.
- Per-row data key: 32 random bytes generated at write time.
- Data key encrypted with the master key using AES-256-GCM. Token encrypted with the data key using AES-256-GCM. Both nonces random, 12 bytes.
- Stored columns on `channel_accounts`: `credentials_ciphertext bytea`, `credentials_nonce bytea`, `dek_ciphertext bytea`, `dek_nonce bytea`, `kek_version smallint`.
- AAD for both encryptions is `workspace_id || channel_account_id`, so a ciphertext moved to another row fails to decrypt.
- Decryption happens only in `lib/crypto/credentials.ts`, called only from connector code. Decrypted tokens live in function memory for the duration of one job and are never returned from a Route Handler.
- Key rotation: add `SYNC_KEK_V2`, run a job that re-wraps every row's data key, bump `kek_version`, retire V1 after all rows are on V2. The token ciphertext is untouched.

### Rotation schedule

| Credential | Cadence | Source of the rule | Mechanism |
|---|---|---|---|
| Amazon LWA client secret | Every 180 days, notice at 90 | Amazon SP-API requirement; old secret dies 7 days after rotation | Calendar alert at 150 days; Application Management API `rotateApplicationClientSecret` or manual in SPP |
| eBay Cert ID (client secret) | Every 12 months | Amazon DPP §1 sets 12 months as our baseline for all programmatic credentials | Reset in developer portal, grace period set to 7 days |
| TikTok, Depop, Etsy app secrets | Every 12 months | Same baseline | Vendor console |
| Our master key `SYNC_KEK` | Every 12 months or on any suspected exposure | Same baseline | Re-wrap job above |
| Supabase service role key | Every 12 months or on exposure | Same baseline | Supabase dashboard, update Vercel env, redeploy |
| Stripe secret key, webhook secret | Every 12 months | Same baseline | Stripe dashboard, rolling key feature |
| Inngest signing key | Every 12 months | Same baseline | Inngest dashboard |
| Seller OAuth refresh tokens | Per platform (Depop refresh rotates on use and expires at 1 year; Amazon may require reauth at 365 days; TikTok refresh expires with the authorisation) | Platform rules | Reauth prompt in the sync page 30 days before expiry, driven by `channel_accounts.reauth_due_at` |

### Where secrets live

| Secret | Location | Never in |
|---|---|---|
| All server secrets | Vercel environment variables, production and preview separated, preview gets sandbox keys only | Repo, client bundle, logs, PostHog, Sentry |
| Master key | Vercel env and Supabase Vault | Anywhere else |
| Local development | `.env.local`, gitignored, sandbox keys only | Commits |
| Marketplace tokens | `channel_accounts` encrypted columns | Any other table, any log, any error report |

### What never enters logs

Enforced by a single `redact()` applied in the logger and in the Sentry `beforeSend` hook: any value under keys matching `/token|secret|key|password|authorization|cookie|credential|signature/i`, any string that matches known token prefixes (`Atzr|`, `v^1.1#`, `pak_`, `sk_live`, `sk_test`, `whsec_`, `eyJ` longer than 40 chars), buyer email, phone, and address lines. Redaction is tested with a fixture of real-shaped tokens.

---

## 4. Webhook ingress security

Status: **in force** for every connector from the day it ships.

### Shape of every ingress route

`app/api/webhooks/[channel]/route.ts`:

1. Read the raw body as bytes. Never parse before verifying.
2. Verify the signature for that channel (table below). Failure returns 401 and is logged with source IP and channel, without the body.
3. Check the timestamp where the platform supplies one. Reject anything older than 5 minutes.
4. Compute the idempotency key (table below). Insert into `webhook_events (channel, external_event_id, received_at, payload_hash)` with a unique constraint on `(channel, external_event_id)`. On conflict, return 200 and stop.
5. Enqueue an Inngest event carrying `webhook_event_id` and the resolved `workspace_id`. Return 200 within the platform's ack window. All processing happens in the Inngest function.
6. Ingress is rate limited per channel and per source at the Vercel edge (Vercel WAF rate limit rule or `@upstash/ratelimit`), set well above expected peak so a burst from eBay's account deletion feed (up to ~1,500/day) is never dropped.

### Per-channel verification

| Channel | Header | Method | Idempotency key |
|---|---|---|---|
| eBay Notification API and account deletion | `X-EBAY-SIGNATURE` | Base64-decode header to get `kid`, fetch public key via Notification API `getPublicKey`, cache 1 hour, verify ECDSA signature over the body. Use eBay's Event Notification SDK for Node. Challenge handshake on GET: SHA-256 of `challengeCode + verificationToken + endpointURL` in that order | `notification.notificationId` |
| Stripe | `Stripe-Signature` | `stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET)`, tolerance 300s | `event.id` |
| Depop | `X-Depop-Signature` | HMAC-SHA256 over raw body with the webhook secret shown once at creation, constant-time compare | event id from payload, fallback `sha256(body)` |
| Vinted Pro | `X-Vpi-Webhook-Hmac-Sha256` as `t=<ts>,v1=<sig>` | HMAC-SHA256 over `timestamp + "." + body` with the signing key, constant-time compare, reject if `ts` older than 5 minutes | event id from payload |
| TikTok Shop | `Authorization` header | HMAC-SHA256 over `app_key + body` with the app secret per TikTok's webhook doc, constant-time compare, verify `timestamp` in payload within 5 minutes | `shop_id + type + timestamp + sha256(body)` |
| Amazon SP-API | none (SQS) | Messages arrive via SQS, not HTTP. The SQS queue policy allows only Amazon's principal `437568002678`. Our poller (Inngest cron) reads with our own AWS credentials. Dedupe on `NotificationMetadata.NotificationId` | `NotificationId` |
| Etsy | signing secret per Etsy webhook docs | HMAC verification per their spec, constant-time compare | `resource_url + event_type` |
| Inngest to our functions | `X-Inngest-Signature` | Handled by the Inngest SDK with `INNGEST_SIGNING_KEY` | n/a |

Replay protection: the unique constraint on `channel_events` plus the timestamp window. A replay of an old event within the window is a duplicate, caught by the constraint. Outside the window it is rejected by the timestamp.

Processing idempotency: the ledger itself is the second line. Every ledger entry carries `(channel_account_id, external_ref)` unique, so even a duplicate that slips past ingress cannot double-decrement stock.

---

## 5. Data classification and retention

### Classification

| Class | Examples | Our role | Encryption | Retention |
|---|---|---|---|---|
| Secret | Marketplace tokens, our platform keys | Controller | Envelope encrypted (§3) plus Supabase disk encryption | Until channel disconnected, then deleted immediately |
| Restricted (buyer PII) | Buyer name, address, email, phone from orders | **Processor** for the seller, and independent controller vis-à-vis eBay and Depop under their terms | Supabase disk encryption; column-level encryption added if we take Amazon restricted roles | See below |
| Confidential | Catalog, cost prices, margins, ledger, sync logs, seller account data | Controller | Supabase disk encryption | Life of the workspace plus 30 days |
| Internal | Application logs, metrics | Controller | At rest by provider | 12 months (Amazon DPP), then deleted |
| Public | Fee schedules, category mappings, marketing site | n/a | n/a | Indefinite |

### Buyer PII: what we hold and for how long

Status: **in force** for eBay, Depop, TikTok, Etsy, Vinted, OnBuy from day one. **Future** for Amazon: in v1 we take only unrestricted roles, so Amazon never sends us buyer PII. Amazon DPP §2 does not attach until we request the Direct-to-Consumer Shipping role.

What the ledger needs from an order is the order id, line items, SKUs, quantities, prices, fees, status, and dates. It does not need who bought it. So:

- `orders` holds no PII columns. `order_buyer_details` is a separate table with `workspace_id`, `order_id`, name, address, email, phone, and `purge_after timestamptz`.
- `purge_after` is set to delivery date plus 30 days, or order date plus 60 days if no delivery event arrives. This matches the strictest rule we will ever face (Amazon DPP §2's 30 days after delivery) so we never have to change it.
- An Inngest cron runs daily and deletes every row past `purge_after`. Deletion is a real delete, not a soft delete.
- The sync page and analyst never display buyer PII. Sellers see it on the marketplace where it lives.
- PII is never sent to PostHog, Resend, or the LLM adapter. The analyst summariser receives aggregates only.

### Payment data

Stripe holds cards. We hold `stripe_customer_id`, `stripe_subscription_id`, plan, status, and trial dates. Checkout and card updates use Stripe Checkout and the Billing Portal, hosted by Stripe, so our PCI scope is SAQ-A. No card number, expiry, or CVC ever reaches our origin. The Stripe publishable key is the only Stripe value in the browser.

### Backups

Supabase daily backups, retained per plan (target: 7 days point-in-time recovery on the Pro plan). Backups contain encrypted token columns only, never plaintext. Restore is tested quarterly (§9). Backup retention means deleted PII can persist in a backup for up to the retention window; the privacy policy states this.

### Deletion flows

**eBay marketplace account deletion notification** (status: in force before production keys):
1. Ingress verifies and acks within seconds (§4).
2. Inngest function looks up every `channel_accounts` row where `channel = 'ebay'` and `external_user_id = notification.data.userId`. We key on `userId`, not `username`, because eBay replaces usernames for some jurisdictions.
3. For each match: delete `order_buyer_details` for orders from that account, delete the channel account row (which cascades listings and credentials), and write a `deletion_requests` row with the notification id and a count of rows removed, no user data.
4. If no match, log the notification id only. We must still ack.
5. Deletion is irreversible and completes within 24 hours of receipt. eBay marks the endpoint down after 24 hours of failed acks and gives 30 days to fix.

**Seller workspace deletion** (status: pre-launch):
1. Seller requests from settings, or we action a written request within 30 days (Amazon DPP §1) and no later than one month (UK GDPR).
2. Revoke every marketplace token we can revoke via API, delete `channel_accounts`, cancel the Stripe subscription, delete Supabase Storage objects under the workspace prefix, delete every tenant row via cascade from `workspaces`, delete the Supabase Auth user.
3. Write a `deletion_requests` row. Retain Stripe invoices as required by UK tax law (6 years); they contain business name and address, not buyer data.
4. eBay data specifically must be destroyed within 10 days of the seller disconnecting eBay or of our termination from the eBay programme.

**DSAR from a seller or a buyer** (status: pre-launch):
- Seller: export of their workspace as JSON via a job, delivered within one month.
- Buyer: we are the processor. We forward to the seller (the controller) within 5 days and assist. If the buyer's data has already passed `purge_after`, we say so.

---

## 6. Internal access control

Status: **in force** today, even with one person, because Amazon and TikTok reviewers will ask and because the controls are what make one person's accounts safe.

- [ ] **MFA on every vendor account**: Vercel, Supabase, GitHub, Stripe, Inngest, Resend, PostHog, AWS (for SQS), domain registrar, Google Workspace, and every marketplace developer portal. Hardware security key (two keys, one offsite) as the primary factor where supported, TOTP where not. SMS is never a factor.
- [ ] **Unique accounts**: no shared logins. Marketplace developer accounts are on named addresses at our domain, not personal Gmail. The TikTok Partner Center account uses an address never used for a seller account.
- [ ] **Password policy**: password manager, 20+ character generated passwords. Amazon's 12-character floor is exceeded by default.
- [ ] **Least privilege**: GitHub repo private, branch protection on `main`, no force push. Supabase project has one owner. Vercel team has one owner. When a second person joins, they get the minimum role and are added to the access review.
- [ ] **Lockout**: Supabase Auth rate limits and lockout are on for our sellers. Vendor consoles enforce their own.
- [ ] **Deprovisioning within 24 hours**: when anyone leaves, their access to every system in the inventory is removed the same day, and any credential they could have seen is rotated within 7 days.
- [ ] **Quarterly access review**: on the compliance calendar. Even solo, the review is: list every vendor account, confirm MFA state, confirm no unknown API keys, tokens, or team members exist in any console, confirm no stale Vercel env vars. Record the date and outcome in `docs/access-reviews/YYYY-QN.md`.
- [ ] **Break-glass**: recovery codes for every MFA-protected account are printed and stored sealed in a physical location separate from the hardware keys. A second sealed copy with a trusted person under written instruction. If the founder is unavailable for 14 days, that person can wind down: pause billing, notify sellers, disconnect channels. This is written in `docs/continuity.md` (pre-launch).
- [ ] **No production data on personal devices**: laptops are full-disk encrypted, screen lock at 2 minutes, no database dumps to local disk. Development uses sandbox marketplace accounts and seeded data only.

---

## 7. Application security

### Authentication and sessions

Status: **in force**.

- Supabase Auth with email magic link and OAuth (Google) for sellers. Password login enabled with Supabase's leaked-password check on. MFA (TOTP) offered to sellers at launch and required for any workspace with more than 500 listings (pre-launch policy).
- Sessions via `@supabase/ssr` cookies, `httpOnly`, `Secure`, `SameSite=Lax`. Every Server Component and Route Handler calls `supabase.auth.getUser()` (server-verified), never `getSession()` alone, before touching data.
- `middleware.ts` refreshes the session and redirects unauthenticated requests to sign-in for every route under `/app`.
- OAuth callbacks from marketplaces (`/connect/[channel]/callback`) require a signed `state` parameter bound to the seller's session and workspace, valid for 10 minutes, single use. A callback with a mismatched state is rejected and logged.

### CSRF

Server Actions carry Next.js's origin check. Route Handlers that mutate state require `SameSite=Lax` cookies plus an `Origin` header check against the allowed host list. Webhook routes are exempt from CSRF and protected by signatures instead (§4).

### Headers

Set in `next.config.ts` for every route:

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-<per-request>' https://js.stripe.com; connect-src 'self' https://*.supabase.co https://api.stripe.com https://eu.i.posthog.com; img-src 'self' data: https://*.supabase.co https://i.ebayimg.com <other marketplace image CDNs as connectors ship>; frame-src https://js.stripe.com https://checkout.stripe.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

CSP starts in report-only for the first week of each new connector, then enforced.

### Input validation

Every boundary validates with zod before any logic: Route Handler bodies, Server Action arguments, webhook payloads after signature verification, marketplace API responses (a connector never trusts an API response shape), CSV imports, and environment variables at boot (`lib/env.ts` fails the build if a required variable is missing or malformed).

### SSRF protection for photo fetches

Status: **in force** with the first import feature.

Sync fetches images from marketplace CDNs on import and from seller-supplied URLs on CSV import. The fetcher in `lib/fetch/safe-fetch.ts`:

- Resolves the hostname first and rejects any address in private, loopback, link-local, or metadata ranges (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, ::1, fc00::/7, fe80::/10).
- Allows only `https:`.
- Follows at most 3 redirects, re-checking the resolved address on each hop.
- Enforces a 15 MB response cap and a 20 second timeout.
- Accepts only `image/jpeg`, `image/png`, `image/webp` by sniffing magic bytes, not by trusting `Content-Type`.
- Marketplace connectors use an allowlist of known CDN hosts; seller-supplied URLs get the full check above.

### File uploads

Photos upload directly to Supabase Storage using a short-lived signed upload URL scoped to `workspaces/{workspace_id}/`. Storage RLS mirrors table RLS. On upload completion an Inngest job re-encodes the image with `sharp` (which strips EXIF, including GPS, and neutralises malformed files), rejects anything that is not a real image, and stores derived sizes per channel. The original is deleted after re-encoding. Bucket is private; images are served through signed URLs with 1 hour expiry, or through a public bucket only for storefront images the seller has explicitly published.

### Dependencies

- `pnpm` with a committed lockfile and `--frozen-lockfile` in CI.
- Dependabot security updates auto-merged when tests pass; version updates weekly, reviewed.
- `pnpm audit --audit-level=high` fails CI.
- Minimal dependency policy: no package for something under 50 lines. Each new dependency is named in the PR description with why.
- Node LTS pinned in `package.json` `engines` and `.nvmrc`.

### CI checks

- Secret scanning: `gitleaks` in CI and as a pre-commit hook. GitHub secret scanning and push protection enabled on the repo.
- Client bundle scan: a build step greps `.next/static` for `SUPABASE_SERVICE_ROLE`, `sk_live`, `sk_test`, `whsec_`, and our env variable names, and fails on any hit.
- Type check, lint, unit tests, RLS tests (§2), redaction tests (§3), signature verification tests with real-shaped fixtures (§4).
- Preview deployments use sandbox keys only and are password protected via Vercel.

---

## 8. Logging, monitoring, incident response

### What we log

Structured JSON via a single logger, shipped to Vercel logs (drained to Axiom or Better Stack for 12-month retention, pre-launch).

| Field | Always | Notes |
|---|---|---|
| `ts`, `level`, `msg` | yes | |
| `request_id` | yes | Vercel request id, propagated into Inngest events |
| `workspace_id` | when known | Never the seller's email in the log line |
| `channel`, `channel_account_id` | for connector and webhook events | |
| `external_ref` | for orders and listings | Marketplace order and listing ids are fine; they are not PII |
| `duration_ms`, `status` | for outbound API calls | |
| `error.code`, `error.message` | on failure | After `redact()` |

Never logged: tokens, secrets, request bodies containing credentials, buyer name, address, email, phone, full webhook payloads (we log the event id and a hash). See §3 for the redaction rule.

Audit log: a separate `audit_events` table records who did what to which workspace object, with `actor_user_id`, `action`, `object_type`, `object_id`, `before_hash`, `after_hash`, `ip`, `user_agent`. Every mutation through a Server Action writes one. Retained 12 months.

### Monitoring and alerting

Status: **pre-launch**.

- Error tracking: Sentry with `beforeSend` redaction, PII scrubbing on, no session replay.
- Uptime: external check every minute on the marketing site, the app sign-in page, and each webhook route's health response (a signed GET that returns 200 without touching data).
- Alerts to the founder's phone (PagerDuty free tier or Better Stack) on: webhook signature failure rate above 1 percent over 5 minutes, any 5xx rate above 1 percent, any outbound push failure rate above 2 percent per channel over 15 minutes, Inngest function failure after final retry, a job touching more than 100 rows without a workspace filter (guarded by the scoped client, this alert catches a bug in the guard), any login to a vendor console from a new device (vendor-native alerts on).
- Supabase: log drain on, `pg_stat_statements` on, alert on connection pool above 80 percent.

### Incident response

Status: **in force** as a written procedure, tested by tabletop before launch and every 6 months after (Amazon DPP §1).

Severity: **S1** any confirmed or suspected exposure of tokens, buyer PII, or cross-tenant data, or an integrity failure that changed stock on marketplaces incorrectly. **S2** service down or sync stalled for more than 30 minutes. **S3** everything else.

S1 runbook with clocks starting at detection:

| Time | Action |
|---|---|
| 0 | Open an incident record `docs/incidents/YYYY-MM-DD-slug.md` with detection time, what is known, and who is on it. Start a timeline. |
| 0 to 1h | Contain. Rotate the affected credential. If tokens may be exposed, revoke every marketplace token for affected channel accounts via each platform's revoke endpoint, then rotate our app secrets. Disable the affected route if needed. |
| 0 to 4h | Scope. Which workspaces, which data classes, what time window. Pull audit log and access logs. Preserve evidence before rotating what is safe to preserve. |
| within 24h | Notify Amazon at security@amazon.com if any Amazon-origin data is involved (DPP §1). Notify Depop at legal@depop.com and dpo@depop.com if Depop data is involved (Depop terms). Notify eBay through developer support if eBay personal information is involved (DPA). |
| within 72h | Notify the ICO if the breach is likely to result in a risk to individuals (UK GDPR Art. 33). Record the decision either way, with reasons. |
| without undue delay | Notify affected sellers by email with what happened, what data, what we did, what they should do (reauthorise, check listings). If buyers are affected, notify the seller as controller so they can meet their own obligation. |
| within 5 business days | Post-incident review written using the template below. |

Post-incident template: summary, timeline, root cause, blast radius (workspaces, rows, data classes), what worked, what did not, corrective actions with owners and dates, and whether any policy in this document changes.

---

## 9. Compliance calendar

Owner is the founder for every row until there is a team. Each row is a recurring calendar event with a reminder 14 days ahead, and the completion is recorded in `docs/compliance-log.md`.

| Obligation | Cadence | Source | Status |
|---|---|---|---|
| Amazon LWA client secret rotation | Every 180 days, act at 150 | Amazon SP-API | in force on Amazon go-live |
| All other app secrets and platform keys rotation (§3 table) | Every 12 months | Amazon DPP §1 baseline | in force |
| Master encryption key rotation and re-wrap | Every 12 months | Our standard | in force |
| Access review (§6) | Quarterly | Amazon DPP §1 | in force |
| Dependency audit review and Dependabot triage | Weekly | Our standard | in force |
| Vulnerability scan of the deployed app and dependencies | Every 30 days | Amazon DPP §2 (future) adopted now as baseline | pre-launch |
| Penetration test by a third party | Annually, first before Amazon Appstore submission | Amazon DPP §2 (future); Appstore review expectations | future, budgeted month 6 |
| Risk assessment review of this document | Annually and after any S1 incident | Amazon DPP §1 | in force |
| Incident response tabletop | Every 6 months | Amazon DPP §1 | pre-launch |
| Backup restore test | Quarterly | Our standard | pre-launch |
| Buyer PII purge job health check | Weekly automated, monthly manual spot check | Amazon DPP §2, UK GDPR minimisation | in force |
| Log retention verification (12 months kept, older deleted) | Quarterly | Amazon DPP §2 | pre-launch |
| ICO registration and data protection fee | Annually | Data Protection (Charges and Information) Regulations 2018 | pre-launch |
| Records of processing update | Every 6 months and on each new connector | UK GDPR Art. 30 | pre-launch |
| Privacy policy and terms re-read against each platform's current policy | Every 6 months and on any platform policy change email | eBay, Amazon, Depop, TikTok terms | in force |
| eBay account deletion endpoint test notification | Monthly | eBay programme requirement (endpoint marked down after 24h of failures) | in force on eBay production |
| Seller reauthorisation reminders | Automated daily | Platform token lifetimes | in force |
| Amazon Data Security Assessment questionnaire | When Amazon sends it, typically annually after listing | Amazon | future |
| TikTok DSPR renewal | When TikTok requests | TikTok | future |

---

## 10. Pre-launch checklists

### Before the first real seller connects any channel

Every box must be ticked and the evidence linked from `docs/compliance-log.md`.

Data and tenancy
- [ ] Every tenant table has `workspace_id`, RLS enabled, four policies, and passes `rls.test.ts` and the schema lint.
- [ ] `anon` has no grants on tenant tables; `authenticated` cannot select credential ciphertext columns.
- [ ] Service role client is only constructed in `lib/db/service.ts` and only exposed through `scopedDb(workspaceId)`.
- [ ] Marketplace credentials are envelope encrypted with AAD; decryption tested; a row moved between workspaces fails to decrypt.
- [ ] `order_buyer_details` is separate from `orders`, has `purge_after`, and the purge cron runs and is monitored.

Ingress
- [ ] Every live webhook route verifies signatures with real-shaped fixtures in tests, enforces the 5 minute window, and dedupes on the platform event id.
- [ ] eBay account deletion endpoint passes eBay's challenge and test notification, and the deletion job is tested against a sandbox account.
- [ ] Stripe webhook verifies signature and dedupes on event id.
- [ ] Ingress rate limits are configured and tested with a burst.

Secrets and accounts
- [ ] No secret in the repo history (`gitleaks` clean on full history), push protection on.
- [ ] Client bundle scan passes.
- [ ] Every vendor and marketplace developer account has hardware-key or TOTP MFA, a unique password, and a domain email. Inventory recorded in `docs/access-reviews/2026-Q3.md`.
- [ ] Recovery codes sealed and stored; `docs/continuity.md` written.
- [ ] Preview deployments use sandbox keys and are password protected.

Application
- [ ] CSP enforced (not report-only) on the app, HSTS with preload submitted, remaining headers present. Verified with an external header scanner.
- [ ] `getUser()` used in every protected server path; middleware covers every `/app` route.
- [ ] OAuth `state` is signed, bound to session, single use, and expires in 10 minutes; tested for mismatch.
- [ ] Safe fetcher blocks private ranges and non-image content; tested against a local listener and a redirect to `169.254.169.254`.
- [ ] Photo uploads re-encoded with EXIF stripped; original deleted.
- [ ] Env validation fails the build on a missing variable.

Operations
- [ ] Logs drained to a 12-month store; redaction tested; Sentry `beforeSend` redaction on.
- [ ] Alerts wired to the founder's phone and tested by triggering each condition once.
- [ ] Uptime checks live on the app and every webhook health route.
- [ ] Backup restore performed once into a scratch project and timed.
- [ ] Incident runbook tabletop done once; notification addresses for Amazon, Depop, eBay, and the ICO recorded in the runbook.

Legal
- [ ] ICO registration complete and fee paid.
- [ ] Privacy policy live covering: what we collect from sellers, what we receive from marketplaces including buyer data and our processor role, retention periods including the 30-day PII purge and backup window, sub-processors (Vercel, Supabase, Inngest, Stripe, Resend, PostHog, Sentry, log store, AWS for SQS), international transfers, DSAR contact, and the Etsy attribution line when Etsy ships.
- [ ] Terms of service live, including the seller's responsibility as controller for buyer data and our right to suspend on marketplace policy breach.
- [ ] Data processing terms with sellers (processor clauses under UK GDPR Art. 28) included in the terms.
- [ ] Records of processing written.
- [ ] Marketplace policies accepted and filed: eBay API License Agreement, Amazon AUP and DPP, Depop API terms, TikTok partner terms, Vinted Pro Integrations terms when applicable.

### Before the Amazon Selling Partner Appstore submission

Everything above, plus:

- [ ] Amazon developer profile security questionnaire answers reconciled against this document; every answer points to a control that exists.
- [ ] Website meets Amazon's website guidelines: HTTPS, company and app name matching the profile, privacy policy, terms, visible pricing, contact method, no placeholders.
- [ ] Third-party penetration test completed and critical and high findings fixed (Amazon DPP §2 is future, but the Appstore review and the Data Security Assessment expect it, and we do not want to explain its absence).
- [ ] 30-day vulnerability scan cadence has at least three consecutive clean runs on record.
- [ ] Incident response plan reviewed within the last 6 months, tabletop recorded.
- [ ] LWA secret rotation job or calendar entry live with the 150-day trigger.
- [ ] Amazon-origin data is tagged: every row that came from SP-API carries `source_channel = 'amazon'` so we can delete it on Amazon's request within 30 days and prove we did.
- [ ] No PII from Amazon is stored (we hold unrestricted roles only). If Direct-to-Consumer Shipping is ever requested, this document is revised to promote every §2 future control to in force first, including column-level encryption of `order_buyer_details`, DLP, and the architecture meeting with Amazon.
- [ ] Appstore listing copy contains no superlatives, no Amazon trademarks, no customer quotes, no PII.
- [ ] Support email and phone on the listing are monitored and answered within one business day.

---

## Change log

| Date | Change | By |
|---|---|---|
| 2026-09-09 | First version, written before the first line of application code | Salekh Mahmood |
