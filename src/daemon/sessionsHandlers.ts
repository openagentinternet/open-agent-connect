/**
 * Daemon-side sessions handler group: the /api/sessions/* verbs backing the
 * `metabot sessions *` CLI surface (local session adapters P1). The list
 * verb runs the passive discovery scans (Claude Code registry files, Codex
 * session index), merges presence into the machine-wide registry, and
 * returns the directory. Read-only in P1: nothing is delivered to any
 * session yet, and discovery entries are never deliverable.
 */

import { commandSuccess } from '../core/contracts/commandResult';
import { scanClaudeSessions } from '../core/sessions/discovery/claude';
import { scanCodexSessions } from '../core/sessions/discovery/codex';
import { createLocalSessionRegistry } from '../core/sessions/registry';
import { resolveMetabotSessionPaths } from '../core/state/paths';
import type { MetabotDaemonHttpHandlers } from './routes/types';

export interface SessionsDaemonHandlersInput {
  /** The machine-wide system home that owns `~/.metabot/sessions/`. */
  systemHomeDir: string;
  /** Overrides for tests: discovery roots (`<dir>/sessions`, `<dir>/session_index.jsonl`). */
  claudeDir?: string;
  codexDir?: string;
  now?: () => number;
}

export function createSessionsDaemonHandlers(
  input: SessionsDaemonHandlersInput,
): NonNullable<MetabotDaemonHttpHandlers['sessions']> {
  const sessionPaths = resolveMetabotSessionPaths(input.systemHomeDir);
  const registry = createLocalSessionRegistry({
    statePath: sessionPaths.localSessionsPath,
    now: input.now,
  });

  return {
    list: async ({ all }) => {
      const [claudeSessions, codexSessions] = await Promise.all([
        scanClaudeSessions({ claudeDir: input.claudeDir, now: input.now }),
        scanCodexSessions({ codexDir: input.codexDir, now: input.now }),
      ]);
      await registry.applyDiscovery([...claudeSessions, ...codexSessions]);
      const sessions = await registry.list({ all: all === true });
      return commandSuccess({
        sessions,
        discovered: { 'claude-code': claudeSessions.length, codex: codexSessions.length },
      });
    },
  };
}
