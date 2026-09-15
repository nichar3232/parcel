import type { ApiErrorBody } from '../contracts/api';
export const requestKey = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
export class RequestError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    ...init,
    credentials: 'same-origin',
    signal: init?.signal || AbortSignal.timeout(20000),
  });
  let data: unknown;
  try {
    data = await r.json();
  } catch {
    throw new RequestError(
      'The server returned an unreadable response. Check the backend connection.',
      'INVALID_RESPONSE',
      r.status,
    );
  }
  if (!r.ok) {
    const e = data as ApiErrorBody;
    throw new RequestError(
      e.error || 'Request failed.',
      e.code || 'REQUEST',
      r.status,
    );
  }
  return data as T;
}

export const ambiguousResponse = (error: unknown) =>
  !(error instanceof RequestError) ||
  error.code === 'INVALID_RESPONSE' ||
  error.status >= 500;
