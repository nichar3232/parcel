'use client';
import Link from 'next/link';
import { useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  ChevronDown,
  CircleHelp,
  Layers3,
  Landmark,
  Menu,
  ShieldCheck,
  SlidersHorizontal,
  Wallet,
  X,
} from 'lucide-react';
import { useVault } from '@/hooks/oddlot/use-vault';
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
import './oddlot.css';
const navigation = [
  { name: 'Vault', icon: Wallet },
  { name: 'Trade', icon: ArrowUpRight },
  { name: 'Underwrite', icon: Landmark },
  { name: 'Structures', icon: Layers3 },
  { name: 'Lending', icon: SlidersHorizontal },
  { name: 'Risk', icon: ShieldCheck },
  { name: 'Activity', icon: Activity },
];
export default function Home() {
  const desk = useVault(),
    [page, setPage] = useState('Vault'),
    [mobile, setMobile] = useState(false),
    [modal, setModal] = useState<'market' | 'wallet' | 'about' | null>(null),
    [nextDate, setNextDate] = useState('');
  const navigate = (value: string) => {
    setPage(value);
    setMobile(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
      <aside className={`od-sidebar ${mobile ? 'open' : ''}`}>
        <button className="od-brand" onClick={() => navigate('Vault')}>
          <span className="od-brand-symbol">
            <i />
            <i />
            <i />
          </span>
          Oddlot<span className="od-brand-dot">.</span>
        </button>
        <div className="od-workspace-label">
          PERSONAL WORKSPACE<Badge tone="nav">01</Badge>
        </div>
        <nav aria-label="Main navigation">
          {navigation.map(({ name, icon: Icon }, i) => (
            <button
              className={`od-nav-item ${page === name ? 'active' : ''} ${i === 5 ? 'separated' : ''}`}
              key={name}
              aria-current={page === name ? 'page' : undefined}
              onClick={() => navigate(name)}
            >
              <Icon size={18} />
              <span>{name}</span>
              {page === name && <i />}
            </button>
          ))}
        </nav>
        <div className="od-nav-bottom">
          <div className="od-nav-note">
            <span className="od-small-square" />
            <p>Options, by the share.</p>
            <small>
              Precisely sized.
              <br />
              Fully accounted for.
            </small>
          </div>
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
          <div className="od-environment">
            <i />
            Sandbox environment
          </div>
        </div>
      </aside>
      <div className="od-workspace">
        <header className="od-topbar">
          <div>
            <button
              className="od-mobile-menu od-icon-button"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={21} />
            </button>
            <span className="od-breadcrumb">
              Workspace <b>/</b> <strong>{page}</strong>
            </span>
          </div>
          <div className="od-topbar-actions">
            <button
              className="od-market-button"
              onClick={() => setModal('market')}
              disabled={!s}
            >
              <i />
              <span>
                {s
                  ? `${dateLabel(s.book.date)} · Historical market`
                  : 'Connecting'}
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
              {page === 'Vault' && (
                <VaultView desk={desk} navigate={navigate} />
              )}{' '}
              {page === 'Trade' && (
                <OptionsView key="trade" desk={desk} mode="trade" />
              )}
              {page === 'Underwrite' && (
                <OptionsView key="underwrite" desk={desk} mode="underwrite" />
              )}
              {page === 'Structures' && (
                <OptionsView key="structures" desk={desk} mode="structures" />
              )}
              {page === 'Lending' && <LendingView desk={desk} />}{' '}
              {page === 'Risk' && <RiskView desk={desk} />}{' '}
              {page === 'Activity' && <ActivityView desk={desk} />}
            </>
          )}
        </main>
        <footer className="od-footer">
          <span>Oddlot · Precision for every position.</span>
          <span>Test assets · Persistent vault ledger · No real funds</span>
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
          description="Use stored NVIDIA closes to verify position behavior through time."
          onClose={() => setModal(null)}
        >
          <div className="od-review-line">
            <span>Current session</span>
            <b>
              {s.book.date} · {usd(s.market.price)}
            </b>
          </div>
          <Field label="Advance to session">
            <select
              value={target}
              onChange={(e) => setNextDate(e.target.value)}
            >
              {future.map((d) => (
                <option value={d} key={d}>
                  {d}
                </option>
              ))}
            </select>
          </Field>
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
            and vault balances persist across reloads. This is backend test
            accounting, not a connected brokerage or self-custody wallet.
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
            small as 0.000001. Cash and stock deposits fund underwriting,
            structured options, stock loans, and protected shorts. The backend
            checks both counterparties and refuses double-pledged assets.
          </p>
          <p className="od-form-note">
            The new vault product executes in a persistent test ledger. It does
            not claim onchain vault custody, live pricing, or broker portfolio
            margin. The retained Solana desk separately demonstrates real
            program-controlled test-token escrow.
          </p>
          <Link className="od-external" href="/legacy">
            Open Solana escrow desk <ArrowUpRight size={15} />
          </Link>
        </Modal>
      )}
    </div>
  );
}
