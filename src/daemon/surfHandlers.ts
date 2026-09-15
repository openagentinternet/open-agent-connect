/**
 * Daemon-side MetaWeb surf handler group (OAC port of the IDBots
 * SurfService host wiring): per-bot SurfService instances (slug-keyed mutex,
 * run store as the crash-recovery anchor) plus the `metabot surf *` HTTP
 * surface — status/run/enable/disable/budget.
 *
 * The unattended LLM session executor is injected (`runSurfSession`) by the
 * daemon runtime, which owns the passive-LLM chain (DSH pair via the
 * host-executor lease first, then local CLI runtimes) and the full surf tool
 * wiring (see runtime.ts). Everything file/store/identity-shaped resolves
 * here in-process.
 */
import { commandFailed, commandSuccess } from '../core/contracts/commandResult';
import { createChainHistoryStore } from '../core/chainhistory/store';
import { createMemoryPolicyStore } from '../core/memory/memoryPolicy';
import { createStudyJobStore, retireQaSurfJobsForSurf } from '../core/knowledgebase/studyJobs';
import { createRuntimeStateStore } from '../core/state/runtimeStateStore';
import { resolveMetabotPaths } from '../core/state/paths';
import {
  createSurfProtocols,
} from '../core/surf/protocols';
import {
  SurfService,
  type SurfSessionContext,
  type SurfSessionResult,
} from '../core/surf/service';
import { createMetawebSurfStore } from '../core/surf/store';
import { createSurfSettingsStore } from '../core/surf/settings';
import { formatSurfRunList } from '../core/surf/format';
import { metawebInteractions, metawebProtocols } from '../core/surf/surfReads';

export interface SurfBotRef {
  slug: string;
  name: string;
  homeDir: string;
}

export interface CreateSurfDaemonHandlersInput {
  /** Resolve the acting bot (explicit slug, else the machine Twin). */
  resolveBot: (from?: string) => Promise<SurfBotRef | { failure: ReturnType<typeof commandFailed> }>;
  /**
   * The unattended surf session executor (LLM tool loop; see runtime.ts).
   * Absent → digest-only runs (report + watermarks still advance).
   */
  runSurfSession?: (context: SurfSessionContext) => Promise<SurfSessionResult>;
  /** so.metaid.io override (METABOT_METAWEB_API_BASE_URL propagation). */
  metawebBaseUrl?: string;
  /** Structured log sink (engine log). */
  log?: (message: string) => void;
}

const SURF_READS_OPTIONS = (baseUrl?: string) => (baseUrl ? { baseUrl } : undefined);

export function createSurfDaemonHandlers(input: CreateSurfDaemonHandlersInput) {
  const servicesByHome = new Map<string, SurfService>();
  const readsOptions = SURF_READS_OPTIONS(input.metawebBaseUrl);

  function serviceFor(bot: SurfBotRef): SurfService {
    let service = servicesByHome.get(bot.homeDir);
    if (!service) {
      const paths = resolveMetabotPaths(bot.homeDir);
      const store = createMetawebSurfStore(paths);
      const settings = createSurfSettingsStore(paths);
      const chainHistory = createChainHistoryStore(paths);
      const log = input.log ?? (() => undefined);
      service = new SurfService({
        botSlug: bot.slug,
        botName: bot.name,
        store,
        settings,
        broadcast: (payload) => {
          log(`[Surf] ${payload.botSlug} run ${payload.runId} ${payload.trigger} → ${payload.status}${payload.error ? ` (${payload.error})` : ''}`);
        },
        runSurfSession: input.runSurfSession,
        isMemoryEnabled: () => createMemoryPolicyStore(paths).effectivePolicy().then((policy) => policy.memoryEnabled),
        listChainWritesForSurf: async () => {
          const rows = await chainHistory.searchWrites({ limit: 2000 });
          return rows.map((row) => ({
            pinId: row.pinId,
            path: row.path,
            contentText: row.contentText,
          }));
        },
        registry: createSurfProtocols(input.metawebBaseUrl ? { baseUrl: input.metawebBaseUrl } : {}),
        getBotIdentity: async () => {
          // The identity is best-effort — bots without one simply get no inbox.
          try {
            const state = await createRuntimeStateStore(bot.homeDir).readState();
            const globalMetaId = state.identity?.globalMetaId ?? null;
            const address = state.identity?.addresses?.mvc ?? null;
            return globalMetaId || address ? { globalMetaId, address } : null;
          } catch {
            return null;
          }
        },
        fetchSurfInbox: async ({ owner, sinceTs }) => {
          // Page at most 2×50 (the briefing caps presentation at 30 anyway).
          const items: Array<{
            type: string;
            pinId: string;
            targetPinId: string;
            actorName: string;
            actorGlobalMetaId: string;
            createdAt: number;
            excerpt: string;
          }> = [];
          let cursor: string | undefined;
          for (let page = 0; page < 2; page += 1) {
            const result = await metawebInteractions(
              { owner, since: sinceTs, size: 50, ...(cursor ? { cursor } : {}) },
              readsOptions,
            );
            for (const item of result.items) {
              items.push({
                type: item.type,
                pinId: item.pinId,
                targetPinId: item.targetPinId,
                actorName: item.actor.name,
                actorGlobalMetaId: item.actor.globalMetaId,
                createdAt: item.createdAt,
                excerpt: item.excerpt,
              });
            }
            if (!result.hasMore || !result.nextCursor) break;
            cursor = result.nextCursor;
          }
          return items;
        },
        fetchProtocolRadar: async () => {
          const page = await metawebProtocols({ size: 50 }, readsOptions);
          return {
            items: page.items.map((item) => ({
              path: item.path,
              title: item.title,
              protocolName: item.protocolName,
              intro: item.intro,
              version: item.version,
              authorName: item.author.name,
              createdAt: item.createdAt,
            })),
            rejectedCount: page.rejected.length,
          };
        },
      });
      servicesByHome.set(bot.homeDir, service);
    }
    return service;
  }

  return {
    /** Crash recovery at daemon boot: orphaned `running` rows become failed. */
    recoverAfterRestart: async (): Promise<number> => {
      let recovered = 0;
      for (const service of servicesByHome.values()) {
        recovered += await service.recoverAfterRestart();
      }
      return recovered;
    },

    status: async (rawInput: { from?: string; limit?: number }) => {
      const bot = await input.resolveBot(rawInput.from);
      if ('failure' in bot) return bot.failure;
      const paths = resolveMetabotPaths(bot.homeDir);
      const limit = Math.max(1, Math.min(50, Math.floor(rawInput.limit ?? 5)));
      const [runs, settings] = await Promise.all([
        createMetawebSurfStore(paths).listRuns(limit),
        createSurfSettingsStore(paths).read(),
      ]);
      return commandSuccess({
        botSlug: bot.slug,
        runs,
        running: servicesByHome.get(bot.homeDir)?.isRunning() ?? false,
        surfBeforeDreamEnabled: settings.surfBeforeDreamEnabled,
        interactionBudget: settings.interactionBudget,
        formatted: formatSurfRunList(runs),
      });
    },

    run: async (rawInput: {
      from?: string;
      trigger?: 'manual-chat' | 'manual-ui' | 'pre-dream';
      wait?: boolean;
    }) => {
      const bot = await input.resolveBot(rawInput.from);
      if ('failure' in bot) return bot.failure;
      const trigger = rawInput.trigger === 'manual-chat' || rawInput.trigger === 'pre-dream'
        ? rawInput.trigger
        : 'manual-ui';
      const service = serviceFor(bot);
      try {
        if (rawInput.wait === true) {
          const run = await service.runSurfAndWait(trigger);
          return commandSuccess({
            runId: run.id,
            trigger,
            status: run.status,
            stats: run.stats,
            error: run.error,
            reportMarkdown: run.reportMarkdown,
          });
        }
        const run = await service.startSurf(trigger);
        return commandSuccess({ runId: run.id, trigger, status: 'running' });
      } catch (error) {
        return commandFailed(
          'surf_start_failed',
          error instanceof Error ? error.message : String(error),
        );
      }
    },

    enable: async (rawInput: { from?: string }) => {
      const bot = await input.resolveBot(rawInput.from);
      if ('failure' in bot) return bot.failure;
      const settings = createSurfSettingsStore(resolveMetabotPaths(bot.homeDir));
      const next = await settings.update({ surfBeforeDreamEnabled: true });
      // IDBots 0.9.1 migration: enabling surf retires the legacy nightly
      // qa-surf job — Q&A browsing now happens inside the surf run.
      let qaSurfRetired = false;
      try {
        qaSurfRetired = await retireQaSurfJobsForSurf(
          createStudyJobStore(resolveMetabotPaths(bot.homeDir)),
          bot.slug,
        );
      } catch {
        // A sick study store never blocks enabling surf.
      }
      return commandSuccess({
        surfBeforeDreamEnabled: next.surfBeforeDreamEnabled,
        interactionBudget: next.interactionBudget,
        qaSurfRetired,
      });
    },

    disable: async (rawInput: { from?: string }) => {
      const bot = await input.resolveBot(rawInput.from);
      if ('failure' in bot) return bot.failure;
      const settings = createSurfSettingsStore(resolveMetabotPaths(bot.homeDir));
      const next = await settings.update({ surfBeforeDreamEnabled: false });
      return commandSuccess({ surfBeforeDreamEnabled: next.surfBeforeDreamEnabled });
    },

    budget: async (rawInput: { from?: string; budget?: number }) => {
      const bot = await input.resolveBot(rawInput.from);
      if ('failure' in bot) return bot.failure;
      const settings = createSurfSettingsStore(resolveMetabotPaths(bot.homeDir));
      try {
        const next = await settings.update({ interactionBudget: rawInput.budget });
        return commandSuccess({ interactionBudget: next.interactionBudget });
      } catch (error) {
        return commandFailed(
          'invalid_budget',
          error instanceof Error ? error.message : String(error),
        );
      }
    },
  };
}

export type SurfDaemonHandlers = ReturnType<typeof createSurfDaemonHandlers>;
