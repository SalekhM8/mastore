import type { AccountContext } from "@/connectors/contract";
import { loadAccountContext, saveCredentials, setAccountStatus, touchAccount } from "@/db/channel-accounts";
import { db } from "@/db/client";
import { getListing, recordPushApplied, setListingError, skuLastEventSeq, toListingRef } from "@/db/listings";
import { getConnectorSwitch, logActivity, raiseIncident } from "@/db/ops";
import { claimPushJob, duePushJobIds, finishPushJob, markSuperseded } from "@/db/push-jobs";
import type { Channel, PushResult } from "@/domain/channels/types";
import { decideTransition, isSuperseded } from "@/domain/push/retry";
import { withContext } from "@/lib/log";
import { EVENTS, inngest, PushRequestedData } from "./client";
import { CHANNEL_LABEL, getConnector } from "./connectors";

/**
 * Outbound push queue. One Inngest function per channel with its own concurrency and throttle,
 * all sharing runPushJob(). See docs/reliability-and-operations.md section 3.
 */

export type PushOutcome =
  | { outcome: "skipped"; reason: "kill_switch" | "not_claimable" | "no_connector" | "no_credentials" }
  | { outcome: "superseded" }
  | { outcome: "succeeded" }
  | { outcome: "failed"; nextAttemptAt: string }
  | { outcome: "dead"; sideEffect: string };

const REFRESH_AHEAD_MS = 5 * 60_000;

async function freshCredentials(
  channel: Channel,
  account: AccountContext,
  row: { id: string; workspace_id: string },
): Promise<{ ok: true; account: AccountContext } | { ok: false; result: PushResult }> {
  const exp = account.credentials.expiresAt ? Date.parse(account.credentials.expiresAt) : Number.POSITIVE_INFINITY;
  if (exp - Date.now() > REFRESH_AHEAD_MS) return { ok: true, account };
  const connector = getConnector(channel);
  if (!connector) return { ok: false, result: { kind: "retryable", message: "connector unavailable" } };
  const refreshed = await connector.refreshCredentials(account.credentials);
  if (refreshed.kind !== "ok") return { ok: false, result: refreshed as PushResult };
  await saveCredentials({ workspaceId: row.workspace_id, channelAccountId: row.id, bundle: refreshed.value });
  return { ok: true, account: { ...account, credentials: refreshed.value } };
}

export async function runPushJob(
  channel: Channel,
  jobId: string,
  now: () => Date = () => new Date(),
): Promise<PushOutcome> {
  const log = withContext({ jobId, channel });
  const sw = await getConnectorSwitch(channel);
  if (!sw.push_enabled) {
    log.warn("push kill switch is on; leaving job queued");
    return { outcome: "skipped", reason: "kill_switch" };
  }
  const connector = getConnector(channel);
  if (!connector) return { outcome: "skipped", reason: "no_connector" };

  const job = await claimPushJob(jobId);
  if (!job) return { outcome: "skipped", reason: "not_claimable" };
  const jlog = log.child({
    workspaceId: job.workspace_id,
    channelAccountId: job.channel_account_id,
    kind: job.kind,
    attempt: job.attempts,
  });

  const listing = await getListing(job.channel_listing_id);
  if (!listing || !listing.sku_id) {
    await finishPushJob(jobId, {
      status: "dead",
      error: { kind: "terminal", message: "Listing is no longer linked to a SKU.", attempt: job.attempts },
      sideEffect: "none",
    });
    return { outcome: "dead", sideEffect: "none" };
  }

  // Ordering: never apply an older quantity after a newer one.
  const lastSeq = await skuLastEventSeq(listing.sku_id);
  if (isSuperseded(Number(job.ledger_seq), lastSeq)) {
    await markSuperseded(jobId);
    jlog.info({ jobSeq: job.ledger_seq, lastSeq }, "job superseded by a newer ledger event");
    return { outcome: "superseded" };
  }

  const loaded = await loadAccountContext(job.channel_account_id);
  if (!loaded) {
    await finishPushJob(jobId, {
      status: "dead",
      error: { kind: "auth_revoked", message: "No credentials stored for this account.", attempt: job.attempts },
      sideEffect: "account_auth_revoked",
    });
    await setAccountStatus(job.channel_account_id, "auth_revoked", "no credentials");
    return { outcome: "dead", sideEffect: "account_auth_revoked" };
  }

  const started = Date.now();
  let result: PushResult<unknown>;
  const fresh = await freshCredentials(channel, loaded.context, loaded.row);
  if (!fresh.ok) {
    result = fresh.result;
  } else {
    const ref = toListingRef(listing);
    const quantity = job.desired.quantity ?? 0;
    switch (job.kind) {
      case "stock":
      case "relist":
        result = await connector.pushStock(fresh.account, ref, quantity);
        break;
      case "delist":
        result = await connector.delist(fresh.account, ref);
        break;
      case "price":
        result = await connector.pushPrice(fresh.account, ref, job.desired.price_minor ?? 0);
        break;
      default:
        result = { kind: "terminal", code: "unsupported_job", messageForSeller: `${job.kind} is not supported yet.` };
    }
  }
  const durationMs = Date.now() - started;
  const transition = decideTransition(result, job.attempts, now());
  await finishPushJob(jobId, transition);
  const label = CHANNEL_LABEL[channel];
  const title = listing.title_snapshot ?? listing.external_listing_id;

  switch (transition.status) {
    case "succeeded": {
      const quantity = job.desired.quantity ?? 0;
      await recordPushApplied({ listingId: listing.id, ledgerSeq: Number(job.ledger_seq), quantity, kind: job.kind });
      await touchAccount(job.channel_account_id, "outbound");
      await logActivity({
        workspaceId: job.workspace_id,
        channelAccountId: job.channel_account_id,
        skuId: listing.sku_id,
        message:
          job.kind === "delist"
            ? `${label}: ${title} ended after stock reached 0.`
            : `${label}: ${title} set to ${quantity}.`,
        context: { job_id: jobId, kind: job.kind, quantity, duration_ms: durationMs },
      });
      jlog.info({ durationMs }, "push succeeded");
      return { outcome: "succeeded" };
    }
    case "failed":
      jlog.warn({ durationMs, error: transition.error }, "push failed, will retry");
      return { outcome: "failed", nextAttemptAt: transition.nextAttemptAt.toISOString() };
    case "dead": {
      jlog.error({ durationMs, error: transition.error, sideEffect: transition.sideEffect }, "push dead");
      if (transition.sideEffect === "account_auth_revoked") {
        await setAccountStatus(job.channel_account_id, "auth_revoked", transition.error.message);
        await raiseIncident({
          workspaceId: job.workspace_id,
          kind: "auth_revoked",
          severity: 1,
          channelAccountId: job.channel_account_id,
          details: { job_id: jobId },
        });
        await logActivity({
          workspaceId: job.workspace_id,
          channelAccountId: job.channel_account_id,
          level: "error",
          message: `${label} has disconnected. Reconnect it to resume syncing.`,
          context: { job_id: jobId },
        });
      } else if (transition.sideEffect === "listing_error") {
        await setListingError(listing.id, transition.error);
        await raiseIncident({
          workspaceId: job.workspace_id,
          kind: "push_dead",
          severity: 2,
          skuId: listing.sku_id,
          channelAccountId: job.channel_account_id,
          channelListingId: listing.id,
          details: { job_id: jobId, error: transition.error },
        });
        await logActivity({
          workspaceId: job.workspace_id,
          channelAccountId: job.channel_account_id,
          skuId: listing.sku_id,
          level: "error",
          message: `${label} rejected the update for ${title}: ${transition.error.message}`,
          context: { job_id: jobId },
        });
      } else {
        await raiseIncident({
          workspaceId: job.workspace_id,
          kind: "push_dead",
          severity: 2,
          skuId: listing.sku_id,
          channelAccountId: job.channel_account_id,
          channelListingId: listing.id,
          details: { job_id: jobId, error: transition.error },
        });
        await logActivity({
          workspaceId: job.workspace_id,
          channelAccountId: job.channel_account_id,
          skuId: listing.sku_id,
          level: "error",
          message: `${label} update for ${title} failed after ${transition.error.attempt} attempts. Retry from the sync page.`,
          context: { job_id: jobId },
        });
      }
      return { outcome: "dead", sideEffect: transition.sideEffect };
    }
  }
}

/** Emit push.requested for a set of job ids (after apply_ledger_event or a reconcile enqueue). */
export async function requestPushes(jobIds: readonly string[]): Promise<number> {
  if (jobIds.length === 0) return 0;
  const rows = await db()<{ id: string; channel: Channel; channel_account_id: string }[]>`
    select j.id, a.channel, j.channel_account_id
    from public.push_jobs j join public.channel_accounts a on a.id = j.channel_account_id
    where j.id = any(${jobIds as string[]}::uuid[])`;
  if (rows.length === 0) return 0;
  try {
    await inngest.send(
      rows.map((r) => ({
        name: EVENTS.pushRequested,
        data: { jobId: r.id, channel: r.channel, channelAccountId: r.channel_account_id } satisfies PushRequestedData,
      })),
    );
  } catch (e) {
    // The jobs are already in the outbox; the per-channel sweeper re-emits them within a minute.
    withContext({}).warn({ err: e, count: rows.length }, "inngest send failed; sweeper will pick the jobs up");
    return 0;
  }
  return rows.length;
}

interface ChannelLimits {
  concurrency: number;
  throttle: { limit: number; period: `${number}s` | `${number}m` | `${number}h`; burst?: number };
  /** Etsy limits per app, everyone else per seller account. */
  scope: "account" | "app";
}

/** From docs/reliability-and-operations.md section 3. */
export const CHANNEL_LIMITS: Record<Channel, ChannelLimits> = {
  ebay: { concurrency: 2, throttle: { limit: 20, period: "10s" }, scope: "account" },
  amazon: { concurrency: 1, throttle: { limit: 4, period: "1s", burst: 5 }, scope: "account" },
  tiktok: { concurrency: 1, throttle: { limit: 1, period: "1s" }, scope: "account" },
  depop: { concurrency: 2, throttle: { limit: 10, period: "1s" }, scope: "account" },
  etsy: { concurrency: 2, throttle: { limit: 8, period: "1s" }, scope: "app" },
  onbuy: { concurrency: 1, throttle: { limit: 200, period: "1h" }, scope: "account" },
  vinted: { concurrency: 1, throttle: { limit: 2, period: "1s" }, scope: "account" },
  storefront: { concurrency: 4, throttle: { limit: 50, period: "1s" }, scope: "account" },
};

export function makePushFunction(channel: Channel) {
  const limits = CHANNEL_LIMITS[channel];
  const key = limits.scope === "account" ? "event.data.channelAccountId" : `"${channel}"`;
  return inngest.createFunction(
    {
      id: `push-${channel}`,
      triggers: [{ event: EVENTS.pushRequested, if: `event.data.channel == "${channel}"` }],
      concurrency: { key, limit: limits.concurrency },
      throttle: {
        key,
        limit: limits.throttle.limit,
        period: limits.throttle.period,
        ...(limits.throttle.burst ? { burst: limits.throttle.burst } : {}),
      },
      // Retries live in the database (attempts, next_attempt_at) so the seller can see them.
      retries: 0,
    },
    async ({ event, step }) => {
      const data = PushRequestedData.parse(event.data);
      return step.run("push", () => runPushJob(channel, data.jobId));
    },
  );
}

/** Every minute: re-emit any due job (retries, missed events, jobs deferred by a kill switch). */
export function makePushSweeper(channel: Channel) {
  return inngest.createFunction(
    { id: `push-sweep-${channel}`, triggers: [{ cron: "* * * * *" }], retries: 0 },
    async ({ step }) => {
      const due = await step.run("find-due", () => duePushJobIds(channel));
      if (due.length === 0) return { sent: 0 };
      await step.sendEvent(
        "emit",
        due.map((j) => ({
          name: EVENTS.pushRequested,
          data: { jobId: j.id, channel, channelAccountId: j.channel_account_id } satisfies PushRequestedData,
        })),
      );
      return { sent: due.length };
    },
  );
}
