/**
 * The smallest XML helpers that let us speak the Trading API without a dependency. Responses
 * are shallow and predictable; every value read here is then validated with zod in trading.ts.
 * This is deliberately not a general XML parser.
 */

export function escapeXml(value: string | number): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Text of the first `<tag>` found (searching the whole string). Attributes are ignored. */
export function tagText(xml: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml);
  return m ? unescapeXml(m[1].trim()) : undefined;
}

/** Inner XML of every `<tag>...</tag>` block, in document order. */
export function tagBlocks(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g");
  let m: RegExpExecArray | null = re.exec(xml);
  while (m) {
    out.push(m[1]);
    m = re.exec(xml);
  }
  return out;
}

/** Builds a Trading API request envelope. The token travels in a header, not the body. */
export function tradingEnvelope(callName: string, inner: string): string {
  return `<?xml version="1.0" encoding="utf-8"?><${callName}Request xmlns="urn:ebay:apis:eBLBaseComponents"><ErrorLanguage>en_GB</ErrorLanguage><WarningLevel>High</WarningLevel>${inner}</${callName}Request>`;
}
