/**
 * An option expiry, written the way an options chain writes one: an
 * abbreviated year, not a calendar date. "Feb 7, 2025" is how you write
 * a day; "Feb 7 '25" is how you write an expiry.
 *
 * Lives in lib so the server-rendered landing page and the client desk
 * can share it without the page pulling in client components.
 */
export const expiryLabel = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`)
    .toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: '2-digit',
      timeZone: 'UTC',
    })
    .replace(/, (\d\d)$/, " '$1");
