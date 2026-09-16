import Link from 'next/link';
import { Mark } from '@/components/brand/Mark';
import { EXAMPLES, HERO } from '@/lib/oddlot/landing';
import './landing.css';

const PRODUCTS = [
  { name: 'Options', href: '#options' },
  { name: 'Underwriting', href: '#underwriting' },
  { name: 'Structures', href: '#structures' },
  { name: 'Pre-IPO', href: '#pre-ipo' },
  { name: 'Lending', href: '#lending' },
];

/**
 * The spine every product above shares. Written to hold for all five,
 * not for the options flow alone.
 */
const STEPS = [
  ['Fund a vault', 'Deposit USDC or shares. Balances persist across reloads.'],
  [
    'Pick a position',
    'An option, a structure, a covered call on a sponsor token, or a stock loan.',
  ],
  [
    'Size it to what you own',
    'Share-equivalents, a premium budget, a dollar sensitivity, or a share count.',
  ],
  [
    'Review the exact figures, then settle',
    'Premium, collateral and worst case before you sign; settlement returns to the same vault.',
  ],
];

export default function Landing() {
  return (
    <div className="lp">
      <header className="lp-nav">
        <Link className="lp-mark" href="/">
          <Mark size={22} />
          PARCEL
        </Link>
        <nav aria-label="Products">
          {PRODUCTS.map((p) => (
            <Link key={p.name} href={p.href}>
              {p.name}
            </Link>
          ))}
        </nav>
        <div className="lp-nav-right">
          <a className="lp-nav-about" href="#how">
            About
          </a>
          <span className="lp-env">
            <i /> SANDBOX
          </span>
          <Link className="lp-cta" href="/app">
            Open the desk
          </Link>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-copy">
          <span className="lp-kicker">Solana · Historical replay</span>
          <h1>
            Options sized to <em>what you own</em>
          </h1>
          <p>
            A listed contract needs a hundred shares. Parcel writes the same
            structures against a fraction of one: spreads, collars, covered
            calls, protective puts. Fully collateralized in USDC and settled
            against your vault.
          </p>
          <div className="lp-hero-cta">
            <div className="lp-hero-actions">
              <Link className="lp-btn lp-btn-primary" href="/app">
                Launch app <span aria-hidden>&rarr;</span>
              </Link>
              <a className="lp-btn" href="#products">
                Explore the products
              </a>
            </div>
            <ul className="lp-meta">
              <li>Fractional sizing</li>
              <li>USDC collateral</li>
              <li>Settled on Solana</li>
            </ul>
          </div>
        </div>

        <figure className="lp-card">
          <figcaption>
            <span className="lp-card-kicker">Position preview</span>
          </figcaption>
          <h2>
            {HERO.title}
            <small>
              {HERO.contract} · expires {HERO.expiryLabel}
            </small>
          </h2>
          <div className="lp-chart">
            <svg viewBox="0 0 760 240">
              <title>
                {`Payoff at expiry for ${HERO.title}, ${HERO.strikes.map((k) => `$${k}`).join(' / ')}`}
              </title>
              <defs>
                <linearGradient id="lpFill" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0"
                    stopColor="var(--accent)"
                    stopOpacity=".34"
                  />
                  <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
                </linearGradient>
              </defs>
              {HERO.strikeX.map((x, i) => (
                <line
                  key={HERO.strikes[i]}
                  x1={x}
                  x2={x}
                  y1="24"
                  y2="208"
                  className="lp-strike"
                />
              ))}
              <path d={HERO.area} fill="url(#lpFill)" />
              <line
                x1="40"
                x2="720"
                y1={HERO.zeroY}
                y2={HERO.zeroY}
                className="lp-grid"
              />
              <path d={HERO.line} className="lp-line" />
              {HERO.strikeX.map((x, i) => (
                <text
                  key={HERO.strikes[i]}
                  x={x}
                  y="222"
                  className="lp-strike-label"
                  textAnchor="middle"
                >
                  ${HERO.strikes[i]}
                </text>
              ))}
            </svg>
            <div className="lp-axis">
              {HERO.axis.map((a) => (
                <span key={a}>{a}</span>
              ))}
            </div>
          </div>
          <div className="lp-stats">
            {HERO.stats.map((s) => (
              <div key={s.k}>
                <span>{s.k}</span>
                <strong>{s.v}</strong>
              </div>
            ))}
          </div>
        </figure>

        <a className="lp-scroll" href="#products" aria-label="See the products">
          <span>See what it does</span>
          <i aria-hidden />
        </a>
      </section>

      <section className="lp-section" id="products">
        <div className="lp-section-inner lp-products">
          <div className="lp-section-head">
            <span className="lp-kicker">What the desk does</span>
            <h2>Five products, one collateral rule.</h2>
            <p>
              Every figure below is priced by the desk from the stored NVDA
              close of {HERO.spotLabel} on {HERO.openLabel}, not written by
              hand.
            </p>
          </div>
          <div className="lp-grid">
            {EXAMPLES.map((o) => (
              <article className="lp-tile" id={o.id} key={o.id}>
                <span className="lp-kicker">{o.kicker}</span>
                <h3>{o.title}</h3>
                <p>{o.body}</p>
                <dl className="lp-example">
                  {o.rows.map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
                <Link className="lp-inline-link" href={`/app?at=${o.id}`}>
                  Open in the desk <span aria-hidden>&rarr;</span>
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-section lp-how" id="how">
        <div className="lp-section-inner lp-how-inner">
          <div className="lp-section-copy">
            <span className="lp-kicker">How it works</span>
            <h2>The same four steps, whichever one you use.</h2>
            <p>
              All five products run on one vault and one collateral rule. Every
              position is fully funded from assets you already hold, and nothing
              is borrowed on your behalf.
            </p>
          </div>
          <ol className="lp-steps">
            {STEPS.map(([title, detail], i) => (
              <li key={title}>
                <b>{String(i + 1).padStart(2, '0')}</b>
                <div>
                  <strong>{title}</strong>
                  <span>{detail}</span>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="lp-section lp-close">
        <div className="lp-section-inner lp-close-inner">
          <h2>Open the desk.</h2>
          <p>
            A historical NVDA replay, a funded sandbox vault, and the full
            contract workflow.
          </p>
          <Link className="lp-btn lp-btn-primary" href="/app">
            Launch the desk <span aria-hidden>&rarr;</span>
          </Link>
        </div>
      </section>

      <footer className="lp-foot">
        <span>Parcel · Precision for every position.</span>
        <span>Historical replay · NVDA, Jan–Mar 2025</span>
      </footer>
    </div>
  );
}
