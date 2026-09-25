import { MarkEngine } from './prices/engine';
import { LiveMarketService } from './prices/live';
import { setLiveMarket } from '../lib/parcel/market';
import { TokenizedEquitiesService } from './tokenized-equities/service';
import { XStocksService } from './xstocks/service';
import { ParcelAdapter } from './parcel/chain/adapter';
import { loadAssets } from './preipo/assets';
import { VaultChainCoordinator } from './parcel/chain/coordinator';
import { VaultService } from './parcel/service';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import type { Config } from './config';
import { Store } from './db/store';
import { ChainService } from './domain/chain';
import { PortfolioService, parseKey } from './domain/portfolio';
import { ApiError, object } from './http/errors';
import { handleMcp } from './http/mcp';
import { approve, challenge, handleOAuth, publicOrigin } from './http/oauth';
import { handleSkill } from './http/plugin';
import { walletChallenge, walletSignIn } from './http/wallet';
import {
  bearer,
  body,
  cookie,
  json,
  mutationGuard,
  staticFile,
} from './http/primitives';
import { SolanaAdapter, type ChainAdapter } from './solana/adapter';
export function createApp(
  config: Config,
  options: {
    store?: Store;
    adapter?: ChainAdapter;
    xstocks?: XStocksService;
    tokenizedEquities?: TokenizedEquitiesService;
    /**
     * Price and settle the vault on the live market rather than the 2025
     * replay. The server entrypoint turns it on; tests leave the replay.
     */
    live?: boolean;
  } = {},
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
  // On the chain, every live action carries the clock it ran at: the
  // attested NVDA mark and any expiry closes it settled at. The program
  // takes those past the replay window and still holds replay dates to
  // the committed table.
  const live = options.live ? new LiveMarketService(marks, store) : undefined;
  if (live) {
    setLiveMarket(live);
    live.start();
  }
  // xStocks has its own issuer registry and quote endpoint. It is not a
  // MarkEngine instrument: a missing issuer quote must read as unavailable,
  // never as the sandbox engine's modelled walk.
  const xstocks = options.xstocks || new XStocksService();
  const tokenizedEquities =
    options.tokenizedEquities ||
    new TokenizedEquitiesService(xstocks, undefined, undefined, Date.now, {
      cacheFile: path.join(config.stateDir, 'tokenized-equities.json'),
    });
  // Warm issuer inventories before a visitor opens Watchlist. `snapshot()`
  // still remains non-blocking if the app has only just started.
  tokenizedEquities.warm();
  const vault = new VaultService(
    store,
    Date.now,
    config.parcel ? 64 : 500,
    (symbol) => marks.mark(symbol)?.utilisation ?? null,
    !!config.parcel,
  );
  const parcelAdapter = config.parcel ? new ParcelAdapter(config) : undefined;
  const vaultChain = config.parcel
    ? new VaultChainCoordinator(store, vault, parcelAdapter!)
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
      if (await handleOAuth(req, res, url, store, config)) return;
      if (handleSkill(url.pathname, publicOrigin(req, config), res)) return;
      if (url.pathname === '/mcp' || url.pathname === '/mcp/')
        return await handleMcp(
          req,
          res,
          store,
          () => {
            const a = server.address();
            return `http://127.0.0.1:${a && typeof a === 'object' ? a.port : config.port}`;
          },
          challenge(req, config),
        );
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
        const markSnapshot = marks.snapshot();
        const nbbo = markSnapshot.sources.find(
          (source) => source.name === 'massive-nbbo',
        );
        const marketData = {
          ready:
            !config.marketDataRequired ||
            (nbbo?.enabled === true && nbbo.state === 'live'),
          required: config.marketDataRequired,
          sources: markSnapshot.sources,
        };
        const parcel = {
          ready: !parcelAdapter,
          mode: parcelAdapter ? parcelAdapter.network : 'sandbox',
          reason: '',
        };
        if (parcelAdapter) {
          try {
            await parcelAdapter.health();
            parcel.ready = true;
          } catch (e) {
            parcel.reason = (e as Error).message;
          }
        }
        return json(
          res,
          database === 'ready' &&
            (url.pathname !== '/api/ready' ||
              (parcel.ready &&
                (parcelAdapter || health.ready) &&
                marketData.ready))
            ? 200
            : 503,
          {
            ok: database === 'ready',
            app: 'parcel',
            parcel,
            database,
            chain: health,
            marketData,
            serverTime: Date.now(),
          },
        );
      }
      if (url.pathname === '/api/marks/stream' && method === 'GET') {
        // Market-data credentials stay server-side. Browser clients receive a
        // coalesced same-origin event stream instead of each opening its own
        // vendor socket (or, worse, receiving a credential in the bundle).
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        let ended = false;
        let timer: NodeJS.Timeout | null = null;
        const write = () => {
          if (ended || res.writableEnded) return;
          res.write(
            `event: marks\ndata: ${JSON.stringify(marks.snapshot())}\n\n`,
          );
        };
        const flush = () => {
          if (timer) clearTimeout(timer);
          timer = null;
          write();
        };
        // The upstream feed can burst hundreds of events together. Preserve
        // the newest complete NBBO state but keep a browser frame bounded to
        // ten updates a second; its `observedAt` remains the provider time.
        const schedule = () => {
          if (!timer) timer = setTimeout(flush, 100);
        };
        const unsubscribe = marks.subscribe(schedule);
        const close = () => {
          if (ended) return;
          ended = true;
          unsubscribe();
          if (timer) clearTimeout(timer);
          timer = null;
          if (!res.writableEnded) res.end();
        };
        req.once('close', close);
        res.once('error', close);
        write();
        return;
      }
      if (url.pathname === '/api/marks' && method === 'GET')
        return json(res, 200, marks.snapshot());
      if (url.pathname === '/api/marks/daily' && method === 'GET') {
        const symbol = (url.searchParams.get('symbol') || '').toUpperCase();
        return json(res, 200, { symbol, closes: live?.history(symbol) ?? [] });
      }
      if (url.pathname === '/api/marks/intraday' && method === 'GET') {
        const symbols = (url.searchParams.get('symbols') || '')
          .split(',')
          .map((symbol) => symbol.trim().toUpperCase())
          .filter(Boolean)
          .slice(0, 20);
        return json(res, 200, {
          days: symbols.flatMap((symbol) => marks.intraday(symbol) ?? []),
        });
      }
      if (url.pathname === '/api/xstocks' && method === 'GET')
        return json(res, 200, await xstocks.catalog());
      if (url.pathname === '/api/xstocks/quotes' && method === 'GET') {
        const symbols = (url.searchParams.get('symbols') || '')
          .split(',')
          .map((symbol) => symbol.trim())
          .filter(Boolean);
        return json(res, 200, { quotes: await xstocks.quotes(symbols) });
      }
      if (url.pathname === '/api/tokenized-equities' && method === 'GET')
        return json(res, 200, tokenizedEquities.snapshot());
      if (
        url.pathname === '/api/tokenized-equities/quotes' &&
        method === 'GET'
      ) {
        const ids = (url.searchParams.get('ids') || '')
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
          .slice(0, 50);
        return json(res, 200, { quotes: await tokenizedEquities.quotes(ids) });
      }
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
      // An agent key stands in for the session cookie only at the narrowly
      // scoped vault API. It carries no ambient browser credential, so its
      // permitted mutation requests need no CSRF token and vault actions are
      // explicitly marked as agent initiated.
      const agentKey = bearer(req);
      let session = agentKey
        ? store.agentSession(agentKey)
        : store.session(cookie(req));
      if (agentKey && !session)
        throw new ApiError(
          401,
          'AGENT_KEY_INVALID',
          'This agent key is not valid or was revoked.',
        );
      if (
        agentKey &&
        ![
          '/api/vault',
          '/api/vault/actions',
          '/api/vault/quote',
          '/api/vault/chain',
          '/api/vault/size',
        ].includes(url.pathname)
      )
        throw new ApiError(
          403,
          'AGENT_KEY_SCOPE',
          'This agent key may only access the Parcel vault API.',
        );
      const guard = () => {
        if (!agentKey) mutationGuard(req, config, session!.csrf);
      };
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
      if (url.pathname === '/api/wallet' && method === 'GET')
        return json(res, 200, {
          required: config.walletSignIn,
          address: store.sessionWallet(session.id),
        });
      if (url.pathname.startsWith('/api/wallet/')) {
        if (agentKey)
          throw new ApiError(403, 'AGENT_KEY_SCOPE', 'Sign in from the desk.');
        if (method !== 'POST')
          throw new ApiError(405, 'METHOD', 'POST required.');
        guard();
        if (url.pathname === '/api/wallet/challenge')
          return json(
            res,
            200,
            walletChallenge(session, publicOrigin(req, config)),
          );
        if (url.pathname === '/api/wallet/signin')
          return json(res, 200, walletSignIn(store, session, await body(req)));
        if (url.pathname === '/api/wallet/signout') {
          store.setSessionWallet(session.id, null);
          return json(res, 200, { address: null });
        }
      }
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
        // publishes an executable book for a private company. Preserve the
        // publisher's own timestamp and make the intervening sandbox walk
        // explicit rather than presenting it as a live mark.
        for (const a of assets.assets)
          if (a.quote?.markPriceUsd)
            marks.publishPreStocks(
              a.asset.symbol,
              a.quote.markPriceUsd,
              Date.parse(a.quote.fetchedAt) || Date.now(),
            );
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
        guard();
        const key = parseKey(req.headers['idempotency-key']);
        let input = await body(req);
        if (agentKey && url.pathname === '/api/vault/actions')
          input = { ...object(input), source: 'agent' };
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
      if (url.pathname === '/api/oauth/approve') {
        if (method !== 'POST')
          throw new ApiError(405, 'METHOD', 'POST required.');
        if (!session)
          throw new ApiError(401, 'SESSION', 'Open the Parcel desk first.');
        guard();
        return json(res, 200, approve(store, session, await body(req)));
      }
      if (url.pathname.startsWith('/api/agent/keys')) {
        // Keys are managed from the desk only; one key cannot mint another.
        if (agentKey)
          throw new ApiError(
            403,
            'AGENT_KEY_SCOPE',
            'Agent keys are managed from the desk.',
          );
        if (url.pathname === '/api/agent/keys' && method === 'GET')
          return json(res, 200, {
            keys: store.agentKeys(session.id),
            // The address to hand an agent; absent, the desk's own origin.
            mcpUrl: config.publicUrl ? `${config.publicUrl}/mcp` : null,
          });
        if (method !== 'POST')
          throw new ApiError(405, 'METHOD', 'POST required.');
        guard();
        if (url.pathname === '/api/agent/keys')
          return json(res, 200, store.createAgentKey(session.id));
        const revoke = url.pathname.match(
          /^\/api\/agent\/keys\/([0-9a-f-]{36})\/revoke$/,
        );
        if (revoke) {
          store.revokeAgentKey(session.id, revoke[1]);
          return json(res, 200, { keys: store.agentKeys(session.id) });
        }
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
        guard();
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
  return {
    server,
    store,
    chain,
    portfolio,
    vault,
    marks,
    live,
    xstocks,
    tokenizedEquities,
  };
}
