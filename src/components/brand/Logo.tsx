/**
 * The Mastore HQ lockup from the brand board: an M mark with a Structural Yellow inner stroke,
 * the condensed wordmark, and the HQ badge. Scales with `size` (the mark's height in px).
 */
export function Mark({ size = 28, tone = "naval" }: { size?: number; tone?: "naval" | "optical" }) {
  const fill = tone === "naval" ? "#06233d" : "#ffffff";
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="Mastore mark">
      <path d="M2 30V2h6l8 12 8-12h6v28h-6V12l-8 12-8-12v18z" fill={fill} />
      <path d="M13.5 30V19h5v11z" fill="#ffb72b" />
    </svg>
  );
}

export function Logo({
  size = 28,
  tone = "naval",
  badge = true,
}: {
  size?: number;
  tone?: "naval" | "optical";
  badge?: boolean;
}) {
  const text = tone === "naval" ? "text-naval" : "text-optical";
  return (
    <span className="inline-flex items-center gap-2">
      <Mark size={size} tone={tone} />
      <span className={`font-display ${text}`} style={{ fontSize: size * 1.05, lineHeight: 1 }}>
        Mastore
      </span>
      {badge ? (
        <span
          className="rounded-md bg-structural px-1.5 font-display text-naval"
          style={{ fontSize: size * 0.62, lineHeight: 1.5, paddingTop: 1 }}
        >
          HQ
        </span>
      ) : null}
    </span>
  );
}
