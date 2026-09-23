'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Bot,
  ChevronDown,
  CircleHelp,
  ShieldCheck,
  Wallet,
  X,
} from 'lucide-react';
import { Mark } from '@/components/brand/Mark';
import { ThemeToggle } from '@/components/brand/Theme';
import { useVault } from '@/hooks/parcel/use-vault';
import { useMarks } from '@/hooks/parcel/use-marks';
import { CATEGORIES, CONTRACTS, templates } from '@/lib/parcel/templates';
import { PortfolioView, type PortfolioTab } from './PortfolioView';
import { TradeView, type TradeTab } from './TradeView';
import { LendingView } from './LendingView';
import { PreIpoView, type PreIpoTab } from './PreIpoView';
import { DEFAULT_UNDERLYING } from '@/lib/parcel/universe';
import { TransferDialog, type Transfer } from './TransferDialog';
import { AgentsDialog } from './AgentsDialog';
import { Welcome, markWelcomeSeen, welcomeSeen } from './Welcome';
import { Button, Line, Modal, qty, usd } from './shared';
import '@/app/desk.css';

const NAV = [
  { name: 'Portfolio' },
  { name: 'Trade' },
  { name: 'Pre-IPO' },
  { name: 'Lending' },
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
  // "Positions" listed the same open contracts as the overview and
  // "Collateral" the same reserves the assets table already columns.
  // Collateral is still reachable — it is a real setting — from the line
  // that states which mode is on.
  Portfolio: [
    { id: 'overview', label: 'Holdings' },
    { id: 'watchlist', label: 'Watchlist' },
    { id: 'activity', label: 'Activity' },
  ],
  // Buying and writing ran the same ticket with the side flipped, so
  // they are one section and the side is a choice on the ticket.
  Trade: [
    {
      id: 'trade',
      label: 'Options',
      choices: templates
        .filter((t) => CONTRACTS.includes(t.id))
        .map((t) => ({ id: t.id, label: t.name })),
    },
    {
      id: 'structures',
      label: 'Structures',
      choices: CATEGORIES.map((c) => ({ id: c, label: c })),
    },
  ],
  'Pre-IPO': [
    { id: 'market', label: 'Market' },
    { id: 'underwrite', label: 'Underwrite' },
  ],
  // One screen. "Rates" was a table of five reserves, four of which
  // this build cannot lend, borrow or short — it showed nothing a
  // reader could act on. The one rate that matters is on the ticket.
  // In the order the label says them: lend, then borrow against what
  // you hold, then the two ways of trading the stock itself.
  Lending: [
    {
      id: 'borrow',
      label: 'Lend & borrow',
      choices: [
        { id: 'lend', label: 'Lend' },
        { id: 'borrow', label: 'Borrow' },
        { id: 'short', label: 'Short' },
        { id: 'stock', label: 'Spot' },
      ],
    },
  ],
} as const;

type Section = { id: string; label: string; choices?: readonly Choice[] };
type Choice = { id: string; label: string };

/** What a section opens on when you have not picked yet. */
const firstChoice = (page: Page, section: string) =>
  (TABS[page] as readonly Section[]).find((t) => t.id === section)?.choices?.[0]
    ?.id ?? '';

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
  positions: { page: 'Portfolio' },
  options: { page: 'Trade', tab: 'trade' },
  trade: { page: 'Trade', tab: 'trade' },
  underwriting: { page: 'Trade', tab: 'trade' },
  structures: { page: 'Trade', tab: 'structures' },
  'pre-ipo': { page: 'Pre-IPO' },
  lending: { page: 'Lending' },
};

/**
 * The desk's navigation.
 *
 * Four views down the left edge, each opening to the sections it owns.
 *
 * Open is its own state, not a reading of which view you are in. That lets a
 * reader inspect another product's choices without leaving the page they are
 * on, while an explicit action is still required to enter a new section.
 *
 * A view with one section has nothing to open and says so by having no
 * chevron.
 */
function ProductNav({
  page,
  current,
  choice,
  navigate,
}: {
  page: Page;
  current: string;
  choice: string;
  navigate: (next: Page, to?: string, pick?: string) => void;
}) {
  const [open, setOpen] = useState<Page | null>(null);
  const nav = useRef<HTMLElement>(null);

  // One explicit click opens a product's choices. Escape or a click beyond
  // the navigation closes the list; attaching the pointer listener after the
  // opening gesture completes prevents that same gesture from closing it.
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!nav.current?.contains(event.target as Node)) setOpen(null);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    const startOutsideClose = window.setTimeout(
      () => document.addEventListener('pointerdown', outside),
      0,
    );
    document.addEventListener('keydown', key);
    return () => {
      window.clearTimeout(startOutsideClose);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const go = (name: Page, to?: string, pick?: string) => {
    navigate(name, to, pick);
    setOpen(null);
  };

  return (
    <nav className="od-nav" aria-label="Main navigation" ref={nav}>
      {NAV.map(({ name }) => {
        const sections = TABS[name] as readonly Section[];
        const branching = sections.length > 1 || !!sections[0].choices;
        const here = page === name;
        return (
          <div key={name} className="od-nav-group">
            <button
              className={`od-nav-item ${here ? 'active' : ''}`}
              aria-current={here ? 'page' : undefined}
              aria-expanded={branching ? open === name : undefined}
              onClick={() => {
                // A product switch leaves its own choices available so the
                // next decision is immediately available.
                if (!here) {
                  navigate(name);
                  setOpen(branching ? name : null);
                  return;
                }
                setOpen((currentOpen) =>
                  branching && currentOpen !== name ? name : null,
                );
              }}
            >
              <span>{name}</span>
              {branching && <ChevronDown size={13} />}
            </button>

            {open === name && branching && (
              <div className="od-nav-menu">
                {sections.map((section) => (
                  <div key={section.id} className="od-nav-section">
                    {/* A lone section only repeats the view's own name
                        above its choices, so the choices stand alone. */}
                    {sections.length > 1 && (
                      <button
                        className={`od-nav-link ${
                          here && current === section.id ? 'active' : ''
                        }`}
                        onClick={() => go(name, section.id)}
                      >
                        {section.label}
                      </button>
                    )}
                    {!!section.choices && (
                      <div className="od-nav-picks">
                        {section.choices.map((pick) => (
                          <button
                            key={pick.id}
                            className={`od-nav-pick ${
                              here &&
                              current === section.id &&
                              choice === pick.id
                                ? 'active'
                                : ''
                            }`}
                            onClick={() => go(name, section.id, pick.id)}
                          >
                            {pick.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

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
    /** The third level, keyed "<view>:<section>". */
    pick: Record<string, string>;
    welcome: boolean;
  }>({ page: 'Portfolio', tab: {}, pick: {}, welcome: false });
  const [advanced, setAdvanced] = useState(false);
  /** The underlying every ticket is written on until the reader picks another. */
  const [symbol, setSymbol] = useState(DEFAULT_UNDERLYING);
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [modal, setModal] = useState<'wallet' | 'about' | 'agents' | null>(
    null,
  );

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
      pick: current.pick,
      welcome,
    }));
  }, []);

  const page = ui.page;
  const setWelcome = (open: boolean) =>
    setUi((current) => ({ ...current, welcome: open }));

  const s = desk.state;
  const current = ui.tab[page] || TABS[page][0].id;
  const choice = ui.pick[`${page}:${current}`] || firstChoice(page, current);

  const navigate = (next: Page, to?: string, pick?: string) => {
    setUi((view) => {
      const section = to ?? view.tab[next] ?? TABS[next][0].id;
      const pickKey = `${next}:${section}`;
      return {
        ...view,
        page: next,
        tab: to ? { ...view.tab, [next]: to } : view.tab,
        // A section is the broad, browsable destination; a choice inside it
        // is a precise contract or workflow. Returning to the section clears
        // an earlier precise choice instead of silently reopening a stale
        // ticket from a different task.
        pick: pick
          ? { ...view.pick, [pickKey]: pick }
          : to
            ? Object.fromEntries(
                Object.entries(view.pick).filter(([key]) => key !== pickKey),
              )
            : view.pick,
      };
    });
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    });
  };

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
          <Mark size={20} />
          <b>PARCEL</b>
        </Link>

        <ProductNav
          page={page}
          current={current}
          choice={choice}
          navigate={navigate}
        />

        <div className="od-bar-right">
          <button
            className="od-bar-btn"
            aria-label="Connect an agent"
            onClick={() => setModal('agents')}
            disabled={!s}
          >
            <Bot size={15} />
            <span className="wide">Agents</span>
          </button>

          <button
            className="od-bar-btn"
            aria-label="About Parcel"
            onClick={() => setModal('about')}
          >
            <CircleHelp size={15} />
            <span className="wide">About</span>
          </button>

          <button
            className="od-bar-btn"
            aria-label="Wallet"
            onClick={() => setModal('wallet')}
            disabled={!s}
          >
            <Wallet size={15} />
            <b>{s ? usd(walletValue, 0) : '—'}</b>
            <ChevronDown size={13} />
          </button>

          <ThemeToggle />
        </div>
      </header>

      <main id="workspace" className="od-main" tabIndex={-1}>
        {/* Every screen needs one. The views are built out of panels
            with their own headings, so the page's own name is carried
            here rather than repeated as a banner nobody reads twice. */}
        <h1 className="sr-only">
          {page}
          {current === TABS[page][0].id
            ? ''
            : ` — ${TABS[page].find((t) => t.id === current)?.label ?? ''}`}
        </h1>
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
          /* Keyed on the section and the choice: the ticket's template,
             its legs and its size all come from them at mount, so a new
             choice is a new contract rather than a new view of one. */
          <TradeView
            key={`${current}:${choice}:${symbol}`}
            desk={desk}
            tab={current as TradeTab}
            choice={choice}
            symbol={symbol}
            onSymbol={setSymbol}
            advanced={advanced}
            onAdvanced={setAdvanced}
          />
        ) : page === 'Pre-IPO' ? (
          <PreIpoView
            desk={desk}
            feed={feed}
            tab={current as PreIpoTab}
            openTrade={() => navigate('Trade', 'underwrite')}
            openUnderwrite={() => navigate('Pre-IPO', 'underwrite')}
            openPortfolio={() => navigate('Portfolio')}
            onTransfer={setTransfer}
            pick={ui.pick['Pre-IPO:underwrite']}
          />
        ) : (
          <LendingView
            key={`${choice}:${symbol}`}
            desk={desk}
            feed={feed}
            mode={choice}
            symbol={symbol}
            onSymbol={setSymbol}
          />
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

      {modal === 'wallet' && s && (
        <Modal
          title="Your wallet"
          description="An isolated funding wallet for this browser session."
          onClose={() => setModal(null)}
        >
          <div className="od-lines">
            <Line label="Available USDC" value={usd(s.book.wallet.USDC)} />
            {(s.market.underlyings ?? [])
              .filter((u) => (s.book.wallet[u.symbol] ?? 0) > 0)
              .map((u) => (
                <Line
                  key={u.symbol}
                  label={`Available ${u.symbol}`}
                  value={`${qty(s.book.wallet[u.symbol])} shares`}
                />
              ))}
            <Line
              label="In the vault"
              value={usd(
                (s.market.underlyings ?? []).reduce(
                  (t, u) => t + (s.book.vault[u.symbol] ?? 0) * u.price,
                  s.book.vault.USDC,
                ),
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
                setTransfer({ asset: symbol, direction: 'deposit' });
              }}
            >
              Deposit {symbol}
            </Button>
          </div>
        </Modal>
      )}

      {modal === 'agents' && s && (
        <AgentsDialog
          csrf={s.csrf}
          mode={s.mode}
          onClose={() => setModal(null)}
        />
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
            {s?.mode === 'devnet'
              ? 'This session executes against the Parcel Solana program on devnet. SPL test-token escrow backs its balances, every action is a public transaction, and the backend indexes confirmed results.'
              : s?.mode === 'localnet'
                ? 'This session executes against the Parcel Solana program on a private local validator. SPL test-token escrow backs its balances, and the backend indexes confirmed results.'
                : 'This session executes in the persistent ledger. Onchain vault execution requires a configured Parcel program on devnet or a local validator.'}
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
