import { readFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';

/*
 * /parcel for Claude Code. A personal skill is the only kind of command
 * Claude Code shows as a bare /parcel (a plugin's is always prefixed with
 * its name), so the desk serves the skill file for the Connect dialog's
 * one-line install. The skill works through the `parcel` server the same
 * dialog adds.
 */
const skill = readFileSync(new URL('./parcel-skill.md', import.meta.url));

/**
 * One line sets Claude Code up: `curl -fsSL <desk>/claude/install | sh`
 * adds the parcel server and the /parcel skill, pointed at this desk.
 */
function installer(origin: string) {
  return `#!/bin/sh
set -e
command -v claude >/dev/null 2>&1 || { echo "Install Claude Code first: https://claude.com/claude-code"; exit 1; }
claude mcp remove parcel --scope user >/dev/null 2>&1 || true
claude mcp add --transport http --scope user parcel ${origin}/mcp >/dev/null
mkdir -p "$HOME/.claude/skills/parcel"
curl -fsSL ${origin}/claude/parcel/SKILL.md -o "$HOME/.claude/skills/parcel/SKILL.md"
echo "Parcel is added to Claude Code."
echo "Open Claude Code, type /mcp, choose parcel, then Authenticate and Allow."
echo "Then type /parcel."
`;
}

export function handleSkill(
  path: string,
  origin: string,
  res: ServerResponse,
): boolean {
  if (path === '/claude/install') {
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(installer(origin));
    return true;
  }
  if (path !== '/claude/parcel/SKILL.md') return false;
  res.writeHead(200, {
    'Content-Type': 'text/markdown; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(skill);
  return true;
}
