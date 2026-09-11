# Sync

Multi-channel inventory sync SaaS for UK sellers. One catalog, a stock ledger as the source of truth, marketplaces as projections. Working name "Sync" (brand pending).

## Read before writing code
- `docs/architecture-and-data-model.md` — the schema and the four core flows. Change the doc before the schema.
- `docs/engineering-standards.md` — layout, dependency rule, connector contract, testing, git.
- `docs/security-and-compliance.md` — RLS, credential encryption, webhook verification, retention.
- `docs/reliability-and-operations.md` — SLOs, queue design, rate limits, runbooks.

## Non-negotiables
- Nothing writes stock except `apply_ledger_event`. No direct writes to `ledger_events` or `sku_stock`.
- Every tenant table has `workspace_id` and RLS in the same migration that creates it.
- `src/domain/**` imports nothing from `app`, `connectors`, `db`, or `jobs`.
- Connectors never touch the database or the ledger. They translate and return `PushResult`.
- Money is integer minor units. Time is `timestamptz`. Ids are UUID v7.
- Never log tokens, credentials, or buyer PII.
- Human review before merge: migrations, RLS, crypto, billing, any outbound push or delist path, the eBay account deletion endpoint.

## Commands
- `pnpm dev` app · `pnpm db:start` local Supabase · `pnpm db:reset` apply migrations and seed
- `pnpm test:unit` pure domain tests · `pnpm test:db` integration tests against local Postgres
- `pnpm lint` Biome · `pnpm typecheck`

@AGENTS.md
