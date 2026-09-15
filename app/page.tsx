'use client';
import { InfoDialog } from '@/components/desk/dialogs/InfoDialog';
import { PositionDialog } from '@/components/desk/dialogs/PositionDialog';
import { day, nav, short } from '@/components/desk/shared';
import { ActivityView } from '@/components/desk/views/ActivityView';
import { BuildView } from '@/components/desk/views/BuildView';
import { FinanceView } from '@/components/desk/views/FinanceView';
import { MakerView } from '@/components/desk/views/MakerView';
import { PortfolioView } from '@/components/desk/views/PortfolioView';
import { ReplayView } from '@/components/desk/views/ReplayView';
import { TradeView } from '@/components/desk/views/TradeView';
import { Button } from '@/components/ui/button';
import { useDesk } from '@/hooks/desk/use-desk';
import {
  ArrowRight,
  ArrowUpRight,
  BriefcaseBusiness,
  ChevronRight,
  Clock,
  ExternalLink,
  FlaskConical,
  Info,
  Layers,
  Play,
  Shield,
  Wallet,
  X,
} from 'lucide-react';
export default function Home() {
  const desk = useDesk();
  const {
    navigate,
    page,
    book,
    setGuideStep,
    setModal,
    wallet,
    pageCopy,
    current,
    setToast,
    toast,
  } = desk;
  return (
    <div className="desk" data-ready={desk.ready}>
      <aside className="sidebar">
        <button className="brand" onClick={() => navigate('Portfolio')}>
          <span className="brand-mark">
            <Layers size={21} />
          </span>
          strata<span className="brand-dot">.</span>
        </button>
        <div className="workspace-label">EQUITY WORKSPACE</div>
        <nav>
          {nav.map(({ name, icon: Icon }) => (
            <button
              key={name}
              onClick={() => navigate(name)}
              className={`nav-item ${page === name ? 'active' : ''}`}
              aria-current={page === name ? 'page' : undefined}
            >
              <Icon size={18} />
              {name}
              {name === 'Activity' && book.events.length > 0 && (
                <span className="nav-count">{book.events.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="nav-divider" />
        <button
          className={`nav-item ${page === 'Replay' ? 'active' : ''}`}
          onClick={() => navigate('Replay')}
        >
          <FlaskConical size={18} />
          Replay lab<span className="new-badge">DEMO</span>
        </button>
        <button
          className={`nav-item ${page === 'Maker' ? 'active' : ''}`}
          onClick={() => navigate('Maker')}
        >
          <BriefcaseBusiness size={18} />
          Maker
          {book.positions.filter((p) => p.status === 'requested').length >
            0 && (
            <span className="nav-count">
              {book.positions.filter((p) => p.status === 'requested').length}
            </span>
          )}
        </button>
        <button
          className="sidebar-guide"
          onClick={() => {
            setGuideStep(0);
            setModal('guide');
          }}
        >
          <span className="guide-icon">
            <Play size={15} />
          </span>
          <strong>Your first protected position</strong>
          <p>Walk through the 2-minute demo.</p>
          <span>
            Let’s try it <ArrowRight size={12} />
          </span>
        </button>
        <div className="sidebar-bottom">
          <button className="plain" onClick={() => setModal('chain')}>
            <span className="network-dot" />
            Solana transaction proof <ExternalLink size={11} />
          </button>
          <p>
            Built for Stocklana 2026{' '}
            <button aria-label="About Strata" onClick={() => setModal('about')}>
              <Info size={12} />
            </button>
          </p>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <span>Your desk. Your terms.</span>
          <div className="topbar-actions">
            <span className="pill">
              <span className="network-dot" /> Historical simulation
            </span>
            <Button
              variant="outline"
              className="wallet-button"
              onClick={() => setModal('wallet')}
            >
              <Wallet size={13} />
              {wallet ? short(wallet) : 'Demo wallet'}
              <ChevronRight size={12} />
            </Button>
          </div>
        </header>
        <div className="page">
          {(!desk.ready || desk.error) && (
            <output className="connection-banner">
              <span>{desk.error || 'Connecting to your saved portfolio…'}</span>
              {desk.error && (
                <Button onClick={() => void desk.refresh()}>Reconnect</Button>
              )}
            </output>
          )}
          {desk.busy && (
            <output className="save-indicator">Saving portfolio…</output>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">{pageCopy[page][0]}</div>
              <h1>{pageCopy[page][1]}</h1>
              <p>{pageCopy[page][2]}</p>
            </div>
            {page === 'Portfolio' ? (
              <Button
                className="primary"
                disabled={!desk.ready}
                onClick={() => navigate('Build')}
              >
                <Shield size={16} />
                Protect a position
              </Button>
            ) : (
              <span className="as-of">
                <Clock size={12} />
                {day(current.date)} · daily close
              </span>
            )}
          </div>
          {page === 'Portfolio' && <PortfolioView {...desk} />}
          {page === 'Trade' && <TradeView {...desk} />}
          {page === 'Build' && <BuildView {...desk} />}
          {page === 'Replay' && <ReplayView {...desk} />}
          {page === 'Maker' && <MakerView {...desk} />}
          {page === 'Finance' && <FinanceView {...desk} />}
          {page === 'Activity' && <ActivityView {...desk} />}
          <footer className="page-footer">
            <span>
              <span className="network-dot" />
              Practice mode · no real-value trading
            </span>
            <a href="/demo.html" target="_blank" rel="noreferrer">
              Watch the working demo <ArrowUpRight size={12} />
            </a>
            <button onClick={() => setModal('chain')}>
              View Solana proof <ArrowUpRight size={12} />
            </button>
            <button onClick={() => setModal('about')}>
              Methodology & sources
            </button>
          </footer>
        </div>
      </main>
      {toast && (
        <output className="toast" aria-live="polite">
          <Info size={17} />
          <span>{toast}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast('')}
          >
            <X size={15} />
          </button>
        </output>
      )}
      <PositionDialog {...desk} />
      <InfoDialog {...desk} />
    </div>
  );
}
