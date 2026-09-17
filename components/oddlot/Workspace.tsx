'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  ChevronDown,
  CircleHelp,
  Layers,
  Plus,
  Rocket,
  ShieldCheck,
  SlidersHorizontal,
  Wallet,
  X,
} from 'lucide-react';
import { Mark } from '@/components/brand/Mark';
import { ThemeToggle } from '@/components/brand/Theme';
import { useVault } from '@/hooks/oddlot/use-vault';
import { useFlash, useMarks } from '@/hooks/oddlot/use-marks';
import { PortfolioView, type PortfolioTab } from './PortfolioView';
import { TradeView, type TradeTab } from './TradeView';
import { LendingView, type LendingTab } from './LendingView';
import { PreIpoView, type PreIpoTab } from './PreIpoView';
import { TransferDialog, type Transfer } from './TransferDialog';
import { Welcome, markWelcomeSeen, welcomeSeen } from './Welcome';
import {
  Button,
  Field,
  Line,
  Modal,
  Segmented,
  Tabs,
  dateLabel,
  qty,
  usd,
} from './shared';
import '@/app/desk.css';

const NAV = [
  { name: 'Portfolio', icon: Layers },
  { name: 'Trade', icon: ArrowUpRight },
  { name: 'Pre-IPO', icon: Rocket },
  { name: 'Lending', icon: SlidersHorizontal },
] as const;

type Page = (typeof NAV)[number]['name'];

/**
 * Every view's own tabs, declared in one place.
 *
 * The shell draws the tab strip rather than each view drawing its own,
 * which is the fix for four screens that each had a different control
 * at a different height in a different position. A view receives the
 * tab it should render and nothing else.
 */
const TABS = {
  Portfolio: [
    { id: 'overview', label: 'Overview' },
    { id: 'positions', label: 'Positions' },
    { id: 'collateral', label: 'Collateral' },
    { id: 'activity', label: 'Activity' },
  ],
  Trade: [
    { id: 'trade', label: 'Trade' },
    { id: 'underwrite', label: 'Underwrite' },
    { id: 'structures', label: 'Structures' },
  ],
  'Pre-IPO': [
    { id: 'market', label: 'Market' },
    { id: 'underwrite', label: 'Underwrite' },
  ],
  Lending: [
    { id: 'markets', label: 'Markets' },
    { id: 'borrow', label: 'Borrow & short' },
    { id: 'positions', label: 'Positions' },
  ],
} as const;

/**
 * Where a link from the landing page should land.
 *
 * Read after mount, never as initial state. Seeding state from the URL
 * makes the client's first render disagree with the server's, and React
 * does not repair attribute mismatches while hydrating. Resolving it on
 * the server is not open either: /app is prerendered to a static file,
 * and reading searchParams makes the route dynamic, which removes that
 * file and drops the route through to the landing page.
 */
const ENTRY: Record<string, { page: Page; tab?: string }> = {
  portfolio: { page: 'Portfolio' },
  positions: { page: 'Portfolio', tab: 'positions' },
  options: { page: 'Trade', tab: 'trade' },
  trade: { page: 'Trade', tab: 'trade' },
  underwriting: { page: 'Trade', tab: 'underwrite' },
  structures: { page: 'Trade', tab: 'structures' },
  'pre-ipo': { page: 'Pre-IPO' },
  lending: { page: 'Lending' },
};

export default function Workspace() {
  const desk = useVault();
  const feed = useMarks();
  /**
   * Which view is open, which tab within it, and whether the
   * walkthrough is up.
   *
   * One object rather than three states, because all three are decided
   * together by the same single read of the URL after hydration, and
   * three separate setState calls in that effect are three cascading
   * renders for one decision.
   */
  const [ui, setUi] = useState<{
    page: Page;
    tab: Record<string, string>;
    welcome: boolean;
  }>({ page: 'Portfolio', tab: {}, welcome: false });
  const [advanced, setAdvanced] = useState(false);
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [modal, setModal] = useState<'market' | 'wallet' | 'about' | null>(null);
  const [nextDate, setNextDate] = useState('');

  useEffect(() => {
    const at = new URLSearchParams(window.location.search).get('at');
    const entry = (at && ENTRY[at.toLowerCase()]) || null;
    const welcome = !welcomeSeen();
    if (!entry && !welcome) return;
    // The URL and localStorage are external systems, and this reads
    // both of them once, after hydration — the one shape the rule
    // cannot express. Resolving it during render instead would make the
    // client's first paint disagree with the server's, and React does
    // not repair attribute mismatches while hydrating.
    // oxlint-disable-next-line react/react-compiler
    setUi((current) => ({
      page: entry?.page ?? current.page,
      tab: entry?.tab
        ? { ...current.tab, [entry.page]: entry.tab }
        : current.tab,
      welcome,
    }));
  }, []);

  const page = ui.page;
  const setWelcome = (open: boolean) =>
    setUi((current) => ({ ...current, welcome: open }));
  const setTab = (next: string) =>
    setUi((current) => ({
      ...current,
      tab: { ...current.tab, [current.page]: next },
    }));

  const s = desk.state;
  const nvda = feed.marks.NVDA;
  const flash = useFlash(nvda?.price ?? 0);
  const current = ui.tab[page] || TABS[page][0].id;

  const navigate = (next: Page, to?: string) => {
    setUi((view) => ({
      ...view,
      page: next,
      tab: to ? { ...view.tab, [next]: to } : view.tab,
    }));
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    });
  };

  const future = s?.market.dates.filter((d) => d > s.book.date) || [];
  const target = future.includes(nextDate) ? nextDate : future[0] || '';
  const walletValue = s
    ? s.book.wallet.USDC + s.book.wallet.NVDA * s.market.price
    : 0;

  return (
    <div className="pc-desk" data-ready={!!s}>
      <div className="pc-aurora" aria-hidden>
        <i />
        <i />
        <i />
      </div>

      <a className="od-skip" href="#workspace">
        Skip to workspace
      </a>

      <header className="od-bar">
        <Link className="od-brand" href="/" aria-label="Parcel home">
          <Mark size={22} />
          <b>PARCEL</b>
        </Link>

        <nav className="od-nav" aria-label="Main navigation">
          {NAV.map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={`od-nav-item ${page === name ? 'active' : ''}`}
              aria-current={page === name ? 'page' : undefined}
              onClick={() => navigate(name)}
            >
              <Icon size={16} />
              <span>{name}</span>
            </button>
          ))}
        </nav>

        <div className="od-bar-right">
          {nvda && (
            <div
              className="od-ticker"
              title={
                nvda.source === 'simulated'
                  ? 'Simulated tick. No fresh observation from a venue.'
                  : `Live from ${nvda.source}`
              }
            >
              <i
                className={`od-live ${nvda.source === 'simulated' ? 'stale' : 'beat'}`}
              />
              <em>NVDA</em>
              <b data-flash={flash || undefined}>{usd(nvda.price)}</b>
              <s className={nvda.change >= 0 ? 'up' : 'down'}>
                {nvda.change >= 0 ? '+' : ''}
                {(nvda.change * 100).toFixed(2)}%
              </s>
            </div>
          )}

          <button
            className="od-bar-btn accent"
            onClick={() => setTransfer({ asset: 'NVDA', direction: 'deposit' })}
            disabled={!s}
          >
            <Plus size={15} />
            <span className="wide">Deposit</span>
          </button>

          <button
            className="od-bar-btn"
            onClick={() => setModal('wallet')}
            disabled={!s}
          >
            <Wallet size={15} />
            <b>{s ? usd(walletValue, 0) : '—'}</b>
            <ChevronDown size={13} />
          </button>

          <button
            className="od-bar-btn"
            onClick={() => setModal('market')}
            disabled={!s}
          >
            <span className="wide">
              {s ? dateLabel(s.book.date) : 'Connecting'}
            </span>
            <ChevronDown size={13} />
          </button>

          <ThemeToggle />
        </div>
      </header>

      <div className="od-subbar">
        <Tabs
          label={`${page} sections`}
          options={TABS[page] as unknown as { id: string; label: string }[]}
          value={current}
          onChange={setTab}
        />
        <div className="od-subbar-right">
          {(page === 'Trade' || page === 'Pre-IPO') && (
            <Segmented
              label="Detail level"
              size="sm"
              value={advanced ? 'advanced' : 'basic'}
              onChange={(v) => setAdvanced(v === 'advanced')}
              options={[
                { id: 'basic', label: 'Basic', hint: 'One decision at a time' },
                {
                  id: 'advanced',
                  label: 'Advanced',
                  hint: 'Legs, Greeks and the full surface',
                },
              ]}
            />
          )}
          <button className="od-bar-btn" onClick={() => setModal('about')}>
            <CircleHelp size={15} />
            <span className="wide">How it works</span>
          </button>
        </div>
      </div>

      <main id="workspace" className="od-main" tabIndex={-1}>
        {desk.error && (
          <div role="alert" className="od-alert">
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
          <div role="alert" className="od-alert">
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
        ) : page === 'Portfolio' ? (
          <PortfolioView
            desk={desk}
            feed={feed}
            tab={current as PortfolioTab}
            navigate={navigate}
            onTransfer={setTransfer}
          />
        ) : page === 'Trade' ? (
          <TradeView
            desk={desk}
            feed={feed}
            tab={current as TradeTab}
            advanced={advanced}
          />
        ) : page === 'Pre-IPO' ? (
          <PreIpoView
            feed={feed}
            tab={current as PreIpoTab}
            advanced={advanced}
          />
        ) : (
          <LendingView desk={desk} feed={feed} tab={current as LendingTab} />
        )}
      </main>

      <footer className="od-foot">
        <span>Parcel — precision for every position</span>
        <span>
          {feed.connected
            ? 'Live marks from Coinbase and Pyth, simulated where no venue publishes'
            : 'Simulated marks, no venue reachable'}
        </span>
      </footer>

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

      {ui.welcome && (
        <Welcome
          onClose={() => {
            markWelcomeSeen();
            setWelcome(false);
          }}
        />
      )}

      {transfer && s && (
        <TransferDialog
          desk={desk}
          transfer={transfer}
          onClose={() => setTransfer(null)}
        />
      )}

      {modal === 'market' && s && (
        <Modal
          title="Market controls"
          description="Advance the settlement clock. Hourly ticks carry forward the committed daily close; they are not historical intraday prices."
          onClose={() => setModal(null)}
        >
          <div className="od-lines">
            <Line
              label="Current session"
              value={`${s.book.date}  ${usd(s.market.price)}`}
            />
            {nvda && (
              <Line
                label="Live mark"
                value={`${usd(nvda.price)} (${nvda.source})`}
                tone="muted"
              />
            )}
          </div>
          <p className="od-note">
            Quotes and settlement use the session close so a contract can be
            reproduced from the ledger. The live mark drives the tape, the
            chain’s indicative prices and the pre-IPO valuations.
          </p>
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
          <p className="od-note">
            Advancing is permanent for this session. Due contracts settle
            together, term loans return shares, and protected shorts repay
            automatically.
          </p>
          <Button
            full
            disabled={desk.busy || !target}
            onClick={() => {
              void desk.act({ type: 'advance', date: target }).then((ok) => {
                if (ok) setModal(null);
              });
            }}
          >
            Advance &amp; settle due positions
          </Button>
          {!future.length && (
            <>
              <p className="od-note">
                The historical window is complete. Restart restores test
                allocations and returns to January 24. Previous receipts remain
                recorded.
              </p>
              <Button
                full
                variant="secondary"
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
          title="Your wallet"
          description="An isolated funding wallet for this browser session."
          onClose={() => setModal(null)}
        >
          <div className="od-lines">
            <Line label="Available USDC" value={usd(s.book.wallet.USDC)} />
            <Line
              label="Available NVDA"
              value={`${qty(s.book.wallet.NVDA)} shares`}
            />
            <Line
              label="In the vault"
              value={usd(
                s.book.vault.USDC + s.book.vault.NVDA * s.market.price,
              )}
              tone="muted"
            />
          </div>
          <p className="od-note">
            Move these assets into your vault to trade or underwrite. Wallet and
            vault balances persist across reloads.
          </p>
          <div className="od-modal-actions">
            <Button
              variant="secondary"
              onClick={() => {
                setModal(null);
                setTransfer({ asset: 'USDC', direction: 'deposit' });
              }}
            >
              Deposit USDC
            </Button>
            <Button
              onClick={() => {
                setModal(null);
                setTransfer({ asset: 'NVDA', direction: 'deposit' });
              }}
            >
              Deposit NVDA
            </Button>
          </div>
        </Modal>
      )}

      {modal === 'about' && (
        <Modal
          title="Options, by the share"
          description="A unified workspace for granular options and fully assigned collateral."
          onClose={() => setModal(null)}
          wide
        >
          <p className="od-note">
            One contract represents one share-equivalent, with quantities as
            small as 0.000001 when the contract has a payable obligation. Cash
            and stock deposits fund underwriting, structured options, stock
            loans and protected shorts. The backend checks both counterparties
            and refuses double-pledged assets.
          </p>
          <p className="od-note">
            {s?.mode === 'localnet'
              ? 'This session executes against the Parcel Solana program on a private local validator. SPL test-token escrow backs its balances, and the backend indexes confirmed results.'
              : 'This session executes in the persistent ledger. Onchain vault execution requires the separately configured Parcel local-validator program.'}
          </p>
          <p className="od-note">
            Liquidity comes from funded test counterparties. No external option
            buyer, stock borrower or market maker is connected. Fractional
            sizing reduces dollar exposure; physical long calls still prefund
            strike cash plus premium.
          </p>
          <div className="od-modal-actions">
            <Button
              variant="secondary"
              onClick={() => {
                setModal(null);
                setWelcome(true);
              }}
            >
              Replay the walkthrough
            </Button>
            <Link className="od-button secondary md" href="/legacy">
              Solana escrow desk
              <ArrowUpRight size={15} />
            </Link>
          </div>
        </Modal>
      )}
    </div>
  );
}
