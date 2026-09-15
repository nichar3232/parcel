'use client';
import { Clock, ExternalLink, Layers, Shield } from 'lucide-react';
export function AboutContent() {
  return (
    <>
      <div className="about-brand">
        strata<span>.</span>
      </div>
      <p>
        Stocks are arriving onchain. The tools around ownership still need to
        catch up. Strata brings defined-risk payoffs, counterparty funding, and
        settlement into one clear workspace.
      </p>
      <div className="novelty-list">
        <div>
          <Shield size={19} />
          <strong>Protection you can inspect</strong>
          <p>
            Exact terms, maximum loss, and fully funded payout reserves before
            acceptance.
          </p>
        </div>
        <div>
          <Clock size={19} />
          <strong>A bridge across market hours</strong>
          <p>
            Precommitted observations and explicit missing-data behavior. No
            caller-selected settlement price.
          </p>
        </div>
        <div>
          <Layers size={19} />
          <strong>A truthful capital map</strong>
          <p>
            Holdings, escrow and external debt stay distinct. Basis stress shows
            what a hedge leaves uncovered.
          </p>
        </div>
      </div>
      <p className="field-note">
        Hackathon demonstrator. Financing is read-only; stock lending is a
        product preview. Live equity oracles, issuer compatibility,
        corporate-action policies and contract review remain production gates.
      </p>
      <div className="source-links">
        <a
          href="https://hackathons.solana.com/hackathons/stocklana"
          target="_blank"
          rel="noreferrer"
        >
          Hackathon <ExternalLink size={12} />
        </a>
        <a href="https://docs.xstocks.fi/docs" target="_blank" rel="noreferrer">
          xStocks <ExternalLink size={12} />
        </a>
        <a href="https://docs.pyth.network/" target="_blank" rel="noreferrer">
          Pyth <ExternalLink size={12} />
        </a>
        <a
          href="https://kamino.com/docs/build/developers/borrow"
          target="_blank"
          rel="noreferrer"
        >
          Kamino <ExternalLink size={12} />
        </a>
      </div>
    </>
  );
}
