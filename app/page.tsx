import Link from 'next/link';
import './landing.css';

const STEPS = [
  {
    n: '01',
    title: 'Pick an intent',
    body: 'Upside, downside, or income. Plain language first — the structure is chosen for you.',
  },
  {
    n: '02',
    title: 'Size it to you',
    body: 'A tenth of a share. A quarter. Any fraction down to six decimals. No 100-share lot.',
  },
  {
    n: '03',
    title: 'Read the trade-off',
    body: 'Move the price and watch both sides of the payoff before a dollar is committed.',
  },
  {
    n: '04',
    title: 'Fund and confirm',
    body: 'Collateral is pledged from your vault. The backend refuses double-pledged assets.',
  },
];

const FACTS = [
  { k: 'Minimum size', v: '0.000001', u: 'share-equivalents' },
  { k: 'Collateral check', v: 'Both', u: 'counterparties' },
  { k: 'Settlement', v: 'Cash', u: 'or physical' },
  { k: 'Escrow', v: 'Solana', u: 'SPL test tokens' },
];

export default function Landing() {
  return (
    <div className="lp">
      <header className="lp-nav">
        <span className="lp-mark">
          <i />
          <i />
          <i />
          Oddlot<b>.</b>
        </span>
        <nav>
          <a href="#problem">The problem</a>
          <a href="#how">How it works</a>
          <a href="#under">What&rsquo;s underneath</a>
        </nav>
        <Link className="lp-cta" href="/app">
          Open the desk <span aria-hidden>&rarr;</span>
        </Link>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-copy">
          <span className="lp-kicker">Options, by the share</span>
          <h1>
            An option contract is 100 shares.
            <br />
            <em>That is the whole problem.</em>
          </h1>
          <p>
            One NVDA call controls about $14,000 of stock. Oddlot writes the
            same contract against a quarter of a share — fully collateralized,
            settled against a real vault, priced off historical closes.
          </p>
          <div className="lp-hero-actions">
            <Link className="lp-btn lp-btn-primary" href="/app">
              Build a position <span aria-hidden>&rarr;</span>
            </Link>
            <a className="lp-btn" href="#how">
              See how it works
            </a>
          </div>
          <small className="lp-note">
            Test assets · sandbox vault · no real funds
          </small>
        </div>

        <figure className="lp-hero-figure" aria-hidden="true">
          <figcaption>
            <span>NVDA CALL SPREAD</span>
            <span>EXP FEB 7</span>
          </figcaption>
          <div className="lp-compare">
            <div className="lp-compare-row">
              <span className="lp-compare-label">Standard contract</span>
              <span className="lp-compare-bar">
                <i style={{ width: '100%' }} />
              </span>
              <span className="lp-compare-value">$14,262</span>
            </div>
            <div className="lp-compare-row is-ours">
              <span className="lp-compare-label">Oddlot, ¼ share</span>
              <span className="lp-compare-bar">
                <i style={{ width: '1.2%' }} />
              </span>
              <span className="lp-compare-value">$0.70</span>
            </div>
          </div>
          <div className="lp-figure-foot">
            <span>Premium at risk</span>
            <span>Same structure. Same expiry.</span>
          </div>
        </figure>
      </section>

      <section className="lp-facts" aria-label="Key facts">
        {FACTS.map((f) => (
          <div key={f.k}>
            <span>{f.k}</span>
            <strong>{f.v}</strong>
            <small>{f.u}</small>
          </div>
        ))}
      </section>

      <section className="lp-section" id="problem">
        <div className="lp-section-head">
          <span className="lp-kicker">The problem</span>
          <h2>Everyone is priced out of their own hedge.</h2>
        </div>
        <div className="lp-cols">
          <div>
            <h3>The lot size is the gate</h3>
            <p>
              Listed options move in 100-share blocks. If you hold twelve
              shares, there is no contract that fits you. You either over-hedge
              by eight times or you carry the risk naked.
            </p>
          </div>
          <div>
            <h3>Fractional shares never got options</h3>
            <p>
              Brokers solved fractional stock a decade ago. The derivative on
              top of it never followed, so the people most exposed to a single
              position have the fewest tools.
            </p>
          </div>
          <div>
            <h3>&ldquo;Collateralized&rdquo; usually is not</h3>
            <p>
              Oddlot assigns every obligation to a specific pledged asset and
              refuses to pledge the same share twice. Both sides are checked
              before a contract exists.
            </p>
          </div>
        </div>
      </section>

      <section className="lp-section lp-section-dark" id="how">
        <div className="lp-section-head">
          <span className="lp-kicker">How it works</span>
          <h2>Four steps, in order.</h2>
        </div>
        <ol className="lp-steps">
          {STEPS.map((s) => (
            <li key={s.n}>
              <span className="lp-step-n">{s.n}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="lp-section" id="under">
        <div className="lp-section-head">
          <span className="lp-kicker">What&rsquo;s underneath</span>
          <h2>The accounting is the product.</h2>
        </div>
        <div className="lp-cols">
          <div>
            <h3>A real vault, not a balance</h3>
            <p>
              Deposits, collateral reservations and settlements are recorded in
              a transactional ledger. Clearing browser storage cannot change
              what you own.
            </p>
          </div>
          <div>
            <h3>Onchain escrow</h3>
            <p>
              In local-validator mode, contracts execute against the Oddlot
              Solana program with SPL test-token escrow backing each vault
              balance.
            </p>
          </div>
          <div>
            <h3>Historical replay</h3>
            <p>
              Positions settle against committed NVDA daily closes from a
              retained, hash-verified dataset. Expiry prices cannot be edited
              after the fact.
            </p>
          </div>
        </div>
      </section>

      <section className="lp-close">
        <h2>Start with a quarter of a share.</h2>
        <p>Nothing to install. Nothing at risk.</p>
        <Link className="lp-btn lp-btn-primary lp-btn-lg" href="/app">
          Open the desk <span aria-hidden>&rarr;</span>
        </Link>
      </section>

      <footer className="lp-foot">
        <span>Oddlot · Precision for every position.</span>
        <span>
          Test assets · sandbox vault · no real funds ·{' '}
          <a
            href="https://github.com/nichar3232/oddlot"
            target="_blank"
            rel="noreferrer"
          >
            Repository
          </a>
        </span>
      </footer>
    </div>
  );
}
