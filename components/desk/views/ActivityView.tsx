'use client';
import { Button } from '@/components/ui/button';
import type { Desk } from '@/hooks/desk/use-desk';
import {
  Activity,
  ArrowRight,
  CheckCheck,
  ChevronRight,
  Download,
  Info,
} from 'lucide-react';
export function ActivityView({
  filter,
  setFilter,
  download,
  book,
  navigate,
  setSelected,
}: Pick<
  Desk,
  | 'filter'
  | 'setFilter'
  | 'download'
  | 'book'
  | 'navigate'
  | 'setSelected'
  | 'position'
>) {
  return (
    <section className="panel">
      <div className="section-heading">
        <div className="segmented">
          <button
            className={filter === 'All' ? 'selected' : ''}
            onClick={() => setFilter('All')}
          >
            All activity
          </button>
          <button
            className={filter === 'Settlements' ? 'selected' : ''}
            onClick={() => setFilter('Settlements')}
          >
            Settlements & claims
          </button>
        </div>
        <Button variant="outline" onClick={download}>
          <Download size={14} />
          Export session
        </Button>
      </div>
      {book.events.filter(
        (e) => filter === 'All' || /settle|claim|observation/i.test(e.title),
      ).length === 0 ? (
        <div className="empty">
          <Activity size={27} />
          <h3>Your story starts with a quote.</h3>
          <p>Practice trades and collateral movements will appear here.</p>
          <Button className="primary" onClick={() => navigate('Build')}>
            Build protection <ArrowRight size={14} />
          </Button>
        </div>
      ) : (
        book.events
          .filter(
            (e) =>
              filter === 'All' || /settle|claim|observation/i.test(e.title),
          )
          .map((e) => (
            <button
              className="activity-row"
              key={e.id}
              onClick={() => setSelected(e.position || null)}
            >
              <div className="round-icon">
                <CheckCheck size={17} />
              </div>
              <div>
                <strong>{e.title}</strong>
                <p>{e.detail}</p>
                <span>
                  {new Date(e.time).toLocaleTimeString()} · local simulation
                </span>
              </div>
              <ChevronRight size={16} />
            </button>
          ))
      )}
      <div className="panel-footnote">
        <Info size={12} />
        This is your saved backend practice ledger. Real Solana evidence is
        available separately.
      </div>
    </section>
  );
}
