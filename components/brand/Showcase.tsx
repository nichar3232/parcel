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
 * Two columns. The words on the left: what it does, then the one
 * figure worth reading first. The evidence on the right: the shape it
 * makes, then the worked example. The three mechanics run the full
 * width beneath. An earlier version scattered these across a
 * twelve-column grid so that nothing lined up with anything, which
 * read as a layout that had broken rather than one that had been
 * chosen.
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
        <div className="lp-panel-copy">
          <div className="lp-panel-lede">
            <h3>{product.title}</h3>
            <p>{product.body}</p>
          </div>

          <div className="lp-panel-pull">
            <b>{product.pull.value}</b>
            <span>{product.pull.label}</span>
            <Link className="lp-inline-link" href={`/app?at=${product.id}`}>
              Open in the desk <span aria-hidden>&rarr;</span>
            </Link>
          </div>
        </div>

        {/* The shape and the terms that made it are one figure: the
            rows sit inside the plot's field under a hairline, rather
            than as a second block floating beneath it. */}
        <figure className="lp-preview">
          <Preview preview={product.preview} />
          <figcaption>{product.preview.caption}</figcaption>
          <dl className="lp-example">
            {product.rows.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </figure>

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
