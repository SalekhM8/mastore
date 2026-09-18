import type { ChannelConnector } from "@/connectors/contract";
import { EbayConnector } from "@/connectors/ebay";
import { FakeConnector } from "@/connectors/fake";
import type { Channel } from "@/domain/channels/types";
import { env } from "@/lib/env";

/**
 * The one place a channel name becomes a connector instance. Jobs ask here; nothing else
 * constructs connectors. Tests replace the registry with setConnector().
 */

const overrides = new Map<Channel, ChannelConnector>();
let ebay: EbayConnector | undefined;

export function getConnector(channel: Channel): ChannelConnector | null {
  const o = overrides.get(channel);
  if (o) return o;
  switch (channel) {
    case "ebay": {
      const e = env();
      if (!e.EBAY_CLIENT_ID || !e.EBAY_CLIENT_SECRET || !e.EBAY_RUNAME) return null;
      ebay ??= new EbayConnector({
        clientId: e.EBAY_CLIENT_ID,
        clientSecret: e.EBAY_CLIENT_SECRET,
        ruName: e.EBAY_RUNAME,
        env: e.EBAY_ENV,
        ...(e.EBAY_DELETION_VERIFICATION_TOKEN
          ? { deletionVerificationToken: e.EBAY_DELETION_VERIFICATION_TOKEN }
          : {}),
        webhookEndpointUrl: `${e.APP_URL}/api/webhooks/ebay`,
        ...(e.EBAY_DEV_ID ? { devId: e.EBAY_DEV_ID } : {}),
      });
      return ebay;
    }
    case "storefront":
      return new FakeConnector();
    default:
      return null;
  }
}

/** Test seam. */
export function setConnector(channel: Channel, connector: ChannelConnector | null): void {
  if (connector) overrides.set(channel, connector);
  else overrides.delete(channel);
}

export const CHANNEL_LABEL: Record<Channel, string> = {
  ebay: "eBay",
  amazon: "Amazon",
  tiktok: "TikTok Shop",
  vinted: "Vinted",
  depop: "Depop",
  etsy: "Etsy",
  onbuy: "OnBuy",
  storefront: "Storefront",
};
