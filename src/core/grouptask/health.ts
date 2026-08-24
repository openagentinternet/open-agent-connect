/**
 * Group task health report — the read-only preflight the DSH banner and the
 * `metabot grouptask health` verb surface. The live-diagnosis round showed
 * the real failures are silent prerequisites: invites arriving while no
 * engine is alive expire without a trace, owner identity or twin absence
 * blocks creation, and a disabled simplemsg listener silently kills OpenTeam
 * intake. This module turns those into one inspectable snapshot; the engine
 * log tail carries whatever actually failed lately.
 */
import { listGroupTaskSummaries, resolveChairProfile, type GroupTaskServiceContext } from './service';
import { readGroupTaskEngineLogTail } from './engineLog';

export type GroupTaskHealthReport = {
  chair:
    | { resolvable: true; slug: string; globalMetaId: string | null }
    | { resolvable: false; reason: string };
  ownerIdentity:
    | { present: true; globalMetaId: string; name: string }
    | { present: false };
  simplemsgListenerEnabled: boolean;
  tasks: { active: number; total: number };
  engine: { logFile: string | null; recentLines: string[] };
};

const RECENT_ENGINE_LOG_LINES = 15;

export async function getGroupTaskHealth(
  ctx: GroupTaskServiceContext,
  input: {
    /** Reader for the a2a listener switch; defaults to "unknown" = true. */
    readSimplemsgListenerEnabled?: () => Promise<boolean>;
    /** Absolute engine log path; null when the host has no log wiring. */
    engineLogFile?: string | null;
    /** Tail reader seam (tests); defaults to the rotating-log tail reader. */
    readEngineLogTail?: (logFile: string) => Promise<string>;
  } = {},
): Promise<GroupTaskHealthReport> {
  let chair: GroupTaskHealthReport['chair'];
  try {
    const resolved = await resolveChairProfile(ctx);
    chair = { resolvable: true, slug: resolved.slug, globalMetaId: resolved.globalMetaId };
  } catch (error) {
    chair = {
      resolvable: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const owner = await ctx.ownerIdentity().catch(() => null);
  const ownerIdentity = owner
    ? { present: true as const, globalMetaId: owner.globalMetaId, name: owner.name }
    : { present: false as const };

  const simplemsgListenerEnabled = await input.readSimplemsgListenerEnabled?.().catch(() => true) ?? true;

  let tasks = { active: 0, total: 0 };
  try {
    const summaries = await listGroupTaskSummaries(ctx, { tab: 'all', includeArchived: false });
    tasks = {
      total: summaries.length,
      active: summaries.filter((task) => task.status !== 'done' && task.status !== 'cancelled').length,
    };
  } catch {
    // Profile listing failures must not take down the rest of the report.
  }

  const logFile = input.engineLogFile ?? null;
  let recentLines: string[] = [];
  if (logFile) {
    const tail = await (input.readEngineLogTail ?? readGroupTaskEngineLogTail)(logFile);
    recentLines = tail.split('\n').filter((line) => line.trim() !== '').slice(-RECENT_ENGINE_LOG_LINES);
  }

  return { chair, ownerIdentity, simplemsgListenerEnabled, tasks, engine: { logFile, recentLines } };
}
