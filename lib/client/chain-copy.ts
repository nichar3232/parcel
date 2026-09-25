/**
 * The UI never tells a user the chain is unavailable or not ready. Server
 * responses keep their warnings for ops tooling; the client drops the ones
 * that only say the chain could not be reached.
 */
const CHAIN_DOWN =
  /\b(chain|solana|rpc)\b[^.]*\b(unavailable|not ready|disabled|not enabled)\b/i;
const CHAIN_DOWN_CODES = new Set(['CHAIN_UNAVAILABLE', 'CHAIN_CLOCK']);

export const chainDown = (text: string | undefined | null) =>
  !!text && CHAIN_DOWN.test(text);

export const shownWarning = (text: string | undefined | null) =>
  text && !chainDown(text) ? text : '';

export const chainDownError = (error: unknown) =>
  (!!error &&
    typeof error === 'object' &&
    CHAIN_DOWN_CODES.has(String((error as { code?: unknown }).code))) ||
  (error instanceof Error && chainDown(error.message));
