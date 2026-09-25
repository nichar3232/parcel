import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { crc32, deflateRawSync } from 'node:zlib';

/*
 * Parcel as a Claude Code plugin, served by the desk itself. Adding the
 * marketplace and installing the plugin gives a user /parcel, and connects
 * the plugin's MCP server to this desk's /mcp, which signs in through the
 * same Allow page as any other agent. Both files are built per request
 * from the address the desk was reached at, so nothing names a host.
 * Claude Code installs archives only over https from a public host, so this
 * serves a deployed desk; a local one installs from the repository.
 */

// The same plugin the repository publishes as a marketplace (claude-plugin/),
// with its server pointed at this desk.
const root = new URL('../../claude-plugin/', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

function plugin(origin: string) {
  return zip([
    ['.claude-plugin/plugin.json', read('.claude-plugin/plugin.json')],
    ['skills/parcel/SKILL.md', read('skills/parcel/SKILL.md')],
    [
      '.mcp.json',
      JSON.stringify(
        { mcpServers: { parcel: { type: 'http', url: `${origin}/mcp` } } },
        null,
        2,
      ),
    ],
  ]);
}

/** Serves /claude/marketplace.json and /claude/parcel.zip. */
export function handlePlugin(
  path: string,
  origin: string,
  res: ServerResponse,
): boolean {
  if (path !== '/claude/marketplace.json' && path !== '/claude/parcel.zip')
    return false;
  const archive = plugin(origin);
  if (path === '/claude/parcel.zip') {
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="parcel.zip"',
      'Cache-Control': 'no-store',
    });
    res.end(archive);
    return true;
  }
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(
    JSON.stringify(
      {
        name: 'parcel',
        owner: { name: 'Parcel' },
        plugins: [
          {
            name: 'parcel',
            description:
              'Your Parcel vault in Claude Code: balances, products and trades with /parcel.',
            source: {
              source: 'archive',
              url: `${origin}/claude/parcel.zip`,
              sha256: createHash('sha256').update(archive).digest('hex'),
            },
          },
        ],
      },
      null,
      2,
    ),
  );
  return true;
}

/**
 * A plain deflate zip. Fixed timestamps keep the archive, and so the hash
 * the marketplace pins, identical for identical content.
 */
function zip(files: [string, string][]) {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const path = Buffer.from(name);
    const data = Buffer.from(text);
    const packed = deflateRawSync(data);
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6);
    head.writeUInt16LE(8, 8);
    head.writeUInt16LE(0x21, 12); // 1980-01-01
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(path.length, 26);
    local.push(head, path, packed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(path.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, path);
    offset += head.length + path.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
