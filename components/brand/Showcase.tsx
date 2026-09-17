'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { EXAMPLES, Preview } from '@/lib/parcel/landing';

type Product = (typeof EXAMPLES)[number];

function PayoffPreview({
  preview,
}: {
  preview: Extract<Preview, { kind: 'payoff' }>;
}) {
  const p = preview.payoff;
  return (
    <svg viewBox="0 0 760 240" className="lp-preview-chart">
      <title>Payoff at expiry</title>
      <defs>
        <linearGradient id="lpShowFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--accent)" stopOpacity=".3" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {p.strikes.map((k) => (
        <line
          key={k.value}
          x1={k.x}
          x2={k.x}
          y1="24"
          y2="208"
          className="lp-strike"
        />
      ))}
      <path d={p.area} fill="url(#lpShowFill)" />
      <line x1="40" x2="720" y1={p.zeroY} y2={p.zeroY} className="lp-grid" />
      <path d={p.line} className="lp-line" />
      {p.strikes.map((k) => (
        <text
          key={k.value}
          x={k.x}
          y="224"
          className="lp-strike-label"
          textAnchor="middle"
        >
          ${k.value}
        </text>
      ))}
    </svg>
  );
}

function Preview({ preview }: { preview: Preview }) {
  if (preview.kind === 'payoff')
    return (
      <>
        <PayoffPreview preview={preview} />
        <div className="lp-axis">
          {preview.payoff.axis.map((a) => (
            <span key={a}>{a}</span>
          ))}
        </div>
      </>
    );
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
