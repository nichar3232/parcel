import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Config } from '../config';
import type { Session, Store } from '../db/store';
import { ApiError, object } from './errors';

/*
 * How Claude, or any MCP app, connects to a vault: the way hosted MCP
 * services do it. The app is given one URL, /mcp. It finds this server's
 * OAuth metadata there, registers itself, and sends the owner to Parcel's
 * Allow page. Approving mints a one-time code bound to the app's PKCE
 * challenge, which the app trades for an agent key. No key is ever copied by
 * hand, and each app shows up as its own connection that can be cut.
 */

/** The address the requester reached this server at, behind a proxy too. */
export function publicOrigin(req: IncomingMessage, config: Config) {
  if (config.publicUrl) return config.publicUrl;
  const first = (h: string | string[] | undefined) =>
    (Array.isArray(h) ? h[0] : h)?.split(',')[0].trim();
  const proto =
    first(req.headers['x-forwarded-proto']) ||
    (config.secureCookie ? 'https' : 'http');
  const host =
    first(req.headers['x-forwarded-host']) || req.headers.host || 'localhost';
  return `${proto}://${host}`;
}

/** What /mcp answers without a key: where to go to get one. */
export function challenge(req: IncomingMessage, config: Config) {
  return `Bearer realm="parcel", resource_metadata="${publicOrigin(req, config)}/.well-known/oauth-protected-resource/mcp"`;
}

const send = (res: ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    // Discovery, registration and token exchange carry no cookie, so any
    // client, including a browser-based one, may call them.
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, mcp-protocol-version',
  });
  res.end(JSON.stringify(value));
};

const oauthError = (
  res: ServerResponse,
  status: number,
  error: string,
  description: string,
) => send(res, status, { error, error_description: description });

async function readForm(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const part of req) {
    total += (part as Buffer).length;
    if (total > 16_384) throw Error('Request too large.');
    chunks.push(part as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (req.headers['content-type']?.startsWith('application/json'))
    return object(JSON.parse(text || '{}')) as Record<string, unknown>;
  return Object.fromEntries(new URLSearchParams(text));
}

/** https anywhere; plain http only back to this machine, as a CLI listens. */
function allowedRedirect(uri: string) {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === 'https:') return true;
    return (
      u.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
    );
  } catch {
    return false;
  }
}

/** A text field, or empty when a request sends anything else. */
const str = (v: unknown) => (typeof v === 'string' ? v : '');

const s256 = (verifier: string) =>
  createHash('sha256').update(verifier).digest('base64url');

/** Handles discovery, registration, the Allow page and token exchange. */
export async function handleOAuth(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  store: Store,
  config: Config,
): Promise<boolean> {
  const path = url.pathname;
  if (!path.startsWith('/.well-known/oauth-') && !path.startsWith('/oauth/'))
    return false;
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers':
        'Content-Type, Authorization, mcp-protocol-version',
    });
    res.end();
    return true;
  }
  const origin = publicOrigin(req, config);

  if (path.startsWith('/.well-known/oauth-protected-resource')) {
    send(res, 200, {
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      scopes_supported: ['vault'],
      resource_name: 'Parcel',
    });
    return true;
  }
  if (path.startsWith('/.well-known/oauth-authorization-server')) {
    send(res, 200, {
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['vault'],
    });
    return true;
  }

  if (path === '/oauth/register' && req.method === 'POST') {
    let input: Record<string, unknown>;
    try {
      input = await readForm(req);
    } catch {
      oauthError(res, 400, 'invalid_client_metadata', 'Send JSON.');
      return true;
    }
    const uris = Array.isArray(input.redirect_uris)
      ? input.redirect_uris.map(String)
      : [];
    if (!uris.length || uris.length > 10 || !uris.every(allowedRedirect)) {
      oauthError(
        res,
        400,
        'invalid_redirect_uri',
        'Register https redirect URIs, or http ones on localhost.',
      );
      return true;
    }
    // Claude Code names a plugin's server "Claude Code (plugin:x:y)"; the
    // owner knows it as Claude Code.
    const name = (
      str(input.client_name).replace(/\s*\(plugin:[^)]*\)\s*$/, '') ||
      'An MCP app'
    ).slice(0, 60);
    const id = store.registerOAuthClient(name, uris);
    send(res, 201, {
      client_id: id,
      client_name: name,
      redirect_uris: uris,
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
    return true;
  }

  if (path === '/oauth/authorize' && req.method === 'GET') {
    const p = url.searchParams;
    const client = store.oauthClient(p.get('client_id') || '');
    const redirect = p.get('redirect_uri') || '';
    // Until the redirect is known to be the client's own, nothing may be
    // sent to it.
    if (!client || !client.redirectUris.includes(redirect)) {
      page(
        res,
        400,
        errorPage(
          'This connection link is not valid. Start again from the app you are connecting.',
        ),
      );
      return true;
    }
    const back = (error: string) => {
      const to = new URL(redirect);
      to.searchParams.set('error', error);
      if (p.get('state')) to.searchParams.set('state', p.get('state')!);
      res.writeHead(302, { Location: to.toString() });
      res.end();
    };
    if (p.get('response_type') !== 'code') {
      back('unsupported_response_type');
      return true;
    }
    if (!p.get('code_challenge') || p.get('code_challenge_method') !== 'S256') {
      back('invalid_request');
      return true;
    }
    page(
      res,
      200,
      allowPage({
        app: client.name,
        clientId: client.id,
        redirectUri: redirect,
        challenge: p.get('code_challenge')!,
        state: p.get('state') || '',
      }),
    );
    return true;
  }

  if (path === '/oauth/token' && req.method === 'POST') {
    let input: Record<string, unknown>;
    try {
      input = await readForm(req);
    } catch {
      oauthError(res, 400, 'invalid_request', 'Unreadable request.');
      return true;
    }
    if (input.grant_type !== 'authorization_code') {
      oauthError(res, 400, 'unsupported_grant_type', 'Use authorization_code.');
      return true;
    }
    const code = store.takeOAuthCode(str(input.code));
    const verifier = str(input.code_verifier);
    if (
      !code ||
      code.client_id !== str(input.client_id) ||
      code.redirect_uri !== str(input.redirect_uri) ||
      !verifier ||
      s256(verifier) !== code.challenge
    ) {
      oauthError(
        res,
        400,
        'invalid_grant',
        'This approval is invalid, used or expired. Connect again.',
      );
      return true;
    }
    const client = store.oauthClient(code.client_id);
    try {
      const { key } = store.createAgentKey(
        code.owner,
        Date.now(),
        client?.name || 'An MCP app',
      );
      send(res, 200, {
        access_token: key,
        token_type: 'Bearer',
        scope: 'vault',
      });
    } catch (e) {
      oauthError(res, 400, 'invalid_grant', (e as Error).message);
    }
    return true;
  }

  send(res, 404, { error: 'not_found' });
  return true;
}

/**
 * The owner's Allow, from the desk's own session. It goes through the same
 * CSRF guard as any desk action, and returns where to send the browser.
 */
export function approve(store: Store, session: Session, input: unknown) {
  const i = object(input);
  const client = store.oauthClient(str(i.clientId));
  const redirect = str(i.redirectUri);
  const challenge = str(i.challenge);
  if (!client || !client.redirectUris.includes(redirect) || !challenge)
    throw new ApiError(400, 'OAUTH', 'This connection request is not valid.');
  const code = store.createOAuthCode(
    client.id,
    session.id,
    redirect,
    challenge,
  );
  const to = new URL(redirect);
  to.searchParams.set('code', code);
  if (i.state) to.searchParams.set('state', str(i.state));
  return { redirect: to.toString() };
}

function page(res: ServerResponse, status: number, html: string) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    // The Allow button must never be framed by another site.
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy':
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  });
  res.end(html);
}

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

const shell = (title: string, body: string, script = '') => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<link rel="icon" href="/favicon.svg">
<style>
:root{color-scheme:dark;--bg:#0d1017;--surface:#111622;--line:#293346;--text:#f2f5fb;--body:#b3bdd0;--muted:#7d8aa1;--accent:#7da8ff;--ink:#0b1324;--down:#db826e}
@media (prefers-color-scheme:light){:root{color-scheme:light;--bg:#f4f6fb;--surface:#fff;--line:#d9dfea;--text:#121824;--body:#3b4659;--muted:#66728a;--accent:#3e62b5;--ink:#fff}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--body);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif}
main{width:100%;max-width:420px;background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:28px}
.brand{display:flex;align-items:center;gap:10px;color:var(--text);font-weight:600;letter-spacing:.14em;font-size:12px;margin-bottom:22px}
.brand img{width:22px;height:22px}
h1{margin:0 0 6px;color:var(--text);font-size:22px;line-height:1.25;font-weight:600}
p{margin:0 0 18px}
ul{margin:0 0 22px;padding:0;list-style:none;display:grid;gap:10px}
li{display:flex;gap:10px}
li::before{content:"";flex:none;width:6px;height:6px;margin-top:9px;border-radius:50%;background:var(--accent)}
.vault{display:flex;justify-content:space-between;padding:12px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);margin-bottom:22px;font-size:14px}
.vault b{color:var(--text);font-weight:600}
.actions{display:flex;gap:10px}
button{flex:1;height:44px;border-radius:10px;font:inherit;font-weight:600;cursor:pointer;border:1px solid var(--line);background:transparent;color:var(--text)}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--ink)}
button:disabled{opacity:.55;cursor:default}
.error{color:var(--down);margin:14px 0 0;font-size:14px}
small{display:block;margin-top:16px;color:var(--muted);font-size:12.5px}
</style></head><body><main>
<div class="brand"><img src="/favicon.svg" alt="">PARCEL</div>
${body}
</main>${script}</body></html>`;

const errorPage = (message: string) =>
  shell('Parcel', `<h1>Can’t connect</h1><p>${escape(message)}</p>`);

function allowPage(request: {
  app: string;
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
}) {
  const app = escape(request.app);
  return shell(
    `Connect ${request.app} to Parcel`,
    `<h1>${app} wants to use your Parcel vault</h1>
<p>It will be able to:</p>
<ul>
<li>See your balances, positions and activity</li>
<li>Price options and structures, and place trades with the same checks as the desk</li>
</ul>
<div class="vault"><span>Vault in this browser</span><b id="value">Loading…</b></div>
<div class="actions">
<button id="deny" type="button">Cancel</button>
<button id="allow" class="primary" type="button" disabled>Allow</button>
</div>
<p class="error" id="error" hidden></p>
<small>Everything ${app} does is marked Agent in Activity. Disconnect it at any time from Agents in the desk.</small>`,
    `<script>
const request = ${JSON.stringify(request).replace(/</g, '\\u003c')};
const $ = (id) => document.getElementById(id);
const fail = (m) => { $('error').textContent = m; $('error').hidden = false; };
let csrf = '';
fetch('/api/session', { credentials: 'same-origin' })
  .then((r) => r.json())
  .then((s) => {
    csrf = s.csrf;
    return fetch('/api/vault', { credentials: 'same-origin' }).then((r) => r.json());
  })
  .then((v) => {
    const b = v.book, price = (u) => (v.market.underlyings.find((x) => x.symbol === u) || {}).price || 0;
    const total = b.vault.USDC + Object.keys(b.vault).filter((k) => k !== 'USDC').reduce((t, k) => t + b.vault[k] * price(k), 0);
    $('value').textContent = total.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    $('allow').disabled = false;
  })
  .catch(() => fail('Could not open your vault. Open the Parcel desk in this browser, then try again.'));
$('deny').onclick = () => {
  const to = new URL(request.redirectUri);
  to.searchParams.set('error', 'access_denied');
  if (request.state) to.searchParams.set('state', request.state);
  location.href = to.toString();
};
$('allow').onclick = async () => {
  $('allow').disabled = true;
  try {
    const r = await fetch('/api/oauth/approve', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify(request),
    });
    const out = await r.json();
    if (!r.ok) throw Error(out.error || 'Approval failed.');
    location.href = out.redirect;
  } catch (e) {
    fail(e.message);
    $('allow').disabled = false;
  }
};
</script>`,
  );
}
