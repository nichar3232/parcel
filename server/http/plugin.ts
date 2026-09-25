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

export function handleSkill(path: string, res: ServerResponse): boolean {
  if (path !== '/claude/parcel/SKILL.md') return false;
  res.writeHead(200, {
    'Content-Type': 'text/markdown; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(skill);
  return true;
}
