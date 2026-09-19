'use client';
import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Coins,
  LineChart,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { Button } from './shared';

const KEY = 'parcel.welcome.v1';

/**
 * The click-through that used to be three cards nailed to the bottom of
 * the portfolio screen.
 *
 * "Make your next move" was permanent furniture on the one screen a
 * returning user looks at most, explaining the product to someone who
 * had already used it. It belongs at the moment it is useful — the
 * first time the desk opens — and nowhere after that.
 *
 * Dismissal is remembered per browser. If storage is unavailable the
 * walkthrough shows every time, which is the harmless direction to
 * fail in.
 */
const STEPS = [
  {
    icon: Wallet,
    kicker: 'Step one',
    title: 'Fund the vault',
    body: 'Deposit USDC or NVDA from the wallet in the top bar. Everything you write is collateralized from this balance, and nothing is ever borrowed on your behalf.',
    art: 'vault',
  },
  {
    icon: LineChart,
    kicker: 'Step two',
    title: 'Size it to what you own',
    body: 'A listed contract needs a hundred shares. Here one contract is one share-equivalent, down to a millionth of one, so the position is the size of your position.',
    art: 'size',
  },
  {
    icon: Coins,
    kicker: 'Step three',
    title: 'Pick a side, or write one',
    body: 'Buy the option, underwrite it against shares you hold, build a structure out of up to four legs, or lend the stock. One vault backs all of it.',
    art: 'sides',
  },
  {
    icon: ShieldCheck,
    kicker: 'Step four',
    title: 'See the worst case first',
    body: 'Every contract is quoted with its premium, its collateral and its worst outcome before you sign. The backend checks both sides and refuses a double-pledged asset.',
    art: 'shield',
  },
] as const;

function Art({ kind }: { kind: string }) {
  if (kind === 'size')
    return (
      <svg viewBox="0 0 220 96" className="od-welcome-art">
        {Array.from({ length: 10 }, (_, i) => (
          <rect
            key={i}
            x={10 + i * 21}
            y={30}
            width="15"
            height="36"
            rx="3"
            fill={i ? 'var(--pc-raised)' : 'var(--pc-cyan)'}
          />
        ))}
        <text x="10" y="86" className="od-welcome-cap">
          one share
        </text>
        <text x="210" y="86" textAnchor="end" className="od-welcome-cap">
          a listed lot
        </text>
      </svg>
    );
  if (kind === 'sides')
    return (
      <svg viewBox="0 0 220 96" className="od-welcome-art">
        <path
          d="M12 70 L96 70 L200 22"
          fill="none"
          stroke="var(--pc-up)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <path
          d="M12 30 L96 30 L200 74"
          fill="none"
          stroke="var(--pc-down)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray="4 4"
        />
        <line
          x1="96"
          x2="96"
          y1="14"
          y2="82"
          stroke="var(--pc-faint)"
          strokeDasharray="2 5"
        />
      </svg>
    );
  if (kind === 'shield')
    return (
      <svg viewBox="0 0 220 96" className="od-welcome-art">
        <rect
          x="12"
          y="24"
          width="196"
          height="14"
          rx="7"
          fill="var(--pc-raised)"
        />
        <rect
          x="12"
          y="24"
          width="118"
          height="14"
          rx="7"
          fill="var(--pc-cyan)"
        />
        <rect
          x="12"
          y="52"
          width="196"
          height="14"
          rx="7"
          fill="var(--pc-raised)"
        />
        <rect
          x="12"
          y="52"
          width="60"
          height="14"
          rx="7"
          fill="var(--pc-magenta)"
        />
        <text x="136" y="35" className="od-welcome-cap">
          collateral
        </text>
        <text x="78" y="63" className="od-welcome-cap">
          worst case
        </text>
      </svg>
    );
  return (
    <svg viewBox="0 0 220 96" className="od-welcome-art">
      <rect
        x="12"
        y="20"
        width="94"
        height="56"
        rx="10"
        fill="var(--pc-raised)"
      />
      <rect
        x="118"
        y="20"
        width="90"
        height="56"
        rx="10"
        fill="none"
        stroke="var(--pc-cyan-edge)"
        strokeDasharray="4 4"
      />
      <path
        d="M104 48 L128 48"
        stroke="var(--pc-cyan)"
        strokeWidth="2"
        markerEnd=""
      />
      <text x="30" y="52" className="od-welcome-cap">
        wallet
      </text>
      <text x="142" y="52" className="od-welcome-cap">
        vault
      </text>
    </svg>
  );
}

export function Welcome({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const s = STEPS[step];
  const Icon = s.icon;

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight')
        setStep((n) => Math.min(STEPS.length - 1, n + 1));
      if (e.key === 'ArrowLeft') setStep((n) => Math.max(0, n - 1));
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  return (
    <div className="od-welcome-scrim">
      <dialog open className="od-welcome" aria-label="How Parcel works">
        <Art kind={s.art} />
        <div className="od-welcome-body">
          <span className="od-welcome-kicker">
            <Icon size={14} />
            {s.kicker}
          </span>
          <h2>{s.title}</h2>
          <p>{s.body}</p>
        </div>
        <div className="od-welcome-foot">
          <div className="od-welcome-pips">
            {STEPS.map((x, i) => (
              <button
                key={x.title}
                aria-label={x.title}
                aria-current={i === step ? 'true' : undefined}
                className={i === step ? 'on' : ''}
                onClick={() => setStep(i)}
              />
            ))}
          </div>
          <div className="od-welcome-actions">
            {step > 0 && (
              <Button variant="quiet" onClick={() => setStep(step - 1)}>
                <ArrowLeft size={15} />
                Back
              </Button>
            )}
            {step < STEPS.length - 1 ? (
              <>
                <Button variant="quiet" onClick={onClose}>
                  Skip
                </Button>
                <Button onClick={() => setStep(step + 1)}>
                  Next
                  <ArrowRight size={15} />
                </Button>
              </>
            ) : (
              <Button onClick={onClose}>
                Open the desk
                <ArrowRight size={15} />
              </Button>
            )}
          </div>
        </div>
      </dialog>
    </div>
  );
}

/** Whether this browser has been through the walkthrough. */
export function welcomeSeen() {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function markWelcomeSeen() {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* private mode: it will show again next time, which is harmless */
  }
}
