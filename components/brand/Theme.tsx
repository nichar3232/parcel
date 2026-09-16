'use client';
import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

export type Scheme = 'light' | 'dark';

/**
 * The theme toggle.
 *
 * The chosen scheme lives on <html data-theme>, written before paint by
 * the inline script in app/layout.tsx so the page never flashes the
 * wrong one. With nothing stored we follow the system, and keep
 * following it until the reader actually picks a side.
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const [scheme, setScheme] = useState<Scheme>('light');
  useEffect(() => {
    // <html data-theme> is set by the boot script before paint; this
    // reads that external state once, after hydration.
    // oxlint-disable-next-line react/react-compiler
    setScheme(
      document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
    );
  }, []);
  const set = (next: Scheme) => {
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch {
      /* private mode: the choice lasts for this page only */
    }
    setScheme(next);
  };
  return (
    <button
      type="button"
      className={`pc-theme ${className}`}
      onClick={() => set(scheme === 'dark' ? 'light' : 'dark')}
      aria-label={
        scheme === 'dark' ? 'Use the light theme' : 'Use the dark theme'
      }
      title={scheme === 'dark' ? 'Light theme' : 'Dark theme'}
    >
      {scheme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
