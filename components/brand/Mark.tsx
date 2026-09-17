/**
 * The Parcel mark.
 *
 * A round lot is a block of four. A parcel is the piece you take out of
 * it — so the mark is that block with one cell lifted clear on the
 * diagonal, leaving a dotted socket where it sat. The three that stay
 * are currentColor at falling opacity, which gives the block a light
 * direction and makes it read as depth rather than as four flat
 * squares. The piece that left is the only thing in the mark carrying
 * the duotone, because it is the only thing the product is about.
 *
 * currentColor, not a custom property, for the block: it always
 * resolves, so the worst case on an unstyled ancestor is a legible
 * mark in the wrong colour rather than nothing at all.
 *
 * Plain markup with no hooks, so the server-rendered landing page and
 * the client desk can share one file. The gradient ids are fixed
 * rather than generated for the same reason; two marks on one page
 * define the same gradient twice, which is harmless.
 */
export const BRAND = {
  cyan: '#22d3ee',
  magenta: '#e879f9',
} as const;

export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className="pc-mark"
    >
      <defs>
        <linearGradient id="pcParcel" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={BRAND.cyan} />
          <stop offset="1" stopColor={BRAND.magenta} />
        </linearGradient>
      </defs>
      <g transform="rotate(-12 16 16)">
        {/* the block that stays */}
        <rect x="3" y="3" width="10" height="10" rx="2.6" fill="currentColor" />
        <rect
          x="14.5"
          y="3"
          width="10"
          height="10"
          rx="2.6"
          fill="currentColor"
          opacity=".48"
        />
        <rect
          x="3"
          y="14.5"
          width="10"
          height="10"
          rx="2.6"
          fill="currentColor"
          opacity=".72"
        />
        {/* the socket it came out of */}
        <rect
          x="14.5"
          y="14.5"
          width="10"
          height="10"
          rx="2.6"
          fill="none"
          stroke="currentColor"
          strokeOpacity=".3"
          strokeWidth="1.1"
          strokeDasharray="2 2.4"
        />
        {/* the parcel */}
        <rect
          x="19"
          y="19"
          width="10.6"
          height="10.6"
          rx="2.8"
          fill="url(#pcParcel)"
        />
        <rect
          x="19.55"
          y="19.55"
          width="9.5"
          height="9.5"
          rx="2.3"
          fill="none"
          stroke="#fff"
          strokeOpacity=".26"
          strokeWidth="1"
        />
      </g>
    </svg>
  );
}

/**
 * The wordmark as one unit. Every place that shows the logo wants the
 * same lockup, and three of them were building it by hand with a
 * different gap each time.
 */
export function Wordmark({ size = 22 }: { size?: number }) {
  return (
    <>
      <Mark size={size} />
      <b className="pc-wordmark">PARCEL</b>
    </>
  );
}
