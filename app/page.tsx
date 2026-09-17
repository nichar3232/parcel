import Link from 'next/link';
import { Mark } from '@/components/brand/Mark';
import { PositionPreview } from '@/components/brand/PositionPreview';
import { Showcase } from '@/components/brand/Showcase';
import { ThemeToggle } from '@/components/brand/Theme';
import { EXAMPLES, HERO } from '@/lib/parcel/landing';
import './landing.css';

/** The nav opens each product in the desk; the tabs below preview it. */
const PRODUCTS = [
  { name: 'Options', href: '/app?at=options' },
  { name: 'Underwriting', href: '/app?at=underwriting' },
  { name: 'Structures', href: '/app?at=structures' },
  { name: 'Pre-IPO', href: '/app?at=pre-ipo' },
  { name: 'Lending', href: '/app?at=lending' },
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
            Methodology
          </a>
          <span className="lp-nav-status">
            <i aria-hidden /> Sandbox
          </span>
          <ThemeToggle />
          <Link className="lp-cta" href="/app">
            Enter the desk
          </Link>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-copy">
          <span className="lp-kicker">Parcel / sandbox workspace</span>
          <h1>
            Options sized to <em>what you own</em>
          </h1>
          <p>
            A listed contract is built for a hundred shares. Parcel lets you
            model the same structures at share-equivalent precision, with
            collateral, downside and settlement obligations visible before you
            act.
          </p>
          <div className="lp-hero-cta">
            <div className="lp-hero-actions">
              <Link className="lp-btn lp-btn-primary" href="/app">
                Enter sandbox <span aria-hidden>&rarr;</span>
              </Link>
              <a className="lp-btn" href="#products">
                Explore products
              </a>
            </div>
            <ul className="lp-meta">
              <li>Fractional sizing</li>
              <li>Explicit collateral</li>
              <li>Historical NVDA replay</li>
            </ul>
          </div>
        </div>

        <PositionPreview />

        <a className="lp-scroll" href="#products" aria-label="See the products">
          <span>Explore the desk</span>
          <i aria-hidden />
        </a>
      </section>

      <section className="lp-foundations" aria-label="Parcel operating principles">
        <div className="lp-foundations-inner">
          <p>
            <span>Designed for position-level decisions.</span> Every model
            indication is tied to the same historical inputs and collateral
            rules used by the desk.
          </p>
          <dl>
            <div>
              <dt>01</dt>
              <dd>Server-authoritative ledger</dd>
            </div>
            <div>
              <dt>02</dt>
              <dd>Quoted before confirmation</dd>
            </div>
            <div>
              <dt>03</dt>
              <dd>Recoverable actions</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="lp-section" id="products">
        <div className="lp-section-inner lp-products">
          <div className="lp-section-head">
            <span className="lp-kicker">Product surfaces</span>
            <h2>Five ways to express a view. One accounting standard.</h2>
            <p>
              The examples are modelled from the stored NVDA close of{' '}
              {HERO.spotLabel} on {HERO.openLabel}. They are not live quotes.
            </p>
          </div>
          <Showcase products={EXAMPLES} />
        </div>
      </section>

      <section className="lp-section lp-how" id="how">
        <div className="lp-section-inner lp-how-inner">
          <div className="lp-section-copy">
            <span className="lp-kicker">How it works</span>
            <h2>A disciplined workflow for every position.</h2>
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
            <h2>Make the position explicit.</h2>
            <p>
            Explore the historical sandbox, inspect the full contract
            workflow, then review a fresh quote before any action.
            </p>
          <Link className="lp-btn lp-btn-primary" href="/app">
            Enter the desk <span aria-hidden>&rarr;</span>
          </Link>
        </div>
      </section>

      <footer className="lp-foot">
        <span>Parcel / Position infrastructure for the individual share.</span>
        <span>Sandbox model — Historical NVDA replay</span>
      </footer>
    </div>
  );
}
