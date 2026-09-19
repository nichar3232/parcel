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
      headerRef.current?.toggleAttribute('data-scrolled', window.scrollY > 12);
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
