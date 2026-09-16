import Link from 'next/link';
import './landing.css';

const PRODUCTS = [
  { name: 'Portfolio', href: '/app' },
  { name: 'Options', href: '/app' },
  { name: 'Underwriting', href: '/app' },
  { name: 'Structures', href: '/app' },
  { name: 'Lending', href: '/app' },
];

const STATS = [
  { k: 'Premium', v: '$0.70' },
  { k: 'Size', v: '¼ share' },
  { k: 'Collateral', v: 'USDC' },
  { k: 'Settles', v: 'Solana' },
];

/** Payoff of the quarter-share call spread shown in the preview card. */
const CURVE = 'M 40 188 L 236 188 L 404 74 L 720 74';
const POINTS: [number, number][] = [
  [40, 188],
  [138, 188],
  [236, 188],
  [320, 131],
  [404, 74],
  [562, 74],
  [720, 74],
];

export default function Landing() {
  return (
    <div className="lp">
      <header className="lp-nav">
        <Link className="lp-mark" href="/">
          <span className="lp-mark-glyph">
            <i />
            <i />
            <i />
          </span>
          ODDLOT
        </Link>
        <nav aria-label="Products">
          {PRODUCTS.map((p) => (
            <Link key={p.name} href={p.href}>
              {p.name}
            </Link>
          ))}
          <a href="#how">About</a>
        </nav>
        <div className="lp-nav-right">
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
            Options sized to <em>what you actually own</em>
          </h1>
          <p>
            A listed contract needs a hundred shares. Oddlot writes the same
            structures — spreads, collars, covered calls, protective puts —
            against a fraction of one, fully collateralized in USDC and settled
            against your vault.
          </p>
          <div className="lp-hero-actions">
            <Link className="lp-btn lp-btn-primary" href="/app">
              Launch app <span aria-hidden>&rarr;</span>
            </Link>
            <Link className="lp-btn" href="/app">
              Explore the products
            </Link>
          </div>
          <ul className="lp-meta">
            <li>Fractional sizing</li>
            <li>USDC collateral</li>
            <li>Settled on Solana</li>
          </ul>
        </div>

        <figure className="lp-card" aria-hidden="true">
          <figcaption>
            <span className="lp-card-kicker">Position preview</span>
            <span className="lp-card-tag">
              <i /> Sample
            </span>
          </figcaption>
          <h2>NVDA call spread</h2>
          <div className="lp-chart">
            <svg viewBox="0 0 760 240" preserveAspectRatio="none">
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
              {[40, 114, 188].map((y) => (
                <line
                  key={y}
                  x1="40"
                  x2="720"
                  y1={y}
                  y2={y}
                  className="lp-grid"
                />
              ))}
              <path d={`${CURVE} L 720 188 L 40 188 Z`} fill="url(#lpFill)" />
              <path d={CURVE} className="lp-line" />
              {POINTS.map(([x, y]) => (
                <circle
                  key={`${x}-${y}`}
                  cx={x}
                  cy={y}
                  r="4"
                  className="lp-dot"
                />
              ))}
            </svg>
            <div className="lp-axis">
              <span>$93</span>
              <span>$143</span>
              <span>$193</span>
            </div>
          </div>
          <div className="lp-stats">
            {STATS.map((s) => (
              <div key={s.k}>
                <span>{s.k}</span>
                <strong>{s.v}</strong>
              </div>
            ))}
          </div>
        </figure>
      </section>
    </div>
  );
}
