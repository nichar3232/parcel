'use client';
import Link from 'next/link';
import { useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  ChevronDown,
  CircleHelp,
  Compass,
  Layers3,
  Landmark,
  Menu,
  ShieldCheck,
  SlidersHorizontal,
  Wallet,
  X,
} from 'lucide-react';
import { useVault } from '@/hooks/oddlot/use-vault';
import { GuidedFlow } from '@/components/oddlot/consumer/GuidedFlow';
import type { ExploreDraft } from '@/lib/oddlot/explore';
import { VaultView } from '@/components/oddlot/VaultView';
import { OptionsView } from '@/components/oddlot/OptionsView';
import { LendingView } from '@/components/oddlot/LendingView';
import { RiskView } from '@/components/oddlot/RiskView';
import { ActivityView } from '@/components/oddlot/ActivityView';
import {
  Badge,
  Button,
  Field,
  Modal,
  dateLabel,
  qty,
  usd,
} from '@/components/oddlot/shared';
import '@/app/oddlot.css';
import '@/app/theme.css';
import '@/app/flow.css';
const navigation = [
  { name: 'Build', icon: Compass },
  { name: 'Vault', icon: Wallet },
  { name: 'Trade', icon: ArrowUpRight },
  { name: 'Underwrite', icon: Landmark },
  { name: 'Structures', icon: Layers3 },
  { name: 'Lending', icon: SlidersHorizontal },
  { name: 'Risk', icon: ShieldCheck },
  { name: 'Activity', icon: Activity },
];
export default function Workspace() {
  const desk = useVault(),
    [page, setPage] = useState('Build'),
    [launch, setLaunch] = useState<{
      page: string;
      draft: ExploreDraft;
      id: number;
    } | null>(null),
    [mobile, setMobile] = useState(false),
    [modal, setModal] = useState<'market' | 'wallet' | 'about' | null>(null),
    [nextDate, setNextDate] = useState('');
  const navigate = (value: string) => {
    setLaunch(null);
    setPage(value);
    setMobile(false);
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    });
  };
  const s = desk.state;
  const future = s?.market.dates.filter((d) => d > s.book.date) || [];
  const target = future.includes(nextDate) ? nextDate : future[0] || '';
  return (
    <div className="oddlot" data-ready={!!s}>
      <a className="od-skip" href="#workspace">
        Skip to workspace
      </a>
      {mobile && (
        <button
          className="od-mobile-scrim"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <header className="od-appbar">
        <button className="od-brand" onClick={() => navigate('Build')}>
          <span className="od-brand-symbol">
            <i />
            <i />
            <i />
          </span>
          ODDLOT
        </button>
        <button
          className="od-mobile-menu od-icon-button"
          aria-label="Open navigation"
          onClick={() => setMobile(true)}
        >
          <Menu size={21} />
        </button>
        <aside className={`od-sidebar ${mobile ? 'open' : ''}`}>
          <nav aria-label="Main navigation">
            {navigation.map(({ name, icon: Icon }) => (
              <button
                className={`od-nav-item ${page === name ? 'active' : ''}`}
                key={name}
                aria-current={page === name ? 'page' : undefined}
                onClick={() => navigate(name)}
              >
                <Icon size={17} />
                <span>{name}</span>
              </button>
            ))}
          </nav>
          <div className="od-nav-bottom">
            <button onClick={() => setModal('about')}>
              <CircleHelp size={16} />
              How Oddlot works
            </button>
            <a
              href="https://github.com/nichar3232/oddlot"
              target="_blank"
              rel="noreferrer"
            >
              Project repository
              <ArrowUpRight size={15} />
            </a>
          </div>
        </aside>
        <div className="od-topbar-actions">
          <span className="od-environment">
            <i />
            {s?.mode === 'localnet' ? 'LOCALNET' : 'SANDBOX'}
          </span>
          <button
            className="od-market-button"
            onClick={() => setModal('market')}
            disabled={!s}
          >
            <i />
            <span>
              {s ? `${dateLabel(s.book.date)} · Historical` : 'Connecting'}
            </span>
            <ChevronDown size={13} />
          </button>
          <button
            className="od-wallet-button"
            onClick={() => setModal('wallet')}
            disabled={!s}
          >
            <Wallet size={16} />
            <span>Test wallet</span>
            <ChevronDown size={13} />
          </button>
        </div>
      </header>
      <div className="od-workspace">
        <main id="workspace" className="od-main" tabIndex={-1}>
          {desk.error && (
            <div role="alert" className="od-connection-error">
              <div>
                <b>We couldn’t connect to your saved vault.</b>
                <p>{desk.error}</p>
              </div>
              <Button variant="secondary" onClick={() => void desk.refresh()}>
                Reconnect
              </Button>
            </div>
          )}
          {desk.pending && !desk.busy && (
            <div role="alert" className="od-connection-error">
              <div>
                <b>A saved action needs confirmation.</b>
                <p>
                  Resolve it using its original receipt before making another
                  change.
                </p>
              </div>
              <Button variant="secondary" onClick={() => void desk.recover()}>
                Resolve saved action
              </Button>
            </div>
          )}
          {!s ? (
            <output className="od-loading">
              <span className="od-loading-ring" />
              <h1>Opening your vault</h1>
              <p>Connecting to your saved balances and collateral.</p>
            </output>
          ) : (
            <>
              {page === 'Build' && (
                <GuidedFlow
                  key={s.csrf.slice(0, 16)}
                  desk={desk}
                  navigate={navigate}
                  openDraft={(destination, draft) => {
                    setLaunch({ page: destination, draft, id: Date.now() });
                    setPage(destination);
                    window.scrollTo({
                      top: 0,
                      behavior: window.matchMedia(
                        '(prefers-reduced-motion: reduce)',
                      ).matches
                        ? 'auto'
                        : 'smooth',
                    });
                  }}
                />
              )}
              {page === 'Vault' && (
                <VaultView desk={desk} navigate={navigate} />
              )}{' '}
              {page === 'Trade' && (
                <OptionsView
                  key={`trade:${launch?.id || 0}`}
                  initialDraft={
                    launch?.page === page ? launch.draft : undefined
                  }
                  desk={desk}
                  mode="trade"
                />
              )}
              {page === 'Underwrite' && (
                <OptionsView
                  key={`underwrite:${launch?.id || 0}`}
                  initialDraft={
                    launch?.page === page ? launch.draft : undefined
                  }
                  desk={desk}
                  mode="underwrite"
                />
              )}
              {page === 'Structures' && (
                <OptionsView
                  key={`structures:${launch?.id || 0}`}
                  initialDraft={
                    launch?.page === page ? launch.draft : undefined
                  }
                  desk={desk}
                  mode="structures"
                />
              )}
              {page === 'Lending' && <LendingView desk={desk} />}{' '}
              {page === 'Risk' && <RiskView desk={desk} />}{' '}
              {page === 'Activity' && <ActivityView desk={desk} />}
            </>
          )}
        </main>
        <footer className="od-footer">
          <span>Oddlot · Precision for every position.</span>
          <span>
            Test assets ·{' '}
            {s?.mode === 'localnet'
              ? 'Solana local validator'
              : 'Persistent sandbox vault'}{' '}
            · No real funds
          </span>
        </footer>
      </div>
      {desk.toast && (
        <output className="od-toast">
          <ShieldCheck size={17} />
          <span>{desk.toast}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => desk.setToast('')}
          >
            <X size={16} />
          </button>
        </output>
      )}
      {modal === 'market' && s && (
        <Modal
          title="Market controls"
          description="Advance the test clock. Hourly ticks carry forward the committed daily close; they are not historical intraday prices."
          onClose={() => setModal(null)}
        >
          <div className="od-review-line">
            <span>Current session</span>
            <b>
              {s.book.date} · {usd(s.market.price)}
            </b>
          </div>
          {!!future.length && (
            <Field label="Advance to session">
              <select
                value={target}
                onChange={(e) => setNextDate(e.target.value)}
              >
                {future
                  .filter(
                    (d) =>
                      !d.includes('T') ||
                      Date.parse(d) - Date.parse(s.book.date) <= 24 * 3600000,
                  )
                  .map((d) => (
                    <option value={d} key={d}>
                      {dateLabel(d)}
                    </option>
                  ))}
              </select>
            </Field>
          )}
          <p className="od-form-note">
            Advancing is permanent for this session. Due contracts settle
            together, term loans return shares, and protected shorts repay
            automatically. The backend uses each contract’s exact stored expiry
            price.
          </p>
          <Button
            disabled={desk.busy || !target}
            onClick={() => {
              void desk.act({ type: 'advance', date: target }).then((ok) => {
                if (ok) setModal(null);
              });
            }}
          >
            Advance & settle due positions
          </Button>
          {!future.length && (
            <>
              <p className="od-form-note">
                The historical window is complete. Restart restores test
                allocations and returns to January 24. Previous receipts remain
                recorded.
              </p>
              <Button
                disabled={desk.busy}
                onClick={() => {
                  void desk.act({ type: 'restart' }).then((ok) => {
                    if (ok) setModal(null);
                  });
                }}
              >
                Restart historical replay
              </Button>
            </>
          )}
        </Modal>
      )}
      {modal === 'wallet' && s && (
        <Modal
          title="Your test wallet"
          description="An isolated funding wallet for this browser session."
          onClose={() => setModal(null)}
        >
          <div className="od-review-line">
            <span>Available test USDC</span>
            <b>{usd(s.book.wallet.USDC)}</b>
          </div>
          <div className="od-review-line">
            <span>Available test NVDA</span>
            <b>{qty(s.book.wallet.NVDA)} shares</b>
          </div>
          <p className="od-form-note">
            Move these assets into your vault to trade or underwrite. The wallet
            and vault balances persist across reloads.{' '}
            {s.mode === 'localnet'
              ? 'SPL test tokens back the program-controlled vault. Test signing keys are held by this service.'
              : 'This session uses backend sandbox accounting.'}{' '}
            There is no connected brokerage.
          </p>
          <Button
            onClick={() => {
              setModal(null);
              navigate('Vault');
            }}
          >
            Go to vault deposits
          </Button>
        </Modal>
      )}
      {modal === 'about' && (
        <Modal
          title="Options, by the share."
          description="A unified workspace for granular options and fully assigned collateral."
          onClose={() => setModal(null)}
        >
          <p className="od-form-note">
            One contract represents one share-equivalent, with quantities as
            small as 0.000001 when the contract has a payable obligation. Cash
            and stock deposits fund underwriting, structured options, stock
            loans, and protected shorts. The backend checks both counterparties
            and refuses double-pledged assets.
          </p>
          <p className="od-form-note">
            {s?.mode === 'localnet'
              ? 'This session executes against the Oddlot Solana program on a private local validator. SPL test-token escrow backs its balances; the backend indexes confirmed results.'
              : 'This session executes in the persistent sandbox ledger. Onchain vault execution requires the separately configured Oddlot local-validator program.'}{' '}
            Historical stock prices and model option premiums are used in both
            modes.
          </p>
          <p className="od-form-note">
            Liquidity is provided by funded test counterparties. No external
            option buyer, stock borrower, or market maker is connected.
            Fractional sizing reduces dollar exposure; physical long calls still
            prefund strike cash plus premium. Cash-settled spreads offer bounded
            obligations with a different payoff.
          </p>
          <Link className="od-external" href="/legacy">
            Open Solana escrow desk <ArrowUpRight size={15} />
          </Link>
        </Modal>
      )}
    </div>
  );
}
