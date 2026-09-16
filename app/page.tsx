import Link from 'next/link';
import './landing.css';

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
            settled against a real vault.
          </p>
          <div className="lp-hero-actions">
            <Link className="lp-btn lp-btn-primary lp-btn-lg" href="/app">
              Build a position <span aria-hidden>&rarr;</span>
            </Link>
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
    </div>
  );
}
