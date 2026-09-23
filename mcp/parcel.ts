/*
 * Parcel's MCP server over stdio, for a local agent such as Claude Code.
 *
 * PARCEL_URL        the running app (default http://localhost:3025)
 * PARCEL_AGENT_KEY  a key from the desk's Agents dialog (preferred)
 * PARCEL_SESSION    or a browser's strata_session cookie value
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createParcelMcp } from './tools';

await createParcelMcp({
  base: process.env.PARCEL_URL || 'http://localhost:3025',
  agentKey: process.env.PARCEL_AGENT_KEY || undefined,
  session: process.env.PARCEL_SESSION || undefined,
}).connect(new StdioServerTransport());
