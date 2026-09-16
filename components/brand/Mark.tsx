/**
 * The Parcel mark.
 *
 * A round lot is a block of four. A parcel is the piece you take out of
 * it: three squares hold the block, the fourth is pulled clear on the
 * diagonal and carries the accent. The slight rotation is inherited
 * from the previous mark, which keeps the two feeling related.
 *
 * The block takes currentColor so it flips with the theme; on a dark
 * bar a literal ink square is invisible. currentColor always resolves,
 * unlike a custom property, so the worst case is a black square on
 * white rather than nothing at all — which is what happened when this
 * file read --ink and --accent from an ancestor.
 *
 * Plain markup with no hooks, so the server-rendered landing page and
 * the client desk share one file.
 */
export const BRAND = {
  pale: '#bfe9d5',
  accent: '#5ed3a0',
} as const;

export function Mark({ size = 21 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 26 26"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className="pc-mark"
    >
      <g transform="rotate(-9 13 13)">
        <rect x="1" y="1" width="9" height="9" rx="1.7" fill="currentColor" />
        <rect x="11.6" y="1" width="9" height="9" rx="1.7" fill={BRAND.pale} />
        <rect
          x="1"
          y="11.6"
          width="9"
          height="9"
          rx="1.7"
          fill="currentColor"
        />
        {/* The parcel: one cell, lifted off the block on the diagonal. */}
        <rect
          x="16.4"
          y="16.4"
          width="8.2"
          height="8.2"
          rx="1.6"
          fill={BRAND.accent}
        />
      </g>
    </svg>
  );
}
