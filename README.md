# Sync

Multi-channel inventory sync for UK resellers. One catalogue, a stock ledger as the source of truth, marketplaces as projections. Sell an item on eBay and it comes off everywhere else before the next buyer can pay.

Read `CLAUDE.md` and the four documents in `docs/` before changing anything.

## Local development

Prerequisites: Node 20+, pnpm 10, Docker Desktop with at least 10 GB free disk.

```bash
pnpm install
cp .env.example .env.local           # fill in the blanks (see below)
pnpm db:start                        # local Supabase: Postgres, Auth, REST on 127.0.0.1:5432x
pnpm db:reset                        # apply migrations and seed
pnpm db:types                        # regenerate src/db/types.gen.ts after any migration
pnpm dev                             # http://localhost:3000
npx inngest-cli@latest dev           # second terminal: job runner UI on http://127.0.0.1:8288
```

`.env.local` values:

| Variable | Where it comes from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` | printed by `pnpm db:start` (local) or the Supabase dashboard (hosted) |
| `CREDENTIALS_MASTER_KEY` | `openssl rand -base64 32`. Encrypts marketplace tokens at rest. Losing it means every seller reconnects. |
| `OAUTH_STATE_SECRET` | `openssl rand -base64 32` |
| `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_RUNAME` | eBay developer portal keyset (sandbox first) |
| `EBAY_DELETION_VERIFICATION_TOKEN` | 32 to 80 characters you choose; paste the same value into eBay's marketplace account deletion settings |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | Inngest dashboard. Not needed with the local dev server. |
| `APP_URL` | `http://localhost:3000` locally, the public URL in production |

Sign-in emails land in Mailpit at http://127.0.0.1:54324 locally.

## Checks

```bash
pnpm typecheck && pnpm lint
pnpm test:unit       # pure domain, sub-second
pnpm test:contract   # connectors against recorded fixtures
pnpm test:db         # against local Postgres: idempotency, RLS, fan-out, retry policy
pnpm build
```

## Layout

```
src/domain      pure rules: fan-out, retry policy, idempotency keys, inbound mapping
src/connectors  one folder per channel behind ChannelConnector; ebay/ and fake/ so far
src/db          the only place SQL lives; service connection for the job tier
src/jobs        Inngest functions: push queue per channel, webhook ingest, order poll, listing reconcile
src/app         Next.js routes: sign-in, workspace shell, channels, sync page, OAuth connect, webhook ingress
supabase        migrations and seed
tests           unit, contract, db
```

## How a sale flows

1. eBay posts to `/api/webhooks/ebay`. The route stores a receipt and emits one Inngest event. Nothing else.
2. `webhook-ingest` verifies the signature, parses the payload, resolves the seller account, and calls `apply_ledger_event`.
3. That one Postgres function records the event (idempotent on the key), updates `sku_stock`, and inserts coalesced `push_jobs` for every other managed listing, all in one transaction.
4. `push-<channel>` claims each job, checks it is not superseded, calls the connector, and records the outcome. Retries live in the database so the seller can see attempt counts.
5. Every 5 minutes the order poll catches anything the webhook missed. Every 6 hours the listing reconcile corrects drift.
