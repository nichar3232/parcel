'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { EXAMPLES, Preview } from '@/lib/oddlot/landing';
import { PayoffGlyph } from './PayoffGlyph';

type Product = (typeof EXAMPLES)[number];

function PayoffPreview({
  preview,
}: {
  preview: Extract<Preview, { kind: 'payoff' }>;
}) {
  return <PayoffGlyph payoff={preview.payoff} className="lp-preview-chart" />;
}

function Preview({ preview }: { preview: Preview }) {
  if (preview.kind === 'payoff') return <PayoffPreview preview={preview} />;
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
 * One product at a time, laid out as a spread rather than a split.
 *
 * Five cards side by side made the reader compare things they had not
 * read yet. A tab picks one, and the panel gives it the room to say
 * what it does, what it costs, how it is held together, and what shape
 * it makes.
 *
 * The composition is deliberately uneven. Two equal columns give every
 * element the same weight, which means the reader has to work out the
 * order themselves — so the lede and the plot share the top on a 6/6,
 * the one figure worth reading first is set large under the lede with
 * the terms beside it, and the three mechanics run the full width in a
 * staircase of uneven columns. Nothing below the lede starts on the
 * same line as anything else.
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

      <div className="lp-panel" role="tabpanel" key={product.id}>
        <div className="lp-panel-lede">
          <h3>{product.title}</h3>
          <p>{product.body}</p>
        </div>

        <figure className="lp-preview">
          <Preview preview={product.preview} />
          <figcaption>{product.preview.caption}</figcaption>
        </figure>

        <div className="lp-panel-pull">
          <b>{product.pull.value}</b>
          <span>{product.pull.label}</span>
          <Link className="lp-inline-link" href={`/app?at=${product.id}`}>
            Open in the desk <span aria-hidden>&rarr;</span>
          </Link>
        </div>

        <dl className="lp-example">
          {product.rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>

        <ol className="lp-mechanics">
          {product.mechanics.map((m, i) => (
            <li key={m.title}>
              <b>{String(i + 1).padStart(2, '0')}</b>
              <strong>{m.title}</strong>
              <p>{m.detail}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
