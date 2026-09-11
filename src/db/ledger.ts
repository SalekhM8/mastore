import { db, json } from "./client";

export interface ApplyLedgerInput {
  workspaceId: string;
  skuId: string;
  kind: "sale" | "cancellation" | "return" | "restock" | "manual_adjust" | "import_baseline" | "correction";
  quantityDelta: number;
  idempotencyKey: string;
  actor: string;
  sourceChannelAccountId?: string | null;
  orderLineId?: string | null;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
}

export interface ApplyLedgerResult {
  duplicate: boolean;
  event_seq: number;
  on_hand: number;
  job_ids: string[];
  incident_id: string | null;
}

/** The only way stock moves. Wraps public.apply_ledger_event. */
export async function applyLedgerEvent(input: ApplyLedgerInput): Promise<ApplyLedgerResult> {
  const sql = db();
  const rows = await sql<{ apply_ledger_event: ApplyLedgerResult }[]>`
    select public.apply_ledger_event(
      ${input.workspaceId}, ${input.skuId}, ${input.kind}, ${input.quantityDelta}, ${input.idempotencyKey},
      ${input.actor}, ${input.sourceChannelAccountId ?? null}, ${input.orderLineId ?? null},
      ${input.occurredAt ?? new Date().toISOString()}, ${json(sql, input.metadata ?? {})})`;
  const row = rows[0];
  if (!row) throw new Error("apply_ledger_event returned no row");
  return row.apply_ledger_event;
}
