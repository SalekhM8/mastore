import { describe, expect, it } from "vitest";
import type { ChannelAccountId, ChannelListingId } from "@/domain/channels/types";
import { isOversell, planFanout, priorityFor } from "@/domain/ledger/fanout";

const acc = (s: string) => s as ChannelAccountId;
const lst = (s: string) => s as ChannelListingId;

const listings = [
  {
    id: lst("L-ebay"),
    channelAccountId: acc("A-ebay"),
    managed: true,
    status: "active" as const,
    accountSyncEnabled: true,
  },
  {
    id: lst("L-depop"),
    channelAccountId: acc("A-depop"),
    managed: true,
    status: "active" as const,
    accountSyncEnabled: true,
  },
  {
    id: lst("L-vinted"),
    channelAccountId: acc("A-vinted"),
    managed: true,
    status: "pending" as const,
    accountSyncEnabled: true,
  },
  {
    id: lst("L-unmanaged"),
    channelAccountId: acc("A-etsy"),
    managed: false,
    status: "unmanaged" as const,
    accountSyncEnabled: true,
  },
  {
    id: lst("L-syncoff"),
    channelAccountId: acc("A-tiktok"),
    managed: true,
    status: "active" as const,
    accountSyncEnabled: false,
  },
  {
    id: lst("L-ended"),
    channelAccountId: acc("A-onbuy"),
    managed: true,
    status: "ended" as const,
    accountSyncEnabled: true,
  },
];

describe("planFanout", () => {
  it("unique item sold on eBay delists on every other managed, active or pending, sync-enabled listing", () => {
    const jobs = planFanout({
      itemType: "unique",
      eventKind: "sale",
      newOnHand: 0,
      sourceAccountId: acc("A-ebay"),
      listings,
    });
    expect(jobs.map((j) => j.channelListingId).sort()).toEqual(["L-depop", "L-vinted"]);
    expect(jobs.every((j) => j.kind === "delist" && j.quantity === 0 && j.priority === 0)).toBe(true);
  });

  it("stocked item sold on eBay decrements everywhere else with a stock job", () => {
    const jobs = planFanout({
      itemType: "stocked",
      eventKind: "sale",
      newOnHand: 7,
      sourceAccountId: acc("A-ebay"),
      listings,
    });
    expect(jobs.map((j) => j.channelListingId).sort()).toEqual(["L-depop", "L-vinted"]);
    expect(jobs.every((j) => j.kind === "stock" && j.quantity === 7)).toBe(true);
  });

  it("a manual restock with no source pushes to every eligible listing including eBay", () => {
    const jobs = planFanout({
      itemType: "stocked",
      eventKind: "restock",
      newOnHand: 12,
      sourceAccountId: null,
      listings,
    });
    expect(jobs.map((j) => j.channelListingId).sort()).toEqual(["L-depop", "L-ebay", "L-vinted"]);
    expect(jobs.every((j) => j.priority === 3)).toBe(true);
  });

  it("never pushes a negative quantity even when on-hand is negative", () => {
    const jobs = planFanout({
      itemType: "stocked",
      eventKind: "sale",
      newOnHand: -2,
      sourceAccountId: acc("A-ebay"),
      listings,
    });
    expect(jobs.every((j) => j.quantity === 0)).toBe(true);
  });

  it("import baseline is lowest priority so it never starves sales", () => {
    expect(priorityFor("import_baseline")).toBe(9);
    expect(priorityFor("sale")).toBe(0);
    expect(priorityFor("manual_adjust")).toBe(3);
  });
});

describe("isOversell", () => {
  it("flags the first crossing below zero only", () => {
    expect(isOversell(1, 0)).toBe(false);
    expect(isOversell(0, -1)).toBe(true);
    expect(isOversell(-1, -2)).toBe(false);
  });
});
