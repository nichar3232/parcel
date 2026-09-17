'use client';
import {
  Children,
  cloneElement,
  useId,
  type ReactElement,
  type ReactNode,
} from 'react';
import { ArrowUpRight, X } from 'lucide-react';
export { expiryLabel } from '@/lib/oddlot/format';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

/* ------------------------------------------------------------------
   Formatting

   Every figure in the desk goes through one of these. The old screens
   each rounded their own way, which is why the same premium could read
   $4.04 on the ticket and $4.0378 in the summary beside it.
   ------------------------------------------------------------------ */

export const usd = (n: number, d = 2) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits:
      d === 2 && Math.abs(n) > 0 && Math.abs(n) < 0.01 ? 6 : d,
    maximumFractionDigits:
      d === 2 && Math.abs(n) > 0 && Math.abs(n) < 0.01 ? 6 : d,
  }).format(n);

export const qty = (n: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(n);

/** $950,000,000,000 is noise in a cell; $950B is the number. */
export const compact = (n: number) => {
  const [unit, size] =
    Math.abs(n) >= 1e12
      ? ['T', 1e12]
      : Math.abs(n) >= 1e9
        ? ['B', 1e9]
        : Math.abs(n) >= 1e6
          ? ['M', 1e6]
          : Math.abs(n) >= 1e3
            ? ['K', 1e3]
            : ['', 1];
  const v = n / (size as number);
  return `$${v.toFixed(Math.abs(v) >= 100 || !unit ? 0 : 1)}${unit}`;
};

export const pct = (n: number, d = 2) =>
  `${n > 0 ? '+' : ''}${(n * 100).toFixed(d)}%`;

export const dateLabel = (s: string) =>
  new Date(s.includes('T') ? s : s + 'T00:00:00Z').toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
    ...(s.includes('T')
      ? {
          hour: '2-digit' as const,
          minute: '2-digit' as const,
          hour12: false,
          timeZoneName: 'short' as const,
        }
      : {}),
  });

/**
 * A headline figure, with the cents set smaller than the dollars.
 *
 * A vault balance and a six-decimal theta were being rendered at the
 * same size by the same component, so either the balance was too small
 * to be the headline or the theta was a wall of digits. Splitting the
 * fraction lets both sit at the size their integer part deserves.
 */
export function Money({
  value,
  decimals = 2,
  sign = false,
  className = '',
}: {
  value: number;
  decimals?: number;
  /** Show a leading + on a positive number, for P&L. */
  sign?: boolean;
  className?: string;
}) {
  const text = usd(value, decimals);
  const cut = text.lastIndexOf('.');
  const whole = cut < 0 ? text : text.slice(0, cut);
  const frac = cut < 0 ? '' : text.slice(cut);
  return (
    <span className={`od-money ${className}`}>
      {sign && value > 0 ? '+' : ''}
      {whole}
      {frac && <small>{frac}</small>}
    </span>
  );
}

/* ------------------------------------------------------------------
   Controls
   ------------------------------------------------------------------ */

export function Button({
  children,
  onClick,
  disabled = false,
  variant = 'primary',
  size = 'md',
  type = 'button',
  full = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  type?: 'button' | 'submit';
  full?: boolean;
}) {
  return (
    <button
      type={type}
      className={`od-button ${variant} ${size}${full ? ' full' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function LinkButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="od-link" onClick={onClick}>
      {children}
      <ArrowUpRight size={14} />
    </button>
  );
}

/**
 * One row of mutually exclusive choices.
 *
 * Three different segmented controls with three different heights used
 * to sit on the trade screen at once, which is most of what made the
 * top of that page read as slop. There is one now, and it is the only
 * way to draw that control.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
}: {
  options: { id: T; label: string; hint?: string }[];
  value: T;
  onChange: (next: T) => void;
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    <fieldset className={`od-segmented ${size}`} aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          className={value === o.id ? 'selected' : ''}
          aria-pressed={value === o.id}
          title={o.hint}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </fieldset>
  );
}

/** The view-level tab strip that sits under the app bar. */
export function Tabs<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div className="od-tabs" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          role="tab"
          aria-selected={value === o.id}
          className={value === o.id ? 'selected' : ''}
          onClick={() => onChange(o.id)}
        >
          {o.label}
          {o.count !== undefined && <i>{o.count}</i>}
        </button>
      ))}
    </div>
  );
}

export function Field({
  label,
  children,
  help,
  hint,
}: {
  label: string;
  children: ReactNode;
  help?: string;
  /** A value shown at the end of the label row, such as a balance. */
  hint?: ReactNode;
}) {
  const id = useId();
  const child = Children.only(children) as ReactElement<{
    id?: string;
    'aria-describedby'?: string;
  }>;
  return (
    <div className="od-field">
      <div className="od-field-top">
        <label htmlFor={id}>{label}</label>
        {hint && <span className="od-field-hint">{hint}</span>}
      </div>
      {cloneElement(child, {
        id,
        'aria-describedby': help ? `${id}-help` : undefined,
      })}
      {help && <small id={`${id}-help`}>{help}</small>}
    </div>
  );
}

/* ------------------------------------------------------------------
   Surfaces
   ------------------------------------------------------------------ */

export function Panel({
  children,
  className = '',
  tone,
}: {
  children: ReactNode;
  className?: string;
  tone?: 'accent' | 'warn';
}) {
  return (
    <section className={`od-panel ${tone ? `tone-${tone}` : ''} ${className}`}>
      {children}
    </section>
  );
}

export function PanelHead({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="od-panel-head">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Heading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="od-heading">
      <div>
        {eyebrow && <span className="od-eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

export function Stat({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: ReactNode;
  detail?: string;
  tone?: string;
}) {
  return (
    <div className={`od-stat ${tone || ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'green' | 'red' | 'warn' | 'blue';
}) {
  return <span className={`od-badge ${tone}`}>{children}</span>;
}

export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="od-empty">
      <span className="od-empty-mark" aria-hidden>
        <i />
        <i />
        <i />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function Modal({
  title,
  description,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  description: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className={`od-dialog ${wide ? 'wide' : ''}`}
        showCloseButton={false}
      >
        <div className="od-dialog-head">
          <div>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </div>
          <button
            aria-label="Close dialog"
            className="od-icon-button"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="od-dialog-body">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

/** A label/value row, the shape every review and summary uses. */
export function Line({
  label,
  value,
  tone,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: 'up' | 'down' | 'muted';
}) {
  return (
    <div className="od-line">
      <span>{label}</span>
      <b className={tone}>{value}</b>
    </div>
  );
}
