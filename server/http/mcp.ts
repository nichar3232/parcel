import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createParcelMcp } from '../../mcp/tools';
import type { Store } from '../db/store';
import { bearer, json } from './primitives';

/*
 * Parcel's MCP endpoint, so an agent needs only a URL and a key. It is
 * stateless: each POST builds the tools for the key it carries, and those
 * tools call this server's own API with that key, through the same checks the
 * desk's requests pass.
 */
export async function handleMcp(
  req: IncomingMessage,
  res: ServerResponse,
  store: Store,
  localBase: () => string,
  pathKey?: string,
) {
  // A client that takes only a URL (a connector, most GUI apps) carries the
  // key in the path instead: /mcp/<key>.
  const key = bearer(req) ?? pathKey;
  if (!store.agentSession(key)) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="parcel"');
    return json(res, 401, {
      error:
        'An agent key is required. Create one in the desk under Agents and send it as a bearer token, or connect to /mcp/<key>.',
      code: 'AGENT_KEY_REQUIRED',
    });
  }
  if (req.method !== 'POST')
    return json(res, 405, {
      error: 'This endpoint is stateless; send MCP requests with POST.',
      code: 'METHOD',
    });
  const server = createParcelMcp({ base: localBase(), agentKey: key });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}
