import Link from 'next/link';
import './landing.css';

const PRODUCTS = [
  { name: 'Options', href: '#options' },
  { name: 'Underwriting', href: '#underwriting' },
  { name: 'Structures', href: '#structures' },
  { name: 'Pre-IPO', href: '#pre-ipo' },
  { name: 'Lending', href: '#lending' },
];

/**
 * What the desk actually does, each with a figure taken from the app
 * rather than a claim about it.
 */
const OFFERINGS = [
  {
    id: 'options',
    kicker: 'Options',
    title: 'Buy a contract the size of your position.',
    body: 'A listed contract needs a hundred shares. Size to one, or to a quarter of one.',
    rows: [
      ['Buy 1× NVDA $145 call', 'Feb 7'],
      ['Premium', '$4.04'],
      ['Cash to fund exercise', '$149.04'],
    ],
  },
  {
    id: 'underwriting',
    kicker: 'Underwriting',
    title: 'Write the other side, fully collateralized.',
    body: 'Deposit a share, write a call against it. The reserve is visible before you sign.',
    rows: [
      ['Covered call on', '¼ share'],
      ['Premium received', 'kept either way'],
      ['Shares reserved', 'until expiry'],
    ],
  },
  {
    id: 'structures',
    kicker: 'Structures',
    title: 'Spreads, collars and capped curves.',
    body: 'Up to four legs under one collateral rule. Offsets release capital only when settlement allows.',
    rows: [
      ['Legs per contract', 'up to 4'],
      ['Collateral', 'cross or isolated'],
      ['Payoff', 'priced before you commit'],
    ],
  },
  {
    id: 'pre-ipo',
    kicker: 'Pre-IPO',
    title: 'Covered calls on sponsor tokens.',
    body: 'Every mint is read on chain first. A token the issuer can move out of escrow cannot back a contract.',
    rows: [
      ['Escrow', '0.25 T-OpenAI'],
      ['If exercised above $900', '231.50 USDC'],
      ['If it expires', '6.50 USDC'],
    ],
  },
  {
    id: 'lending',
    kicker: 'Lending',
    title: 'Lend stock against funded collateral.',
    body: 'The borrower posts cash and the full term’s interest up front. Pledged protection cannot be reused.',
    rows: [
      ['Lend', '1 NVDA'],
      ['Borrower posts', '$213.93'],
      ['Rate', '3.50% APR'],
    ],
  },
];

const STEPS = [
  ['Fund a vault', 'Deposit USDC or shares. Balances persist across reloads.'],
  [
    'Size the contract',
    'Choose share-equivalents, a premium budget, or a dollar sensitivity.',
  ],
  [
    'Review the exact figures',
    'Premium, collateral and worst-case delivery before anything is signed.',
  ],
  [
    'Settle against the vault',
    'Expiries settle together so collateral offsets survive.',
  ],
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
            Options sized to <em>what you own</em>
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

        <a className="lp-scroll" href="#options" aria-label="See the products">
          <span>See what it does</span>
          <i aria-hidden />
        </a>
      </section>

      {OFFERINGS.map((o) => (
        <section className="lp-section" id={o.id} key={o.id}>
          <div className="lp-section-inner">
            <div className="lp-section-copy">
              <span className="lp-kicker">{o.kicker}</span>
              <h2>{o.title}</h2>
              <p>{o.body}</p>
              <Link className="lp-inline-link" href="/app">
                Open in the desk <span aria-hidden>&rarr;</span>
              </Link>
            </div>
            <dl className="lp-example">
              {o.rows.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      ))}

      <section className="lp-section lp-how" id="how">
        <div className="lp-section-inner lp-how-inner">
          <div className="lp-section-copy">
            <span className="lp-kicker">How it works</span>
            <h2>Four steps, no hidden leverage.</h2>
            <p>
              Every contract is fully collateralized against your own vault.
              Nothing is borrowed on your behalf.
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
        <span>Oddlot · Precision for every position.</span>
        <span>Historical replay · NVDA, Jan–Mar 2025</span>
      </footer>
    </div>
  );
}
