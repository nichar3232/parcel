import { MarkEngine } from './prices/engine';
import { OddlotAdapter } from './oddlot/chain/adapter';
import { loadAssets } from './preipo/assets';
import { VaultChainCoordinator } from './oddlot/chain/coordinator';
import { VaultService } from './oddlot/service';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import type { Config } from './config';
import { Store } from './db/store';
import { ChainService } from './domain/chain';
import { PortfolioService, parseKey } from './domain/portfolio';
import { ApiError } from './http/errors';
import {
  body,
  cookie,
  json,
  mutationGuard,
  staticFile,
} from './http/primitives';
import { SolanaAdapter, type ChainAdapter } from './solana/adapter';
export function createApp(
  config: Config,
  options: { store?: Store; adapter?: ChainAdapter } = {},
) {
  const store =
    options.store || new Store(path.join(config.stateDir, 'strata.sqlite'));
  // Live marks are display and indicative pricing only; the vault's own
  // accounting stays on the stored session clock so settlement remains
  // deterministic. The engine never blocks a request: it ticks on its
  // own and every route just reads the latest snapshot. The one thing
  // the vault takes from it is a pool's utilisation when a cash loan
  // is priced, and the rate that produces is stored on the loan.
  const marks = new MarkEngine();
  marks.start();
  const vault = new VaultService(
    store,
    Date.now,
    config.oddlot ? 64 : 500,
    (symbol) => marks.mark(symbol)?.utilisation ?? null,
  );
  const oddlotAdapter = config.oddlot ? new OddlotAdapter(config) : undefined;
  const vaultChain = config.oddlot
    ? new VaultChainCoordinator(store, vault, oddlotAdapter!)
    : undefined;
  const portfolio = new PortfolioService(store),
    chain = new ChainService(
      store,
      options.adapter || new SolanaAdapter(config),
      config.stateDir,
    );
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=()',
    );
    try {
      const url = new URL(req.url || '/', 'http://localhost'),
        method = req.method || 'GET';
      if (!url.pathname.startsWith('/api/'))
        return await staticFile(req, res, url, config.publicDir);
      if (
        ['/api/health', '/api/ready'].includes(url.pathname) &&
        method === 'GET'
      ) {
        let database = 'ready';
        try {
          store.db.prepare('SELECT 1').get();
        } catch {
          database = 'unavailable';
        }
        const health = await chain.adapter.health();
        const oddlot = {
          ready: !oddlotAdapter,
          mode: oddlotAdapter ? 'localnet' : 'sandbox',
          reason: '',
        };
        if (oddlotAdapter) {
          try {
            await oddlotAdapter.health();
            oddlot.ready = true;
          } catch (e) {
            oddlot.reason = (e as Error).message;
          }
        }
        return json(
          res,
          database === 'ready' &&
            (url.pathname !== '/api/ready' ||
              (oddlot.ready && (oddlotAdapter || health.ready)))
            ? 200
            : 503,
          {
            ok: database === 'ready',
            app: 'oddlot',
            oddlot,
            database,
            chain: health,
            serverTime: Date.now(),
          },
        );
      }
      if (url.pathname === '/api/marks' && method === 'GET')
        return json(res, 200, marks.snapshot());
      if (url.pathname === '/api/evidence' && method === 'GET') {
        try {
          return json(
            res,
            200,
            JSON.parse(
              await readFile(`${config.stateDir}/evidence.json`, 'utf8'),
            ),
          );
        } catch {
          throw new ApiError(
            503,
            'EVIDENCE_UNAVAILABLE',
            'Chain verification evidence is not available.',
          );
        }
      }
      if (url.pathname.startsWith('/api/chain/tx/') && method === 'GET') {
        const signature = url.pathname.split('/').at(-1)!;
        if (!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(signature))
          throw new ApiError(400, 'SIGNATURE', 'Invalid signature.');
        try {
          return json(res, 200, await chain.adapter.proof(signature));
        } catch {
          try {
            return json(res, 200, {
              ...JSON.parse(
                await readFile(
                  `${config.stateDir}/proofs/${signature}.json`,
                  'utf8',
                ),
              ),
              archived: true,
            });
          } catch {
            throw new ApiError(
              404,
              'PROOF_UNAVAILABLE',
              'Transaction proof is unavailable.',
            );
          }
        }
      }
      let session = store.session(cookie(req));
      if (url.pathname === '/api/session' && method === 'GET') {
        if (!session) {
          const created = store.createSession();
          session = created.session;
          res.setHeader(
            'Set-Cookie',
            `strata_session=${created.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${config.secureCookie ? '; Secure' : ''}`,
          );
        }
        return json(res, 200, store.portfolio(session));
      }
      if (!session)
        throw new ApiError(
          401,
          'SESSION_REQUIRED',
          'Load a session before using the desk.',
        );
      if (url.pathname === '/api/preipo/assets' && method === 'GET') {
        const assets = await loadAssets({
            verifyRpcUrl:
              process.env.PREIPO_VERIFY_RPC_URL ||
              'https://api.mainnet-beta.solana.com',
            verifyNetwork: (process.env.PREIPO_VERIFY_NETWORK || 'mainnet') as
              | 'mainnet'
              | 'devnet'
              | 'localnet',
            programId: process.env.PREIPO_PROGRAM_ID || null,
            usdcMint: process.env.PREIPO_USDC_MINT || null,
        });
        // Peg a mock token to each sponsor's published mark. Nobody
        // publishes a live feed for a private company, so the engine
        // walks these between provider refreshes and re-anchors when
        // the provider moves.
        for (const a of assets.assets)
          if (a.quote?.markPriceUsd)
            marks.ensure(a.asset.symbol, a.quote.markPriceUsd);
        return json(res, 200, assets);
      }
      if (url.pathname === '/api/vault' && method === 'GET')
        return json(
          res,
          200,
          vaultChain ? vaultChain.snapshot(session) : vault.snapshot(session),
        );
      if (
        [
          '/api/vault/actions',
          '/api/vault/quote',
          '/api/vault/chain',
          '/api/vault/size',
        ].includes(url.pathname)
      ) {
        if (method !== 'POST')
          throw new ApiError(405, 'METHOD', 'POST required.');
        mutationGuard(req, config, session.csrf);
        const key = parseKey(req.headers['idempotency-key']),
          input = await body(req);
        return json(
          res,
          200,
          url.pathname === '/api/vault/chain' ||
            url.pathname === '/api/vault/size'
            ? vault.catalog(session, input, url.pathname === '/api/vault/size')
            : url.pathname === '/api/vault/quote'
              ? vault.quote(session, key, input)
              : vaultChain
                ? await vaultChain.apply(session, key, input)
                : vault.apply(session, key, input),
        );
      }
      if (url.pathname === '/api/portfolio' && method === 'GET')
        return json(res, 200, store.portfolio(session));
      if (url.pathname === '/api/chain/positions' && method === 'GET')
        return json(res, 200, chain.list(session));
      if (url.pathname.startsWith('/api/chain/positions/') && method === 'GET')
        return json(
          res,
          200,
          await chain.read(session, url.pathname.split('/').at(-1)!),
        );
      if (
        ['/api/portfolio/actions', '/api/chain/action'].includes(url.pathname)
      ) {
        if (method !== 'POST')
          throw new ApiError(405, 'METHOD', 'POST required.');
        mutationGuard(req, config, session.csrf);
        const key = parseKey(req.headers['idempotency-key']);
        const input = await body(req);
        return json(
          res,
          200,
          url.pathname === '/api/portfolio/actions'
            ? portfolio.apply(session, key, input)
            : await chain.action(session, key, input),
        );
      }
      throw new ApiError(404, 'NOT_FOUND', 'API route not found.');
    } catch (e) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const error =
        e instanceof ApiError
          ? e
          : new ApiError(
              500,
              'INTERNAL',
              'The request could not be completed.',
            );
      if (!(e instanceof ApiError)) console.error('Request failed:', e);
      res.removeHeader('Content-Length');
      json(res, error.status, { error: error.message, code: error.code });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return { server, store, chain, portfolio, vault, marks };
}
