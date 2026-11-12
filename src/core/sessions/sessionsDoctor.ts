/**
 * Doctor check for the local session layer (local session adapters P5a).
 *
 * Read-only: reports the registry state (readable? how many live sessions?
 * how many deliverable/bound?) and which host wiring files exist (ZCode MCP,
 * Cursor, Gemini). Never throws — doctor must degrade to an informative
 * check when nothing is set up yet.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveMetabotSessionPaths } from '../state/paths';

export interface SessionsDoctorCheck {
  code: 'local_sessions_layer';
  ok: boolean;
  registryPath: string;
  registryReadable: boolean;
  liveSessions: number;
  deliverableSessions: number;
  boundConversations: number;
  wiring: Record<string, string>;
  note?: string;
}

async function pathExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function firstExistingWiringFile(homes: { zcodeDir?: string; cursorDir?: string; geminiDir?: string; kimiDir?: string }): Promise<Record<string, string>> {
  const wiring: Record<string, string> = {};
  const zcodeDir = homes.zcodeDir ?? path.join(os.homedir(), '.zcode');
  const cursorDir = homes.cursorDir ?? path.join(os.homedir(), '.cursor');
  const geminiDir = homes.geminiDir ?? path.join(os.homedir(), '.gemini');
  const kimiDir = homes.kimiDir ?? path.join(os.homedir(), '.kimi-code');
  const candidates: Array<[string, string[]]> = [
    ['zcode', [path.join(zcodeDir, 'cli', 'config.json'), path.join(os.homedir(), '.agents', 'mcp.json')]],
    ['kimi', [path.join(kimiDir, 'mcp.json')]],
    ['cursor', [path.join(cursorDir, 'mcp.json'), path.join(cursorDir, 'hooks.json')]],
    ['gemini', [path.join(geminiDir, 'settings.json')]],
  ];
  for (const [host, files] of candidates) {
    wiring[host] = 'not-wired';
    for (const file of files) {
      if (await pathExists(file)) {
        wiring[host] = 'wired';
        break;
      }
    }
  }
  return wiring;
}

export async function buildSessionsDoctorCheck(
  systemHomeDir: string,
  homes: { zcodeDir?: string; cursorDir?: string; geminiDir?: string; kimiDir?: string } = {},
): Promise<SessionsDoctorCheck> {
  const sessionPaths = resolveMetabotSessionPaths(systemHomeDir);
  const registryReadable = await pathExists(sessionPaths.localSessionsPath);
  let liveSessions = 0;
  let deliverableSessions = 0;
  let boundConversations = 0;
  let note: string | undefined;
  if (registryReadable) {
    try {
      const raw = await fs.readFile(sessionPaths.localSessionsPath, 'utf8');
      const parsed = JSON.parse(raw) as { sessions?: Array<Record<string, unknown>> };
      const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
      const cutoff = Date.now() - 10 * 60_000;
      for (const session of sessions) {
        const lastSeenAt = typeof session.lastSeenAt === 'number' ? session.lastSeenAt : 0;
        if (lastSeenAt >= cutoff) {
          liveSessions += 1;
        }
        if (session.deliverable === true) {
          deliverableSessions += 1;
        }
        const bindings = Array.isArray(session.boundConversations) ? session.boundConversations : [];
        boundConversations += bindings.length;
      }
    } catch (error) {
      note = `Registry file exists but could not be read: ${error instanceof Error ? error.message : String(error)}`;
    }
  } else {
    note = 'No sessions registered yet — sessions appear here after a host is wired (metabot sessions wire --host …) and a session registers via MCP or hooks.';
  }
  return {
    code: 'local_sessions_layer',
    ok: true,
    registryPath: sessionPaths.localSessionsPath,
    registryReadable,
    liveSessions,
    deliverableSessions,
    boundConversations,
    wiring: await firstExistingWiringFile(homes),
    ...(note ? { note } : {}),
  };
}
