import { timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Config } from '../config';
import { ApiError } from './errors';
export function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(value));
}
export async function body(req: IncomingMessage) {
  if (!req.headers['content-type']?.startsWith('application/json'))
    throw new ApiError(415, 'JSON_REQUIRED', 'Use application/json.');
  let total = 0;
  const chunks: Buffer[] = [];
  for await (const part of req) {
    const chunk = Buffer.from(part as Uint8Array);
    total += chunk.length;
    if (total > 16_384)
      throw new ApiError(413, 'BODY_TOO_LARGE', 'Request body exceeds 16 KB.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new ApiError(
      400,
      'INVALID_JSON',
      'The request contains invalid JSON.',
    );
  }
}
export function cookie(req: IncomingMessage) {
  return req.headers.cookie
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith('strata_session='))
    ?.slice(15);
}
/** An agent key presented as `Authorization: Bearer …`. */
export function bearer(req: IncomingMessage) {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7).trim() : undefined;
}
/**
 * The request came from this machine directly. A reverse proxy also connects
 * from loopback, so a forwarded request never counts.
 */
export function loopback(req: IncomingMessage) {
  const a = req.socket.remoteAddress;
  return (
    !req.headers['x-forwarded-for'] &&
    !req.headers.forwarded &&
    (a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1')
  );
}
export function equal(a: string, b: string) {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function mutationGuard(
  req: IncomingMessage,
  config: Config,
  csrf: string,
) {
  const origin = req.headers.origin;
  if (req.headers['sec-fetch-site'] === 'cross-site')
    throw new ApiError(
      403,
      'ORIGIN_DENIED',
      'Cross-site actions are not allowed.',
    );
  if (origin) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new ApiError(403, 'ORIGIN_DENIED', 'Invalid request origin.');
    }
    if (
      !config.allowedOrigins.includes(origin) &&
      parsed.host !== req.headers.host
    )
      throw new ApiError(
        403,
        'ORIGIN_DENIED',
        'Cross-origin actions are not allowed.',
      );
  }
  const token = req.headers['x-csrf-token'];
  if (typeof token !== 'string' || !equal(token, csrf))
    throw new ApiError(
      403,
      'CSRF_REQUIRED',
      'Refresh the session before submitting an action.',
    );
}
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.rsc': 'text/x-component',
  '.txt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};
export async function staticFile(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  root: string,
) {
  try {
    root = await realpath(root);
  } catch {
    throw new ApiError(
      503,
      'BUILD_MISSING',
      'Build the frontend before starting the app.',
    );
  }
  if (!['GET', 'HEAD'].includes(req.method || ''))
    throw new ApiError(405, 'METHOD', 'Method not allowed.');
  let name: string;
  try {
    name = decodeURIComponent(url.pathname);
  } catch {
    throw new ApiError(400, 'PATH', 'Malformed path.');
  }
  if (name.includes('\0') || name.includes('\\'))
    throw new ApiError(400, 'PATH', 'Invalid path.');
  if (name.endsWith('/')) name += 'index.html';
  let file = path.resolve(root, '.' + name);
  if (!file.startsWith(root + path.sep))
    throw new ApiError(403, 'PATH', 'Forbidden path.');
  let info;
  try {
    const resolved = await realpath(file);
    if (!resolved.startsWith(root + path.sep))
      throw new Error('Forbidden symlink');
    info = await stat(resolved);
    if (!info.isFile()) throw new Error('Not a file');
    file = resolved;
  } catch {
    if (path.extname(name))
      throw new ApiError(404, 'NOT_FOUND', 'File not found.');
    try {
      const route = await realpath(file + '.html');
      if (!route.startsWith(root + path.sep))
        throw new Error('Forbidden route symlink');
      info = await stat(route);
      if (!info.isFile()) throw new Error('Not a route file');
      file = route;
    } catch {
      file = path.join(root, 'index.html');
    }
    try {
      info = await stat(file);
    } catch {
      throw new ApiError(
        503,
        'BUILD_MISSING',
        'Build the frontend before starting the app.',
      );
    }
  }
  // Re-check the final fallback too: index.html may itself be a symlink.
  file = await realpath(file);
  if (!file.startsWith(root + path.sep))
    throw new ApiError(403, 'PATH', 'Forbidden path.');
  info = await stat(file);
  const etag = `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
  res.setHeader('ETag', etag);
  res.setHeader(
    'Content-Type',
    types[path.extname(file)] || 'application/octet-stream',
  );
  res.setHeader(
    'Cache-Control',
    file.includes('/_next/static/')
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  );
  res.setHeader('Accept-Ranges', 'bytes');
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304);
    res.end();
    return;
  }
  let start = 0,
    end = info.size - 1,
    status = 200;
  if (req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!match || (!match[1] && !match[2]))
      throw new ApiError(416, 'RANGE', 'Invalid byte range.');
    if (!match[1]) start = Math.max(0, info.size - Number(match[2]));
    else {
      start = Number(match[1]);
      if (match[2]) end = Math.min(end, Number(match[2]));
    }
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end ||
      start >= info.size
    ) {
      res.setHeader('Content-Range', `bytes */${info.size}`);
      throw new ApiError(416, 'RANGE', 'Unsatisfiable byte range.');
    }
    status = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`);
  }
  res.setHeader('Content-Length', end - start + 1);
  res.writeHead(status);
  if (req.method === 'HEAD' || info.size === 0) {
    res.end();
    return;
  }
  await pipeline(createReadStream(file, { start, end }), res);
}
