import { fileURLToPath } from 'node:url';

/** How Claude's desktop app launches Parcel's stdio MCP server here. */
export interface DesktopEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * Absolute paths throughout: the app does not start servers with a shell's
 * PATH, so `npx` or a bare `node` may not resolve.
 */
export function desktopEntry(key: string, port: number): DesktopEntry {
  return {
    command: process.execPath,
    args: [
      fileURLToPath(
        new URL('../../node_modules/tsx/dist/cli.mjs', import.meta.url),
      ),
      fileURLToPath(new URL('../../mcp/parcel.ts', import.meta.url)),
    ],
    env: { PARCEL_URL: `http://127.0.0.1:${port}`, PARCEL_AGENT_KEY: key },
  };
}
