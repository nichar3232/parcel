import Link from 'next/link';
import { LandingNav } from '@/components/brand/LandingNav';
import { Mark } from '@/components/brand/Mark';
import { Showcase } from '@/components/brand/Showcase';
import { Steps } from '@/components/brand/Steps';
import { StructureHero } from '@/components/brand/StructureHero';
import { ThemeToggle } from '@/components/brand/Theme';
import { EXAMPLES } from '@/lib/parcel/landing';
import './landing.css';

/** The nav opens each product in the desk; the tabs below preview it. */
const PRODUCTS = [
  { name: 'Options', href: '/app?at=options' },
  { name: 'Underwriting', href: '/app?at=underwriting' },
  { name: 'Structures', href: '/app?at=structures' },
  { name: 'Pre-IPO', href: '/app?at=pre-ipo' },
  { name: 'Lending', href: '/app?at=lending' },
];

const PRINCIPLES = [
  {
    title: 'Size to your position',
    detail:
      'Open from one-millionth of a share. Premiums and payoffs are quoted per share throughout.',
  },
  {
    title: 'Reserve first',
    detail:
      'Cash or stock is committed before a position opens, so the terms remain fully funded.',
  },
  {
    title: 'Settle to the same vault',
    detail:
      'Premiums, collateral and expiry proceeds return to the vault that holds the position.',
  },
];

export default function Landing() {
  return (
    <div className="lp">
      <div className="pc-aurora" aria-hidden>
        <i />
        <i />
        <i />
      </div>

      <LandingNav>
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
      </LandingNav>

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
            </div>
          </div>

          <StructureHero />
        </section>

        <section className="lp-principles" aria-labelledby="principles-title">
          <div className="lp-principles-intro">
            <span className="lp-kicker">The Parcel model</span>
            <h2 id="principles-title">One vault. Defined terms.</h2>
            <p>
              The unit, collateral and settlement path stay consistent from
              quote through expiry.
            </p>
          </div>
          <ol className="lp-principles-list">
            {PRINCIPLES.map((principle, index) => (
              <li key={principle.title}>
                <b>{String(index + 1).padStart(2, '0')}</b>
                <div>
                  <strong>{principle.title}</strong>
                  <p>{principle.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

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
            <h2>Four steps, one vault</h2>
          </Steps>
        </section>
      </main>

      <div className="lp-ending">
        <section className="lp-close" aria-labelledby="desk-title">
          <div className="lp-close-copy">
            <h2 id="desk-title">Deposit, position, settle.</h2>
            <p>
              All five products run on one vault and one collateral rule. Every
              position is funded from assets you already hold, and nothing is
              borrowed on your behalf.
            </p>
            <Link className="lp-btn lp-btn-primary" href="/app">
              Launch Parcel
              <span aria-hidden>&rarr;</span>
            </Link>
          </div>
        </section>

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
    </div>
  );
}
