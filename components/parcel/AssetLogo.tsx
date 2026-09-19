'use client';

/**
 * Asset marks.
 *
 * Every asset in the desk now shows a mark rather than a letter in a
 * grey circle, because a row of letter tiles is unreadable at a glance
 * — the reader has to parse the text to know which line is cash and
 * which is stock, which is the one thing the icon exists to save them.
 *
 * These are drawn rather than fetched. A remote logo is a request that
 * can hang, a layout that shifts when it lands, and a third party that
 * learns which page the reader is on. The pre-IPO sponsors publish
 * their own images, so that one path takes a src and falls back here.
 */

const TILE = {
  USDC: '#2775ca',
  NVDA: '#76b900',
  SOL: '#14f195',
  ETH: '#627eea',
  BTC: '#f7931a',
} as const;

export type AssetSymbol = keyof typeof TILE | (string & {});

function Glyph({ symbol }: { symbol: string }) {
  switch (symbol) {
    case 'USDC':
      return (
        <g fill="#fff">
          <path d="M16 7.4a1 1 0 0 1 1 1v.9c2.3.4 3.9 1.9 4.1 4a.85.85 0 0 1-.85.9h-1a.9.9 0 0 1-.87-.72c-.24-1.05-1-1.7-2.38-1.7-1.5 0-2.35.7-2.35 1.72 0 .9.62 1.35 2.35 1.7l1.4.3c2.7.55 3.95 1.7 3.95 3.8 0 2.2-1.63 3.7-4.25 4.05v.85a1 1 0 0 1-2 0v-.87c-2.42-.37-4.06-1.9-4.28-4.06a.85.85 0 0 1 .85-.92h1a.9.9 0 0 1 .88.73c.25 1.1 1.12 1.73 2.62 1.73 1.62 0 2.5-.7 2.5-1.78 0-.88-.55-1.35-2.25-1.7l-1.4-.3C12.3 16.5 11 15.35 11 13.2c0-2.15 1.6-3.6 4-3.93V8.4a1 1 0 0 1 1-1Z" />
          <path d="M12.6 3.6a1 1 0 0 1 .66 1.88 11.3 11.3 0 0 0 0 21.3 1 1 0 1 1-.67 1.88 13.3 13.3 0 0 1 0-25.07 1 1 0 0 1 .01 0Zm6.8 0a1 1 0 0 1 .34.06 13.3 13.3 0 0 1 0 25.07 1 1 0 1 1-.67-1.89 11.3 11.3 0 0 0 0-21.3 1 1 0 0 1 .33-1.94Z" />
        </g>
      );
    case 'NVDA':
      // The eye, reduced to the two strokes that make it readable at
      // 16px: the almond, and the pupil opening to the right.
      return (
        <g fill="#fff">
          <path d="M16 8.6c-5 0-8.9 3-10.6 7.4C7.1 20.4 11 23.4 16 23.4c1.5 0 2.9-.27 4.2-.76v-2.3c-1.26.6-2.65.94-4.2.94-3.8 0-6.8-2.1-8.3-5.28C9.2 12.8 12.2 10.7 16 10.7c3.34 0 6.05 1.63 7.68 4.15v-2.9C21.8 10.05 19.1 8.6 16 8.6Z" />
          <path d="M16 12.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8Zm0 1.9a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z" />
          <path d="M22 11.8h1.9v8.4H22z" opacity=".55" />
        </g>
      );
    case 'SOL':
      return (
        <g fill="#fff">
          <path d="M9.4 20.6a.7.7 0 0 1 .5-.2h13a.35.35 0 0 1 .25.6l-2.55 2.6a.7.7 0 0 1-.5.2h-13a.35.35 0 0 1-.25-.6Z" />
          <path d="M9.4 8.4a.7.7 0 0 1 .5-.2h13a.35.35 0 0 1 .25.6l-2.55 2.6a.7.7 0 0 1-.5.2h-13a.35.35 0 0 1-.25-.6Z" />
          <path d="M20.6 14.5a.7.7 0 0 0-.5-.2h-13a.35.35 0 0 0-.25.6l2.55 2.6a.7.7 0 0 0 .5.2h13a.35.35 0 0 0 .25-.6Z" />
        </g>
      );
    case 'ETH':
      return (
        <g fill="#fff">
          <path d="M16 5 9.5 16.1 16 19.9l6.5-3.8Z" opacity=".75" />
          <path d="m16 21.3-6.5-3.8L16 27l6.5-9.5Z" />
        </g>
      );
    case 'BTC':
      return (
        <text
          x="16"
          y="22"
          textAnchor="middle"
          fill="#fff"
          fontSize="16"
          fontWeight="700"
        >
          ₿
        </text>
      );
    default:
      return (
        <text
          x="16"
          y="21.5"
          textAnchor="middle"
          fill="currentColor"
          fontSize="14"
          fontWeight="600"
          letterSpacing="-0.5"
        >
          {symbol.slice(0, 2).toUpperCase()}
        </text>
      );
  }
}

export function AssetLogo({
  symbol,
  size = 32,
  src,
  className = '',
}: {
  symbol: AssetSymbol;
  size?: number;
  /** A sponsor-published image, when the provider has one. */
  src?: string | null;
  className?: string;
}) {
  const key = String(symbol).toUpperCase();
  const tint = TILE[key as keyof typeof TILE];

  if (src)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className={`od-logo od-logo-img ${className}`}
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
      />
    );

  return (
    <svg
      className={`od-logo ${className}`}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        width="32"
        height="32"
        rx="10"
        fill={tint || 'var(--pc-raised)'}
        stroke={tint ? 'none' : 'var(--pc-line)'}
      />
      <Glyph symbol={key} />
    </svg>
  );
}

/** The two assets the vault holds, with the names a reader recognises. */
export const ASSETS = {
  NVDA: { name: 'NVIDIA', note: 'Share-equivalents' },
  USDC: { name: 'USD Coin', note: 'Settlement asset' },
} as const;
