export interface PendingMutation {
  csrf: string;
  key: string;
  input: string;
}
const storageKey = (csrf: string) => `oddlot-pending-${csrf.slice(0, 16)}`;
// Only the original intent/key is stored, never the session cookie or CSRF token.
// A different session gets a different recovery slot and cannot replay this intent.
export function savePending(request: PendingMutation) {
  sessionStorage.setItem(
    storageKey(request.csrf),
    JSON.stringify({ key: request.key, input: request.input }),
  );
}
export function loadPending(csrf: string): PendingMutation | null {
  const raw = sessionStorage.getItem(storageKey(csrf));
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
}
