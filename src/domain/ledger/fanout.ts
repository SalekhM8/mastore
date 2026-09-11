import type { ChannelAccountId, ChannelListingId, ItemType } from "../channels/types";

/**
 * Pure fan-out rule. The SQL function apply_ledger_event implements the same rule inside the
 * transaction; this TypeScript version exists so the rule is unit-testable and readable, and so
 * the two can be checked against each other.
 */

export type LedgerKind =
  | "sale"
  | "cancellation"
  | "return"
  | "restock"
  | "manual_adjust"
  | "import_baseline"
  | "correction";

export interface ListingForFanout {
  readonly id: ChannelListingId;
  readonly channelAccountId: ChannelAccountId;
  readonly managed: boolean;
  readonly status: "draft" | "pending" | "active" | "ended" | "error" | "unmanaged";
  readonly accountSyncEnabled: boolean;
}

export interface FanoutJob {
  readonly channelListingId: ChannelListingId;
  readonly channelAccountId: ChannelAccountId;
  readonly kind: "stock" | "delist";
  readonly quantity: number;
  readonly priority: 0 | 3 | 9;
}

export function priorityFor(kind: LedgerKind): 0 | 3 | 9 {
  if (kind === "sale" || kind === "cancellation" || kind === "return") return 0;
  if (kind === "import_baseline") return 9;
  return 3;
}

export function planFanout(input: {
  itemType: ItemType;
  eventKind: LedgerKind;
  newOnHand: number;
  sourceAccountId: ChannelAccountId | null;
  listings: readonly ListingForFanout[];
}): readonly FanoutJob[] {
  const quantity = Math.max(input.newOnHand, 0);
  const kind: FanoutJob["kind"] = input.itemType === "unique" && input.newOnHand <= 0 ? "delist" : "stock";
  const priority = priorityFor(input.eventKind);
  return input.listings
    .filter((l) => l.managed && (l.status === "active" || l.status === "pending") && l.accountSyncEnabled)
    .filter((l) => input.sourceAccountId === null || l.channelAccountId !== input.sourceAccountId)
    .map((l) => ({ channelListingId: l.id, channelAccountId: l.channelAccountId, kind, quantity, priority }));
}

/** True when the sale pushed on-hand below zero: someone bought something we no longer had. */
export function isOversell(previousOnHand: number, newOnHand: number): boolean {
  return newOnHand < 0 && previousOnHand >= 0;
}
