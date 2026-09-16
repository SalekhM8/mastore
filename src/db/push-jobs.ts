import type { Channel } from "@/domain/channels/types";
import type { JobTransition } from "@/domain/push/retry";
import { db, json } from "./client";

export interface PushJobRow {
  id: string;
  workspace_id: string;
  channel_account_id: string;
  channel_listing_id: string;
  kind: "stock" | "price" | "listing_create" | "listing_update" | "delist" | "relist";
  desired: { quantity?: number; price_minor?: number; draft?: unknown };
  ledger_seq: string; // bigint comes back as string
  priority: number;
  status: "queued" | "running" | "succeeded" | "failed" | "superseded" | "dead";
  attempts: number;
  next_attempt_at: Date;
  last_error: unknown;
}

/** Atomically move a due job to running. Returns null if someone else got it or it is not due. */
export async function claimPushJob(jobId: string): Promise<PushJobRow | null> {
  const rows = await db()<PushJobRow[]>`select * from public.claim_push_job(${jobId})`;
  return rows[0] ?? null;
}

export async function finishPushJob(jobId: string, t: JobTransition): Promise<void> {
  const sql = db();
  switch (t.status) {
    case "succeeded":
      await sql`update public.push_jobs set status = 'succeeded', finished_at = now(), last_error = null where id = ${jobId}`;
      return;
    case "failed":
      await sql`update public.push_jobs set status = 'failed', next_attempt_at = ${t.nextAttemptAt}, last_error = ${json(sql, t.error)} where id = ${jobId}`;
      return;
    case "dead":
      await sql`update public.push_jobs set status = 'dead', finished_at = now(), last_error = ${json(sql, t.error)} where id = ${jobId}`;
      return;
  }
}

export async function markSuperseded(jobId: string): Promise<void> {
  await db()`update public.push_jobs set status = 'superseded', finished_at = now() where id = ${jobId}`;
}

/** Ids of jobs for a channel that are due now, oldest priority first. Used by the sweeper. */
export async function duePushJobIds(
  channel: Channel,
  limit = 200,
): Promise<{ id: string; channel_account_id: string }[]> {
  return db()<{ id: string; channel_account_id: string }[]>`
    select j.id, j.channel_account_id
    from public.push_jobs j
    join public.channel_accounts a on a.id = j.channel_account_id
    where a.channel = ${channel}
      and a.sync_enabled and a.deleted_at is null and a.status in ('healthy','degraded','connecting')
      and j.status in ('queued','failed')
      and j.next_attempt_at <= now()
    order by j.priority, j.next_attempt_at
    limit ${limit}`;
}

/** Put a job back to queued after a transient failure to even claim it (e.g. kill switch on). */
export async function deferPushJob(jobId: string, untilMs: number): Promise<void> {
  await db()`update public.push_jobs set status = 'queued', next_attempt_at = now() + make_interval(secs => ${untilMs / 1000}) where id = ${jobId} and status = 'running'`;
}

/** Enqueue a listing_create job carrying the draft the connector will publish. */
export async function enqueueListingCreateJob(input: {
  workspaceId: string;
  channelAccountId: string;
  channelListingId: string;
  draft: unknown;
  quantity: number;
  ledgerSeq: number;
}): Promise<string> {
  const sql = db();
  const rows = await sql<{ id: string }[]>`
    insert into public.push_jobs (workspace_id, channel_account_id, channel_listing_id, kind, desired, ledger_seq, priority)
    values (${input.workspaceId}, ${input.channelAccountId}, ${input.channelListingId}, 'listing_create',
            ${json(sql, { quantity: input.quantity, draft: input.draft })}, ${input.ledgerSeq}, 3)
    on conflict (channel_listing_id, kind) where status = 'queued'
    do update set desired = excluded.desired, ledger_seq = excluded.ledger_seq, next_attempt_at = now()
    returning id`;
  const row = rows[0];
  if (!row) throw new Error("enqueueListingCreateJob returned no row");
  return row.id;
}

/** Enqueue (or coalesce into) a stock push for one listing. Used by reconciliation only. */
export async function enqueueStockJob(input: {
  workspaceId: string;
  channelAccountId: string;
  channelListingId: string;
  quantity: number;
  ledgerSeq: number;
  priority: number;
  kind?: "stock" | "delist";
}): Promise<string> {
  const sql = db();
  const rows = await sql<{ id: string }[]>`
    insert into public.push_jobs (workspace_id, channel_account_id, channel_listing_id, kind, desired, ledger_seq, priority)
    values (${input.workspaceId}, ${input.channelAccountId}, ${input.channelListingId}, ${input.kind ?? "stock"},
            ${json(sql, { quantity: input.quantity })}, ${input.ledgerSeq}, ${input.priority})
    on conflict (channel_listing_id, kind) where status = 'queued'
    do update set desired = excluded.desired, ledger_seq = excluded.ledger_seq,
                  priority = least(public.push_jobs.priority, excluded.priority), next_attempt_at = now()
    returning id`;
  const row = rows[0];
  if (!row) throw new Error("enqueueStockJob returned no row");
  return row.id;
}
