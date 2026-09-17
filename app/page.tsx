import Link from 'next/link';
import { Mark } from '@/components/brand/Mark';
import { Showcase } from '@/components/brand/Showcase';
import { Steps } from '@/components/brand/Steps';
import { StructureHero } from '@/components/brand/StructureHero';
import { ThemeToggle } from '@/components/brand/Theme';
import { EXAMPLES, HERO } from '@/lib/oddlot/landing';
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
 * The desk's own state, printed as a status rail.
 *
 * Four figures the product actually runs on, in the order a trader
 * would read them. It replaces the row of adjectives that used to sit
 * here, which said nothing a reader could check.
 */
const RAIL = [
  ['Reference', `NVDA ${HERO.spotLabel}`],
  ['Session', HERO.openLabel],
  ['Model vol', '45%'],
  ['Minimum size', '0.000001 share'],
];

export default function Landing() {
  return (
    <div className="lp">
      <div className="pc-aurora" aria-hidden>
        <i />
        <i />
        <i />
      </div>

      <header className="lp-nav">
        <Link className="lp-mark" href="/">
          <Mark size={24} />
          <b>PARCEL</b>
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
            How it works
          </a>
          <ThemeToggle />
          <Link className="lp-cta" href="/app">
            Open the desk
          </Link>
        </div>
      </header>

      <main className="lp-main">
        <section className="lp-hero">
          <div className="lp-hero-copy">
            <span className="lp-kicker">Options, by the share</span>
            <h1>
              Every options structure,
              <em> sized to one share</em>
            </h1>
            <p>
              A listed contract needs a hundred shares. Parcel writes the same
              spreads, collars, covered calls and protective puts against a
              fraction of one, fully collateralized in USDC and settled back
              into your own vault.
            </p>
            <div className="lp-hero-actions">
              <Link className="lp-btn lp-btn-primary" href="/app">
                Open the desk
                <span aria-hidden>&rarr;</span>
              </Link>
              <a className="lp-btn lp-btn-quiet" href="#products">
                See the five products
              </a>
            </div>
          </div>

          <StructureHero />
        </section>

        <div className="lp-rail">
          {RAIL.map(([k, v]) => (
            <div key={k}>
              <span>{k}</span>
              <b>{v}</b>
            </div>
          ))}
        </div>

        <section className="lp-section" id="products">
          <div className="lp-section-head">
            <span className="lp-kicker">The products</span>
            <h2>Five ways to use one vault</h2>
          </div>
          <Showcase products={EXAMPLES} />
        </section>

        <section className="lp-section lp-how" id="how">
          <Steps>
            <span className="lp-kicker">How it works</span>
            <h2>Deposit, position, settle.</h2>
            <p>
              All five products run on one vault and one collateral rule. Every
              position is funded from assets you already hold, and nothing is
              borrowed on your behalf.
            </p>
            <Link className="lp-btn lp-btn-primary" href="/app">
              Open the desk
              <span aria-hidden>&rarr;</span>
            </Link>
          </Steps>
        </section>

        <section className="lp-close">
          <div>
            <h2>Open the desk</h2>
            <p>
              A funded vault, live model pricing and the full contract workflow.
              Nothing to install and no wallet to connect.
            </p>
          </div>
          <Link className="lp-btn lp-btn-primary" href="/app">
            Launch Parcel
            <span aria-hidden>&rarr;</span>
          </Link>
        </section>
      </main>

      <footer className="lp-foot">
        <Link className="lp-mark" href="/">
          <Mark size={20} />
          <b>PARCEL</b>
        </Link>
        <nav aria-label="Footer">
          <Link href="/app">Desk</Link>
          <a href="#products">Products</a>
          <a
            href="https://github.com/nichar3232/parcel"
            target="_blank"
            rel="noreferrer"
          >
            Repository
          </a>
        </nav>
      </footer>
    </div>
  );
}
