import { test, expect } from '@playwright/test';

/**
 * Nothing sits on top of anything else, on any screen.
 *
 * Written after a `position: sticky` left over from a two-column
 * layout pinned the ticket on top of the panel beneath it once the
 * screen became one column. Nothing caught it: every assertion in the
 * suite was about what the page contains, and the page did contain
 * both panels — stacked on the same pixels.
 */
const SCREENS = ['portfolio', 'options', 'structures', 'pre-ipo', 'underwriting', 'lending'];

test('no panel overlaps any sibling on any screen', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('parcel.welcome.v1', '1'); } catch {}
  });
  const problems: string[] = [];
  for (const at of SCREENS) {
    await page.goto(`/app?at=${at}`);
    await expect(page.locator('.pc-desk')).toHaveAttribute('data-ready', 'true');
    await page.waitForTimeout(600);
    const bad = await page.evaluate(() => {
      const found: string[] = [];
      for (const sel of ['.od-work', '.od-borrow', '.od-main', '.od-open-main', '.od-open-side', '.od-insight']) {
        for (const box of document.querySelectorAll(sel)) {
          // Visually-hidden headings are 1px and deliberately clipped.
          const kids = [...box.children].filter(
            (e) =>
              e.getBoundingClientRect().height > 0 &&
              !e.classList.contains('sr-only'),
          );
          for (let i = 1; i < kids.length; i++) {
            const a = kids[i - 1].getBoundingClientRect(), b = kids[i].getBoundingClientRect();
            // A real overlap is on both axes: side-by-side columns
            // share a top edge and that is the layout working.
            const over =
              Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1 &&
              Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1;
            if (over)
              found.push(`${sel}: ${kids[i - 1].className} / ${kids[i].className} overlap`);
          }
        }
      }
      return found;
    });
    bad.forEach((b) => problems.push(`${at} — ${b}`));
  }
  expect(problems, problems.join('\n')).toEqual([]);
});
