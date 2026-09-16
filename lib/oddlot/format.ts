/**
 * An option expiry, written the way a US options chain lists one:
 * mm/dd/yyyy, zero padded so a column of them aligns.
 *
 * Intraday expiries keep their hour. The desk offers several on the
 * same day, and without the time they would all read alike.
 *
 * Lives in lib so the server-rendered landing page and the client desk
 * share one format without the page pulling in client components.
 */
export const expiryLabel = (iso: string) => {
  const intraday = iso.includes('T');
  const date = new Date(intraday ? iso : `${iso}T12:00:00Z`);
  const day = date.toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  });
  if (!intraday) return day;
  const time = date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
  return `${day} · ${time} UTC`;
};
