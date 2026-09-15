'use client';
import { Page, initialTerms } from '@/components/desk/shared';
import {
  type Position,
  type Terms,
  payout,
  reserved,
  validate,
} from '@/lib/engine';
import { history, priceOn, rowsFor, scenarios } from '@/lib/scenarios';
import { useEffect, useMemo, useState } from 'react';
import { useChain } from './use-chain';
import { usePortfolio } from './use-portfolio';
type WalletProvider = {
  connect(): Promise<{ publicKey: { toString(): string } }>;
};
type WalletWindow = Window & {
  phantom?: { solana?: WalletProvider };
  solana?: WalletProvider;
};
export function useDesk() {
  const [page, setPage] = useState<Page>('Portfolio'),
    [terms, setTerms] = useState<Terms>(initialTerms),
    [scenarioId, setScenarioId] = useState('deepseek'),
    [index, setIndex] = useState(4),
    [playing, setPlaying] = useState(false),
    [modal, setModal] = useState<
      'wallet' | 'guide' | 'about' | 'risk' | 'chain' | 'execute' | null
    >(null),
    [selected, setSelected] = useState<string | null>(null),
    [toast, setToast] = useState(''),
    [quotePremium, setQuotePremium] = useState<Record<string, string>>({}),
    [combined, setCombined] = useState(true),
    [financeTab, setFinanceTab] = useState('borrow'),
    [borrowQty, setBorrowQty] = useState(40),
    [borrowAmount, setBorrowAmount] = useState(2000),
    [basis, setBasis] = useState(0),
    [missing, setMissing] = useState(false),
    [filter, setFilter] = useState('All'),
    [wallet, setWallet] = useState(''),
    [now, setNow] = useState(0),
    [guideStep, setGuideStep] = useState(0);
  const { book, ready, busy, error, refresh, act, csrf } =
    usePortfolio(setToast);
  const {
    remote,
    setRemote,
    remoteBusy,
    chainReady,
    evidence,
    chainBusy,
    health,
    chainAction,
    runChain,
  } = useChain(csrf, terms, missing, setToast);
  const scenario = scenarios.find((s) => s.id === scenarioId)!;
  const rows = rowsFor(scenarioId);
  const current = rows[Math.min(index, rows.length - 1)];
  const entry = priceOn(scenario.entry);
  const position = book.positions.find((p) => p.id === selected);
  const active = book.positions.filter((p) =>
    ['active', 'awaiting', 'settled'].includes(p.status),
  );
  const totalLocked = book.positions.reduce((s, p) => s + reserved(p), 0);
  const claims = book.positions
    .filter((p) => p.status === 'settled' && !p.buyerClaimed)
    .reduce((s, p) => s + p.buyerPayout, 0);
  const realized = book.positions
    .filter((p) => ['settled', 'closed'].includes(p.status))
    .reduce((s, p) => s + p.buyerPayout - p.terms.premium, 0);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(''), 6500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(
      () =>
        setIndex((i) => {
          if (i >= rows.length - 1) {
            setPlaying(false);
            return i;
          }
          return i + 1;
        }),
      1100,
    );
    return () => clearInterval(t);
  }, [playing, rows.length]);
  function navigate(p: Page) {
    setPage(p);
    setSelected(null);
  }
  function selectScenario(id: string) {
    const s = scenarios.find((x) => x.id === id)!;
    setScenarioId(id);
    setIndex(rowsFor(id).findIndex((r) => r.date === s.entry));
    setPlaying(false);
    setTerms({
      ...initialTerms,
      kind: id === 'rebound' ? 'call' : 'put',
      scenario: id,
      expiry: s.expiry,
      low: s.low,
      high: s.high,
      premium: s.premium,
    });
  }
  async function request() {
    const id = `RFQ-${Date.now().toString(36).toUpperCase()}`;
    if (await act({ type: 'request', terms, id, now: Date.now() })) {
      setToast(
        'Request sent to the demo maker. Switch to Maker to price and fund it.',
      );
      setSelected(null);
      setPage('Maker');
    }
  }
  async function settle(p: Position) {
    if (p.terms.scenario !== scenarioId) {
      setToast('Load this position’s historical scenario before settlement.');
      return;
    }
    await act({
      type: 'settle',
      id: p.id,
      price: priceOn(p.terms.expiry),
      date: current.date,
      available: !missing,
      now,
    });
  }
  async function reset() {
    if (!(await act({ type: 'reset' }))) return;
    selectScenario('deepseek');
    setSelected(null);
    setGuideStep(0);
    setToast(
      'Practice portfolio reset. Test-chain contracts remain available.',
    );
  }
  function download() {
    const data = {
      ...book,
      network: 'local-simulation',
      dataset: history.sha256,
      exportedAt: new Date().toISOString(),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'strata-session.json';
    a.click();
    URL.revokeObjectURL(url);
  }
  async function connect() {
    try {
      const provider =
        (window as WalletWindow).phantom?.solana ||
        (window as WalletWindow).solana;
      if (!provider)
        throw Error(
          'No Solana wallet extension found. You can use the complete practice demo without one.',
        );
      const result = await provider.connect();
      setWallet(result.publicKey.toString());
      setToast(
        'Wallet connected for address display. Practice actions do not request signatures.',
      );
      setModal(null);
    } catch (e) {
      setToast((e as Error).message);
    }
  }
  const valid = useMemo(() => {
    try {
      validate(terms);
      return '';
    } catch (e) {
      return (e as Error).message;
    }
  }, [terms]);
  const protection = book.positions.find(
    (p) =>
      p.terms.scenario === scenarioId &&
      ['active', 'awaiting', 'settled', 'closed'].includes(p.status),
  );
  const replayTerms =
    protection?.terms ||
    (valid
      ? ({
          ...initialTerms,
          low: scenario.low,
          high: scenario.high,
          premium: scenario.premium,
          expiry: scenario.expiry,
          scenario: scenario.id,
          kind: scenario.id === 'rebound' ? 'call' : 'put',
        } as Terms)
      : terms);
  const stockPnl = (current.close - entry) * replayTerms.quantity;
  const hedgePnl = payout(replayTerms, current.close) - replayTerms.premium;
  const pageCopy: Record<Page, [string, string, string]> = {
    Portfolio: [
      'THE BIG PICTURE',
      'Your portfolio',
      'Own the upside. Define the downside.',
    ],
    Trade: [
      'EXPRESS YOUR VIEW',
      'A strategy for your stock',
      'Two simple structures. A payoff you can understand.',
    ],
    Build: [
      'YOUR POSITION. YOUR TERMS.',
      'Build your protection',
      'Choose the range. See the trade-off. Commit with confidence.',
    ],
    Finance: [
      'PUT HOLDINGS TO WORK',
      'One view of your capital',
      'Understand the cash, collateral, and obligations behind each position.',
    ],
    Activity: [
      'FOLLOW EVERY MOVEMENT',
      'Your activity',
      'From the first quote to the final claim.',
    ],
    Maker: [
      'THE OTHER SIDE',
      'Maker workspace',
      'Set the premium. Reserve the full payout. Take defined risk.',
    ],
    Replay: [
      'REAL MARKETS. PRACTICE CAPITAL.',
      'The replay lab',
      'Rewind the market. See what your protection changes.',
    ],
  };

  return {
    chainReady,
    ready,
    navigate,
    page,
    book,
    filter,
    setGuideStep,
    setModal,
    wallet,
    pageCopy,
    current,
    claims,
    entry,
    scenario,
    rows,
    index,
    totalLocked,
    realized,
    active,
    setSelected,
    terms,
    remote,
    setTerms,
    scenarioId,
    selectScenario,
    valid,
    request,
    combined,
    setCombined,
    stockPnl,
    replayTerms,
    playing,
    setIndex,
    setPlaying,
    protection,
    hedgePnl,
    basis,
    setBasis,
    quotePremium,
    setQuotePremium,
    act,
    now,
    setToast,
    financeTab,
    setFinanceTab,
    borrowQty,
    setBorrowQty,
    borrowAmount,
    setBorrowAmount,
    setFilter,
    download,
    position,
    toast,
    selected,
    missing,
    setMissing,
    setPage,
    settle,
    modal,
    evidence,
    remoteBusy,
    chainAction,
    setRemote,
    connect,
    reset,
    guideStep,
    chainBusy,
    runChain,
    busy,
    error,
    refresh,
    health,
  };
}
export type Desk = ReturnType<typeof useDesk>;
