/*
 * Parcel's vault as MCP tools. Each tool drives the same HTTP API the desk uses,
 * so accounting, risk checks and, in chain mode, signing stay on the server.
 * The stdio entry (mcp/parcel.ts) and the server's own /mcp endpoint both
 * build their tools here.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { VaultSnapshot } from '../lib/parcel/types';
import {
  CATEGORIES,
  CONTRACTS,
  templateTerms,
  templates,
  templatesIn,
} from '../lib/parcel/templates';

export interface ParcelMcpOptions {
  /** The running app, e.g. http://localhost:3025. */
  base: string;
  /** An agent key from the desk's Agents dialog; preferred when present. */
  agentKey?: string;
  /** A browser's strata_session cookie, to act in that desk's session. */
  session?: string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
}

export function createParcelMcp(opts: ParcelMcpOptions) {
  const base = opts.base.replace(/\/$/, '');
  const borrowed = Boolean(opts.session);
  let token = opts.session || '';

  async function call(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (opts.agentKey) headers.set('Authorization', `Bearer ${opts.agentKey}`);
    else if (token) headers.set('Cookie', `strata_session=${token}`);
    // Longer than the server's 15s request timeout, so its answer wins.
    const res = await fetch(base + path, {
      ...init,
      headers,
      signal: AbortSignal.timeout(20000),
    });
    const set = res.headers.get('set-cookie')?.match(/strata_session=([^;]+)/);
    if (set && !opts.agentKey) token = set[1];
    const data = await res.json().catch(() => ({}));
    if (!res.ok)
      throw new HttpError(
        res.status,
        data.code || String(res.status),
        data.error || res.statusText,
      );
    return data;
  }

  async function vault(): Promise<VaultSnapshot> {
    if (opts.agentKey)
      return call('/api/vault').catch((e) => {
        if (e instanceof HttpError && e.status === 401)
          throw Error(
            'This connection was disconnected or has expired. Reconnect Parcel from MCP in the desk.',
          );
        throw e;
      });
    if (!token) await call('/api/session');
    try {
      return await call('/api/vault');
    } catch (e) {
      if (!(e instanceof HttpError) || e.code !== 'SESSION_REQUIRED') throw e;
      // A fresh session would silently diverge from the browser being watched.
      if (borrowed)
        throw Error(
          'PARCEL_SESSION is not a live session. Copy strata_session from the browser again and restart the agent.',
        );
      token = '';
      await call('/api/session');
      return call('/api/vault');
    }
  }

  async function post(path: string, body: string, key: string) {
    const { csrf } = await vault();
    return call(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: base,
        'X-CSRF-Token': csrf,
        'Idempotency-Key': key,
      },
      body,
    });
  }

  // Reads that the server guards like writes: they need the current revision
  // and a key, but change nothing, so a lost response is simply asked again.
  async function ask(path: string, payload: Record<string, unknown>) {
    const { revision } = await vault();
    return post(path, JSON.stringify({ revision, ...payload }), randomUUID());
  }

  /*
   * A chain action that timed out or is still confirming stays pending on the
   * server, and every later action in the session (the browser's too) is refused
   * until the same key and body are sent again. The intent is saved before the
   * first send so it survives this process.
   */
  interface Pending {
    key: string;
    body: string;
  }
  const slot = () =>
    join(
      tmpdir(),
      `parcel-mcp-${createHash('sha256')
        .update(opts.agentKey || token)
        .digest('hex')
        .slice(0, 16)}.json`,
    );
  function saved(): Pending | null {
    try {
      return JSON.parse(readFileSync(slot(), 'utf8'));
    } catch {
      return null;
    }
  }
  const retryable = (e: unknown) =>
    !(e instanceof HttpError) || e.status >= 500;

  async function send(p: Pending) {
    let last: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 2000 * attempt));
      try {
        const result = await post('/api/vault/actions', p.body, p.key);
        rmSync(slot(), { force: true });
        return result;
      } catch (e) {
        last = e;
        if (!retryable(e)) {
          rmSync(slot(), { force: true });
          throw e;
        }
      }
    }
    throw Error(
      `Still unconfirmed after retries (${(last as Error).message}). The action is saved; call resolve_pending before anything else.`,
    );
  }

  async function act(action: Record<string, unknown>) {
    // The recovery slot is per session, so the session has to be known first.
    const { revision } = await vault();
    if (saved())
      throw Error(
        'An earlier action is still unconfirmed. Call resolve_pending first.',
      );
    // source marks the receipts as the agent's in the desk's activity.
    const p = {
      key: randomUUID(),
      body: JSON.stringify({ revision, source: 'agent', action }),
    };
    writeFileSync(slot(), JSON.stringify(p));
    return receipt(await send(p));
  }

  const active = <T extends { status: string }>(xs: T[]) =>
    xs.filter((x) => x.status === 'active');

  function summary(v: VaultSnapshot) {
    const b = v.book;
    return {
      mode: v.mode,
      revision: v.revision,
      marketDate: b.date,
      margin: b.margin,
      wallet: b.wallet,
      vault: b.vault,
      freeCash: v.risk.freeCash,
      freeShares: v.risk.freeShares,
      options: active(b.options),
      loans: active(b.loans),
      shorts: active(b.shorts),
      borrows: active(b.borrows),
      // Events are stored newest first.
      recentEvents: b.events.slice(0, 5),
    };
  }

  // Only chain mode produces a signature; sandbox results are never onchain.
  function receipt(
    v: VaultSnapshot & { chain?: { signature: string; network: string } },
  ) {
    return {
      settledIn: v.mode === 'sandbox' ? 'sandbox (not onchain)' : v.mode,
      transaction: v.chain
        ? {
            signature: v.chain.signature,
            network: v.chain.network,
            proof: `${base}/api/chain/tx/${v.chain.signature}`,
            // Devnet is public, so anyone can open the transaction there.
            ...(v.chain.network === 'devnet' && {
              explorer: `https://explorer.solana.com/tx/${v.chain.signature}?cluster=devnet`,
            }),
          }
        : null,
      vault: summary(v),
    };
  }

  const text = (value: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  });

  async function run(fn: () => Promise<unknown>) {
    try {
      return text(await fn());
    } catch (e) {
      return { ...text({ error: (e as Error).message }), isError: true };
    }
  }

  const symbol = z.string().describe('Underlying ticker from get_market');
  const expiry = z
    .string()
    .describe('One of the expiries listed by get_market, e.g. 2025-02-14');
  const id = z.string().describe('Position id from get_vault');

  const leg = z.object({
    kind: z.enum(['call', 'put']),
    side: z.enum(['buy', 'sell']),
    strike: z.number().positive(),
    ratio: z.number().int().min(1).max(4),
  });
  const terms = z
    .object({
      symbol,
      name: z.string().min(1).max(70).describe('A label for the contract'),
      quantity: z.number().positive(),
      expiry,
      reference: z
        .enum(['stock', 'dividend'])
        .describe(
          'dividend contracts are NVDA only, cash, expiring on the dividend date',
        ),
      settlement: z.enum(['cash', 'physical']),
      legs: z
        .array(leg)
        .max(4)
        .describe('One to four legs, or none with a curve'),
      curve: z
        .object({
          shape: z.enum(['quadratic', 'exponential']),
          side: z.enum(['buy', 'sell']),
          direction: z.enum(['up', 'down']),
          lower: z.number().min(0),
          upper: z.number().positive(),
          cap: z.number().positive(),
        })
        .optional()
        .describe('A cash-settled payoff curve instead of option legs'),
    })
    .describe('Terms of a new contract');
  const target = {
    positionId: z
      .string()
      .optional()
      .describe('An active option to close, instead of opening new terms'),
    terms: terms.optional(),
  };

  /**
   * A quote, with what this trade itself reserves spelled out. The server's
   * cashRequired and sharesRequired are the vault's totals after the trade,
   * which read as the trade's own collateral if taken alone.
   */
  async function quote(a: Record<string, unknown>) {
    const before = (await vault()).risk;
    const q = await ask('/api/vault/quote', a);
    const on = (q.terms?.symbol as string) || 'NVDA';
    return {
      ...q,
      thisTrade: {
        cashReserved: Math.round((q.cashRequired - before.cash) * 100) / 100,
        sharesReserved:
          Math.round(
            ((q.sharesRequired ?? 0) - (before.shares[on] ?? 0)) * 1e6,
          ) / 1e6,
      },
      note: "thisTrade is the collateral this trade adds. cashRequired and sharesRequired are the whole vault's reserves after it, and cashAfter is the free cash left.",
    };
  }

  const server = new McpServer(
    { name: 'parcel', version: '0.4.0' },
    {
      // Standing guidance for any conversation that has these tools, not
      // only one started with /parcel.
      instructions:
        "Parcel is the user's options and lending vault. Answer questions about their balance or positions with get_vault. To see what can be traded, use list_products: options and structures, plus stock, lending, borrowing cash, and protected shorts (borrow shares and sell them). Before any action that changes the vault, state briefly what it does and its numbers (premium or proceeds, the most they can lose, what it reserves, the expiry) and ask the user to confirm; act only after they do. Quote options with quote_option first; its thisTrade field is what the trade reserves. Keep answers short.",
    },
  );

  server.registerTool(
    'get_vault',
    {
      description:
        'Current vault: settlement mode, market date, wallet and vault balances, free collateral, and every active option, loan, short and borrow with its id.',
    },
    () => run(async () => summary(await vault())),
  );

  server.registerTool(
    'get_market',
    {
      description:
        'Tradable underlyings with prices and volatility, the expiries contracts can be written to, the next replay steps advance_market accepts, and the dividend event.',
    },
    () =>
      run(async () => {
        const { dates, ...market } = (await vault()).market;
        const ahead = dates.filter((d) => d > market.date);
        return {
          ...market,
          // Contracts expire on sessions; the replay also steps hourly.
          expiries: ahead.filter((d) => !d.includes('T')),
          nextSteps: ahead.slice(0, 6),
        };
      }),
  );

  server.registerTool(
    'get_options_chain',
    {
      description:
        'Call and put premiums across the strike ladder for one underlying and expiry.',
      inputSchema: {
        symbol,
        expiry,
        quantity: z.number().positive().describe('Contracts per quote'),
      },
    },
    (a) => run(() => ask('/api/vault/chain', a)),
  );

  server.registerTool(
    'quote_option',
    {
      description:
        'Price a contract without trading: premium (positive is paid, negative received), greeks, collateral required and whether it is executable. Quotes expire after 30 seconds; to trade, prefer trade_option.',
      inputSchema: target,
    },
    (a) => run(() => quote(a)),
  );

  server.registerTool(
    'trade_option',
    {
      description:
        'Open a contract or close an active one at a fresh quote, refusing if the premium exceeds maxPremium. Places the transaction and returns its signature in chain mode.',
      inputSchema: {
        ...target,
        maxPremium: z
          .number()
          .describe(
            'Highest premium to accept, in USDC; negative means the trade must pay you at least that much',
          ),
      },
    },
    ({ maxPremium, ...a }) =>
      run(async () => {
        const q = await quote(a);
        if (!q.eligible)
          throw Error(q.reason || 'This quote is not executable.');
        if (q.premium > maxPremium)
          throw Error(
            `Premium ${q.premium} exceeds maxPremium ${maxPremium}; nothing was traded.`,
          );
        return {
          premium: q.premium,
          ...(await act({ type: 'execute', quoteId: q.id })),
        };
      }),
  );

  server.registerTool(
    'execute_quote',
    {
      description: 'Execute an unexpired quote from quote_option.',
      inputSchema: { quoteId: z.string() },
    },
    ({ quoteId }) => run(() => act({ type: 'execute', quoteId })),
  );

  server.registerTool(
    'transfer',
    {
      description:
        'Move USDC or shares between the test wallet and the vault. The vault starts funded; check wallet balances in get_vault first.',
      inputSchema: {
        direction: z.enum(['deposit', 'withdraw']),
        asset: z.string().describe('USDC or an underlying ticker'),
        amount: z.number().positive(),
      },
    },
    (a) => run(() => act({ type: 'transfer', ...a })),
  );

  server.registerTool(
    'trade_stock',
    {
      description: 'Buy or sell shares at the current mark using vault USDC.',
      inputSchema: {
        side: z.enum(['buy', 'sell']),
        symbol,
        quantity: z.number().positive(),
      },
    },
    (a) => run(() => act({ type: 'stock', ...a })),
  );

  server.registerTool(
    'lend_shares',
    {
      description: 'Lend vault shares until an expiry to earn a fee.',
      inputSchema: { symbol, quantity: z.number().positive(), expiry },
    },
    (a) => run(() => act({ type: 'lend', ...a })),
  );

  server.registerTool(
    'recall_loan',
    { description: 'Recall an active share loan.', inputSchema: { id } },
    (a) => run(() => act({ type: 'recall', ...a })),
  );

  server.registerTool(
    'open_short',
    {
      description:
        'Borrow shares and sell them short, with a price cap that bounds the loss.',
      inputSchema: {
        symbol,
        quantity: z.number().positive(),
        cap: z
          .number()
          .positive()
          .describe(
            'Protective strike: above the current price and at most twice it',
          ),
        expiry,
      },
    },
    (a) => run(() => act({ type: 'short', ...a })),
  );

  server.registerTool(
    'close_short',
    { description: 'Close an active short.', inputSchema: { id } },
    (a) => run(() => act({ type: 'close-short', ...a })),
  );

  server.registerTool(
    'borrow_usdc',
    {
      description:
        'Pledge shares as collateral and borrow USDC against them. Onchain mode supports the program stock mint (NVDA); APR is the pool curve, not Black–Scholes.',
      inputSchema: {
        symbol,
        pledged: z.number().positive().describe('Shares pledged'),
        amount: z.number().positive().describe('USDC borrowed'),
        rate: z.enum(['variable', 'fixed']),
        expiry: expiry.optional().describe('Required for a fixed rate'),
      },
    },
    (a) => run(() => act({ type: 'borrow', ...a })),
  );

  server.registerTool(
    'repay_borrow',
    {
      description: 'Repay an active USDC borrow (sandbox or onchain).',
      inputSchema: { id },
    },
    (a) => run(() => act({ type: 'repay', ...a })),
  );

  server.registerTool(
    'set_margin',
    {
      description: 'Switch the vault between cross and isolated collateral.',
      inputSchema: { mode: z.enum(['cross', 'isolated']) },
    },
    (a) => run(() => act({ type: 'margin', ...a })),
  );

  server.registerTool(
    'advance_market',
    {
      description:
        'Move the historical replay forward to an expiry or next step from get_market; positions expiring on the way settle.',
      inputSchema: { date: z.string() },
    },
    (a) => run(() => act({ type: 'advance', ...a })),
  );

  server.registerTool(
    'restart_replay',
    {
      description:
        'Reset the replay and test allocations. Every position must be closed or settled first.',
    },
    () => run(() => act({ type: 'restart' })),
  );

  server.registerTool(
    'resolve_pending',
    {
      description:
        'Finish an action that was still confirming when it returned. Sends the same request again; it never creates a second transaction.',
    },
    () =>
      run(async () => {
        await vault();
        const p = saved();
        if (!p) return { pending: false };
        return receipt(await send(p));
      }),
  );

  server.registerTool(
    'get_transaction',
    {
      description: 'Fetch the onchain proof for a transaction signature.',
      inputSchema: { signature: z.string() },
    },
    ({ signature }) =>
      run(() => call(`/api/chain/tx/${encodeURIComponent(signature)}`)),
  );

  server.registerTool(
    'list_products',
    {
      description:
        'Everything Parcel offers: options and structures, each with ready-to-trade terms at the current price and a near expiry (pass them to quote_option or trade_option, changing quantity, strikes or expiry as asked), and stock, lending, borrowing and shorting, each with the tool that does it and example arguments.',
      inputSchema: {
        symbol: symbol.optional().describe('Defaults to NVDA'),
        expiry: expiry
          .optional()
          .describe('Defaults to the second listed expiry'),
      },
    },
    (a) =>
      run(async () => {
        const { market } = await vault();
        const on = (a.symbol || 'NVDA').toUpperCase();
        const u = market.underlyings?.find((x) => x.symbol === on);
        if (!u) throw Error(`${on} is not tradable here. See get_market.`);
        const expiries = market.dates.filter(
          (d) => d > market.date && !d.includes('T'),
        );
        const when = a.expiry || expiries[1] || expiries[0];
        const live = market.clock === 'live';
        const family = (id: string) =>
          CONTRACTS.includes(id)
            ? 'Options'
            : (CATEGORIES.find((c) =>
                templatesIn(c).some((t) => t.id === id),
              ) ?? 'Other');
        const step = u.price >= 500 ? 5 : u.price >= 50 ? 2.5 : 0.5;
        const term = expiries[2] || when;
        return {
          symbol: on,
          price: u.price,
          expiry: when,
          // Not options: each is one vault action with its own tool.
          stockAndLending: [
            {
              name: 'Buy or sell stock',
              tool: 'trade_stock',
              description: `Spot ${on} at the live bid/ask, from vault cash or shares.`,
              example: { side: 'buy', symbol: on, quantity: 1 },
            },
            {
              name: 'Protected short',
              tool: 'open_short',
              description: `Borrow ${on} and sell it now. A protective call at the cap limits the loss if the price rises, and the vault reserves the cap times the quantity plus term interest until the short is closed or expires.`,
              example: {
                symbol: on,
                quantity: 1,
                cap: Math.ceil((u.price * 1.12) / step) * step,
                expiry: term,
              },
            },
            {
              name: 'Lend shares',
              tool: 'lend_shares',
              description: `Lend ${on} from the vault until an expiry and earn interest. The borrower's repurchase is escrowed with protection.`,
              example: { symbol: on, quantity: 1, expiry: term },
            },
            {
              name: 'Borrow cash against stock',
              tool: 'borrow_usdc',
              description: `Pledge ${on} and draw USDC, up to its loan-to-value, at a variable rate or fixed until an expiry. The pledge stays in the vault.`,
              example: {
                symbol: on,
                pledged: 1,
                amount: Math.floor(u.price * 0.3),
                rate: 'variable',
              },
            },
          ],
          products: templates
            // Dividend contracts settle on the stored 2025 event only.
            .filter((t) => !(live && t.reference === 'dividend'))
            .map((t) => ({
              name: t.name,
              family: family(t.id),
              description: t.description,
              terms: templateTerms(t.id, when, on, u.price),
            })),
        };
      }),
  );

  return server;
}
