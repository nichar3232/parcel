export interface PendingMutation {
  csrf: string;
  key: string;
  input: string;
}
const storageKey = (csrf: string) => `parcel-pending-${csrf.slice(0, 16)}`;
const recoverySuffix = (csrf: string) => `-pending-${csrf.slice(0, 16)}`;

/** Move a pre-rename recovery record into Parcel's namespace. The slot is
 * session-bound, so a suffix match cannot expose another session's intent. */
function recoveredRaw(csrf: string) {
  const current = storageKey(csrf);
  const saved = sessionStorage.getItem(current);
  if (saved) return saved;
  const suffix = recoverySuffix(csrf);
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (!key || key === current || !key.endsWith(suffix)) continue;
    const previous = sessionStorage.getItem(key);
    if (!previous) continue;
    sessionStorage.setItem(current, previous);
    sessionStorage.removeItem(key);
    return previous;
  }
  return null;
}

// Only the original intent/key is stored, never the session cookie or CSRF token.
// A different session gets a different recovery slot and cannot replay this intent.
export function savePending(request: PendingMutation) {
  sessionStorage.setItem(
    storageKey(request.csrf),
    JSON.stringify({ key: request.key, input: request.input }),
  );
}
export function loadPending(csrf: string): PendingMutation | null {
  const raw = recoveredRaw(csrf);
  if (!raw) return null;
  const value = JSON.parse(raw) as { key?: unknown; input?: unknown };
  if (
    typeof value.key !== 'string' ||
    !/^[a-f0-9]{48}$/.test(value.key) ||
    typeof value.input !== 'string'
  )
    throw Error(
      'The saved action could not be read. Keep this tab open and inspect its recovery record.',
    );
  return { key: value.key, input: value.input, csrf };
}
export function clearPending(csrf: string) {
  sessionStorage.removeItem(storageKey(csrf));
  const suffix = recoverySuffix(csrf);
  for (let i = sessionStorage.length - 1; i >= 0; i--) {
    const key = sessionStorage.key(i);
    if (key && key.endsWith(suffix)) sessionStorage.removeItem(key);
  }
}
