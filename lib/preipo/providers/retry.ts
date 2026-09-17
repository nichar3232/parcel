/**
 * One retry policy for both provider feeds.
 *
 * Tessera and PreStocks are public endpoints we poll on a timer from one
 * address, and both return the occasional 5xx under that. A single blip
 * used to travel all the way to a banner across the top of the desk
 * saying the feed was unavailable, which is both alarming and wrong:
 * the endpoint answers on the next attempt, and the prices it serves are
 * informational in the first place.
 *
 * Only 5xx and transport errors are retried. A 4xx is the endpoint
 * telling us we asked wrongly, and asking again more slowly will not
 * make it right; it is raised immediately so the mistake is visible.
 */
export interface RetryOptions {
  attempts?: number;
  /** Base delay in ms; each attempt waits this times 2^n. */
  backoffMs?: number;
  /** Injected in tests so they do not spend real seconds sleeping. */
  sleep?: (ms: number) => Promise<void>;
}

const nap = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function fetchJsonWithRetry(
  label: string,
  url: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
  { attempts = 3, backoffMs = 250, sleep = nap }: RetryOptions = {},
): Promise<unknown> {
  let last: Error | null = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt) await sleep(backoffMs * 2 ** (attempt - 1));
    // An aborted request is the caller giving up, not a flaky endpoint.
    if (signal?.aborted) break;

    let res: Response;
    try {
      res = await fetchImpl(url, {
        signal,
        headers: { accept: 'application/json' },
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      last = e as Error;
      continue;
    }

    if (res.ok) return res.json();

    last = new Error(`${label} responded ${res.status}.`);
    if (res.status < 500) throw last;
  }

  throw last ?? new Error(`${label} did not respond.`);
}
