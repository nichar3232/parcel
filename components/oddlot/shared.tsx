'use client';
import {
  Children,
  cloneElement,
  useId,
  type ReactElement,
  type ReactNode,
} from 'react';
import { ArrowUpRight, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
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
export function Button({
  children,
  onClick,
  disabled = false,
  variant = 'primary',
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      className={`od-button ${variant}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
export function Panel({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={`od-panel ${className}`}>{children}</section>;
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
  value: string;
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
  tone = 'blue',
}: {
  children: ReactNode;
  tone?: string;
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
      <span className="od-empty-mark">↗</span>
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
}: {
  title: string;
  description: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="od-dialog" showCloseButton={false}>
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
            <X size={19} />
          </button>
        </div>
        {children}
      </DialogContent>
    </Dialog>
  );
}
export function Field({
  label,
  children,
  help,
}: {
  label: string;
  children: ReactNode;
  help?: string;
}) {
  const id = useId();
  const child = Children.only(children) as ReactElement<{
    id?: string;
    'aria-describedby'?: string;
  }>;
  return (
    <div className="od-field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(child, {
        id,
        'aria-describedby': help ? `${id}-help` : undefined,
      })}
      {help && <small id={`${id}-help`}>{help}</small>}
    </div>
  );
}

export function AssetIcon({ cash = false }: { cash?: boolean }) {
  return (
    <span className={`od-asset-icon ${cash ? 'cash' : ''}`}>
      {cash ? '$' : 'N'}
    </span>
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
      <ArrowUpRight size={15} />
    </button>
  );
}
