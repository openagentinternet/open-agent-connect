/**
 * MetaTask daemon handler group: owns the system-level projection store
 * (~/.metabot/runtime/metatask — chain truth is global, so the cache is shared
 * across profiles) and the single refresher instance. Read verbs serve the
 * board / task / replay views; `refresh` sweeps the chain (the daemon tick
 * calls it with bypassMinInterval so its own cadence is never deferred by
 * tool-triggered coalescing).
 *
 * All replay logic lives in core/metatask/engine; this file is wiring +
 * input normalization only, mirroring grouptaskHandlers.
 */

import {
  commandFailed,
  commandSuccess,
  type MetabotCommandResult,
} from '../core/contracts/commandResult';
import { replayMetaTask } from '../core/metatask/engine/engine';
import { estimateMetaTaskShares } from '../core/metatask/engine/estimate';
import { MetaTaskRefresher } from '../core/metatask/refresher';
import { createMetaTaskStore, type MetaTaskStore } from '../core/metatask/store';
import { listMetabotProfiles } from '../core/bot/metabotProfileManager';
import { resolveMetabotDaemonPaths } from '../core/state/paths';

export interface MetaTaskDaemonHandlers {
  board: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  task: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  replay: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  refresh: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readBool(value: unknown): boolean {
  return value === true || value === 'true';
}

/** Compact replay view used by `metabot metatask replay` / the UI chain table. */
function replaySummaryOf(projection: ReturnType<typeof replayMetaTask>) {
  return {
    rootPinId: projection.rootPinId,
    title: projection.title,
    policy: projection.policy,
    nodes: Object.values(projection.nodeStates).map((node) => ({
      id: node.id,
      title: node.title,
      status: node.status,
      disputed: node.disputed,
      holder: node.holder?.claimant ?? null,
      submitter: node.submission?.submitter ?? null,
      passVotes: node.passVotes,
      failVotes: node.failVotes,
      weight: node.weight,
    })),
    progress: projection.progress,
    taskComplete: projection.taskComplete,
    settlement: projection.settlement,
    estimation: projection.settlement ? null : estimateMetaTaskShares(projection),
    ignoredEvents: projection.ignoredEvents,
    freshness: projection.freshness,
  };
}

/**
 * Build the MetaTask handler group: one system-level store, one refresher
 * (ordinary HTTP callers coalesce to one sweep per 60s), and the local-roster
 * resolver that feeds board myRoles/myStats and display identities.
 */
export function createMetaTaskDaemonHandlers(input: {
  systemHomeDir: string;
  /** Minimum sweep spacing for ordinary HTTP callers (tests drop it to 0). */
  minIntervalMs?: number;
  log?: (message: string) => void;
}): MetaTaskDaemonHandlers {
  const daemonPaths = resolveMetabotDaemonPaths(input.systemHomeDir);
  let profileNames = new Map<string, string>();
  let rosterIds: string[] = [];
  const loadRoster = async (): Promise<string[]> => {
    const profiles = await listMetabotProfiles(input.systemHomeDir).catch(() => []);
    profileNames = new Map();
    rosterIds = [];
    for (const profile of profiles) {
      if (!profile.globalMetaId) continue;
      rosterIds.push(profile.globalMetaId);
      profileNames.set(profile.globalMetaId, profile.name || profile.slug || profile.globalMetaId);
    }
    return rosterIds;
  };
  const store: MetaTaskStore = createMetaTaskStore(`${daemonPaths.runtimeRoot}/metatask`, {
    // Local roster first (the manager's profile registry); remote identity
    // lookups are P7 hardening — unresolved metaIds simply show their raw id.
    resolveIdentities: async (metaIds) => {
      const out: Record<string, { metaId: string; name: string | null; avatar: null }> = {};
      for (const metaId of metaIds) {
        const name = profileNames.get(metaId);
        if (name) out[metaId] = { metaId, name, avatar: null };
      }
      return out;
    },
  });

  const refresher = new MetaTaskRefresher({
    store: () => store,
    rosterMetaIds: () => rosterIds,
    minIntervalMs: input.minIntervalMs ?? 60_000,
  });

  return {
    board: async (rawInput) => {
      try {
        if (readBool(rawInput.refresh)) {
          await loadRoster();
          const result = await refresher.refreshOnce('board-refresh');
          if (!result.ok) {
            return commandFailed('metatask_refresh_failed', result.error ?? 'MetaTask refresh failed.');
          }
        }
        return commandSuccess(await refresher.board());
      } catch (error) {
        return commandFailed(
          'metatask_board_failed',
          error instanceof Error ? error.message : 'Failed to read the MetaTask board.'
        );
      }
    },

    task: async (rawInput) => {
      const rootPinId = normalizeText(rawInput.root);
      if (!rootPinId) return commandFailed('invalid_input', 'A --root task pin id is required.');
      try {
        if (readBool(rawInput.refresh)) {
          await loadRoster();
          await refresher.refreshOnce('task-refresh');
        }
        const projection = await refresher.detail(rootPinId);
        if (!projection) {
          return commandFailed(
            'metatask_not_found',
            `No cached projection for task root ${rootPinId}. Run a refresh first.`
          );
        }
        const openNodes = Object.values(projection.nodeStates)
          .filter((node) => node.status !== 'verified')
          .map((node) => ({
            id: node.id,
            title: node.title,
            status: node.status,
            kind: node.kind,
            weight: node.weight,
            deps: node.deps,
          }));
        return commandSuccess({
          ...projection,
          estimation: projection.settlement ? null : estimateMetaTaskShares(projection),
          openNodes,
        });
      } catch (error) {
        return commandFailed(
          'metatask_task_failed',
          error instanceof Error ? error.message : 'Failed to read the MetaTask projection.'
        );
      }
    },

    replay: async (rawInput) => {
      const rootPinId = normalizeText(rawInput.root);
      if (!rootPinId) return commandFailed('invalid_input', 'A --root task pin id is required.');
      try {
        const events = await store.loadEvents();
        return commandSuccess(replaySummaryOf(replayMetaTask(events, { rootPinId })));
      } catch (error) {
        return commandFailed(
          'metatask_replay_failed',
          error instanceof Error ? error.message : 'Failed to replay the MetaTask event set.'
        );
      }
    },

    refresh: async (rawInput) => {
      try {
        await loadRoster();
        const reason = normalizeText(rawInput.reason) || 'http-refresh';
        const result = await refresher.refreshOnce(reason, {
          bypassMinInterval: readBool(rawInput.bypassMinInterval),
        });
        if (!result.ok) {
          return commandFailed('metatask_refresh_failed', result.error ?? 'MetaTask refresh failed.');
        }
        return commandSuccess(result.board);
      } catch (error) {
        return commandFailed(
          'metatask_refresh_failed',
          error instanceof Error ? error.message : 'MetaTask refresh failed.'
        );
      }
    },
  };
}
