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
  return `${day} at ${time} UTC`;
};

/**
 * Where a confirmed vault transaction can be inspected: Solana Explorer on
 * devnet, the desk's own proof endpoint on a local validator. Sandbox fills
 * have no transaction, so they get no link.
 */
export const txLink = (
  signature: string | undefined,
  mode: 'sandbox' | 'localnet' | 'devnet',
) =>
  !signature || mode === 'sandbox'
    ? undefined
    : mode === 'devnet'
      ? `https://explorer.solana.com/tx/${signature}?cluster=devnet`
      : `/api/chain/tx/${signature}`;

/** A signature short enough for a table cell, still recognisable. */
export const shortSignature = (signature: string) =>
  `${signature.slice(0, 4)}…${signature.slice(-4)}`;
