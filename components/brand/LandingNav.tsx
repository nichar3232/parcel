'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * The landing header is transparent only while it sits on the hero. Once it
 * overlaps scrolling content it needs to become a dependable reading surface,
 * rather than letting headings and charts show through the navigation.
 */
export function LandingNav({ children }: { children: ReactNode }) {
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let frame = 0;
    const sync = () => {
      frame = 0;
      const header = headerRef.current;
      if (!header) return;
      header.toggleAttribute('data-scrolled', window.scrollY > 12);
      /* The mark answers the reader's scroll rather than running on its own.
         It stays a quiet logo when the page is still, then turns once for
         roughly every 1,800px of travel. That gives the long landing a
         tactile wayfinding detail without becoming a loader or a flourish
         competing with the payoff charts. */
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches)
        header.style.setProperty(
          '--lp-mark-scroll-rotation',
          `${Math.round(window.scrollY / 5)}deg`,
        );
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(sync);
    };

    sync();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <header ref={headerRef} className="lp-nav">
      {children}
    </header>
  );
}
