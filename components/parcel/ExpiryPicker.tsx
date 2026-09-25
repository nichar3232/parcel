'use client';

import { CalendarDays, ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { expiryLabel } from '@/lib/parcel/format';

const daysTo = (date: string, asOf: string) => {
  const start = Date.parse(`${asOf.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(
    date.includes('T') ? date : `${date.slice(0, 10)}T00:00:00Z`,
  );
  return Math.max(0, Math.round((end - start) / 86_400_000));
};

const termLabel = (date: string, asOf: string) => {
  const days = daysTo(date, asOf);
  if (days === 0) return 'Today';
  if (days === 1) return '1 day';
  if (days < 7) return `${days} days`;
  if (days % 7 === 0) return `${days / 7} wk`;
  return `${days} days`;
};

/**
 * A bounded, keyboard-operable expiry chooser for the options chain.
 *
 * Native selects hand layout of a long expiry set to the browser. That is
 * fine for a three-item form field, but it creates a full-height menu for a
 * real chain. This keeps the entire expiration set available while making
 * the near-term dates easy to scan and the rest intentionally scrollable.
 */
export function ExpiryPicker({
  id,
  label = 'Expiry',
  ariaLabel,
  dates,
  value,
  asOf,
  onChange,
  disabled = false,
}: {
  id?: string;
  label?: string;
  /** Distinguishes concurrent pickers while preserving the short visual label. */
  ariaLabel?: string;
  dates: string[];
  value: string;
  asOf: string;
  onChange: (date: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const selected = dates.includes(value) ? value : dates[0] || '';
  const near = dates.slice(0, 5);
  const later = dates.slice(5);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeEscape);
    };
  }, []);

  const pick = (date: string) => {
    onChange(date);
    setOpen(false);
  };
  const options = (items: string[]) =>
    items.map((date) => (
      <button
        type="button"
        key={date}
        aria-pressed={selected === date}
        className={selected === date ? 'selected' : ''}
        onClick={() => pick(date)}
      >
        <span>{expiryLabel(date)}</span>
        <small>{termLabel(date, asOf)}</small>
      </button>
    ));

  return (
    <div className="od-expiry-picker" ref={root}>
      <button
        id={id}
        type="button"
        className="od-expiry-trigger"
        aria-label={ariaLabel ?? label}
        aria-expanded={open}
        aria-controls={menuId}
        disabled={disabled}
        onClick={() => setOpen((shown) => !shown)}
      >
        <CalendarDays aria-hidden size={15} />
        <span>
          <small>{label}</small>
          <b>{selected ? expiryLabel(selected) : 'No expiry available'}</b>
        </span>
        <ChevronDown aria-hidden size={15} />
      </button>

      {open && (
        <div className="od-expiry-menu" id={menuId}>
          <div className="od-expiry-menu-head">
            <span>Available expiries</span>
            <small>{dates.length} sessions</small>
          </div>
          <div className="od-expiry-menu-scroll">
            <div className="od-expiry-group">
              <span>Near term</span>
              {options(near)}
            </div>
            {later.length > 0 && (
              <div className="od-expiry-group">
                <span>Later dates</span>
                {options(later)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
