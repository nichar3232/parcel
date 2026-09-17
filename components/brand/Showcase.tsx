'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PLOT } from '@/lib/oddlot/landing';
import type { EXAMPLES, Preview } from '@/lib/oddlot/landing';

type Product = (typeof EXAMPLES)[number];

function PayoffPreview({
  preview,
}: {
  preview: Extract<Preview, { kind: 'payoff' }>;
}) {
  const p = preview.payoff;
  return (
    <svg viewBox={`0 0 ${PLOT.w} ${PLOT.h}`} className="lp-preview-chart">
      <title>Payoff at expiry</title>
      <defs>
        <linearGradient id="lpShowFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--pc-cyan)" stopOpacity=".26" />
          <stop offset="1" stopColor="var(--pc-cyan)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="lpShowStroke" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--pc-cyan)" />
          <stop offset="1" stopColor="var(--pc-magenta)" />
        </linearGradient>
      </defs>

      <g className="lp-grid-band">
        {p.grid.map((g) => (
          <g key={g.label + g.y}>
            <line x1={PLOT.x0} x2={PLOT.x1} y1={g.y} y2={g.y} />
            <text x={PLOT.x0 - 12} y={g.y + 3.5} textAnchor="end">
              {g.label}
            </text>
          </g>
        ))}
      </g>

      <g className="lp-strikes">
        {p.strikes.map((k, i) => (
          <g key={`${k.value}-${i}`}>
            <line x1={k.x} x2={k.x} y1={PLOT.y0} y2={PLOT.y1} />
            <text x={k.x} y={PLOT.y0 - 10} textAnchor="middle">
              ${k.value}
            </text>
          </g>
        ))}
      </g>

      <path d={p.area} fill="url(#lpShowFill)" />
      <line
        x1={PLOT.x0}
        x2={PLOT.x1}
        y1={p.zeroY}
        y2={p.zeroY}
        className="lp-zero"
      />
      <path d={p.line} className="lp-curve" stroke="url(#lpShowStroke)" />

      <g className="lp-ticks">
        {p.ticks.map((t, i) => (
          <text
            key={t.label}
            x={t.x}
            y={PLOT.axisY}
            textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}
            data-mid={i === 1 || undefined}
          >
            {t.label}
          </text>
        ))}
      </g>
    </svg>
  );
}

function Preview({ preview }: { preview: Preview }) {
  if (preview.kind === 'payoff')
    return <PayoffPreview preview={preview} />;
  if (preview.kind === 'outcomes')
    return (
      <div className="lp-outcomes">
        {preview.outcomes.map((o) => (
          <div key={o.when}>
            <span>{o.when}</span>
            <strong>{o.value}</strong>
            <small>{o.note}</small>
          </div>
        ))}
      </div>
    );
  return (
    <div className="lp-split">
      {preview.parts.map((part) => (
        <div key={part.label}>
          <span>{part.label}</span>
          <i style={{ width: `${Math.min(100, part.share * 66)}%` }} />
          <strong>{part.value}</strong>
        </div>
      ))}
    </div>
  );
}

/**
 * One product at a time.
 *
 * Five cards side by side made the reader compare things they had not
 * read yet. A tab picks one, and the panel gives it the room to show
 * what it actually does: the shape it makes, the two ways it can end,
 * or how its collateral divides.
 *
 * The tabs answer the nav's #options / #lending links through the hash,
 * which is why they carry those ids.
 */
export function Showcase({ products }: { products: Product[] }) {
  const [active, setActive] = useState(products[0].id);
  useEffect(() => {
    const sync = () => {
      const id = window.location.hash.slice(1);
      if (products.some((p) => p.id === id)) setActive(id);
    };
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, [products]);

  const product = products.find((p) => p.id === active) || products[0];
  return (
    <div className="lp-showcase">
      <div className="lp-tabs" role="tablist" aria-label="Products">
        {products.map((p) => (
          <button
            key={p.id}
            id={p.id}
            role="tab"
            aria-selected={p.id === product.id}
            className={p.id === product.id ? 'selected' : ''}
            onClick={() => setActive(p.id)}
          >
            {p.kicker}
          </button>
        ))}
      </div>

      <div className="lp-panel" role="tabpanel">
        <div className="lp-panel-copy">
          <h3>{product.title}</h3>
          <p>{product.body}</p>
          <dl className="lp-example">
            {product.rows.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <Link className="lp-inline-link" href={`/app?at=${product.id}`}>
            Open in the desk <span aria-hidden>&rarr;</span>
          </Link>
        </div>

        <figure className="lp-preview">
          <Preview preview={product.preview} />
          <figcaption>{product.preview.caption}</figcaption>
        </figure>
      </div>
    </div>
  );
}
