// Twin/Worker role machinery, ported from IDBots metabotStore.ts
// (demoteOtherTwins / ensureTwinExists) and twinWorkerDirectoryService.ts
// (sanitized roster). At most one Bot on a machine may carry botType 'twin':
// promoting one demotes the previous twin, and deleting/losing the twin
// repairs the invariant by promoting the earliest-created remaining Bot.
import {
  listMetabotProfiles,
  type MetabotProfileFull,
} from './metabotProfileManager';
import {
  readBotRoleInfo,
  writeBotRoleInfo,
  type MetabotBotType,
} from './botRole';
import { resolveMetabotPaths } from '../state/paths';
import { createDreamStore } from '../memory/dreamStore';
import { createOrchestrationStore } from '../memory/orchestrationStore';

export interface TwinInvariantResult {
  twinSlug: string | null;
  promoted: string | null;
  demoted: string[];
}

function truncateRosterField(value: string | undefined | null, maxChars = 2000): string | null {
  const normalized = (value ?? '').trim();
  if (!normalized) return null;
  return normalized.length > maxChars ? `${normalized.slice(0, maxChars - 1)}…` : normalized;
}

async function readBotType(profile: MetabotProfileFull): Promise<MetabotBotType | null> {
  const info = await readBotRoleInfo(resolveMetabotPaths(profile.homeDir).botRoleStatePath);
  return info.botType ?? null;
}

/**
 * Enforce the one-twin invariant. With `preferredTwinSlug`, that Bot becomes
 * the twin and every other Bot is demoted to worker. Without it, a missing
 * twin is repaired by promoting the earliest-created Bot. Best-effort callers
 * should invoke this after bot create/update/delete.
 */
export async function applyTwinInvariant(
  systemHomeDir: string,
  options: { preferredTwinSlug?: string } = {},
): Promise<TwinInvariantResult> {
  const profiles = await listMetabotProfiles(systemHomeDir);
  if (profiles.length === 0) {
    return { twinSlug: null, promoted: null, demoted: [] };
  }
  const preferred = options.preferredTwinSlug?.trim() || '';
  const result: TwinInvariantResult = { twinSlug: null, promoted: null, demoted: [] };

  if (preferred) {
    for (const profile of profiles) {
      const paths = resolveMetabotPaths(profile.homeDir);
      const current = await readBotRoleInfo(paths.botRoleStatePath);
      if (profile.slug === preferred) {
        if (current.botType !== 'twin') {
          await writeBotRoleInfo(paths.botRoleStatePath, { ...current, botType: 'twin' });
          result.promoted = profile.slug;
        }
        result.twinSlug = profile.slug;
      } else if (current.botType === 'twin') {
        await writeBotRoleInfo(paths.botRoleStatePath, { ...current, botType: 'worker' });
        result.demoted.push(profile.slug);
      }
    }
    return result;
  }

  let currentTwin: MetabotProfileFull | null = null;
  for (const profile of profiles) {
    const botType = await readBotType(profile);
    if (botType === 'twin') {
      if (!currentTwin) {
        currentTwin = profile;
      } else {
        // Duplicate twins can only arise from out-of-band edits; keep the
        // earliest-created and demote the rest.
        const paths = resolveMetabotPaths(profile.homeDir);
        const current = await readBotRoleInfo(paths.botRoleStatePath);
        await writeBotRoleInfo(paths.botRoleStatePath, { ...current, botType: 'worker' });
        result.demoted.push(profile.slug);
      }
    }
  }
  if (currentTwin) {
    result.twinSlug = currentTwin.slug;
    return result;
  }

  const earliest = [...profiles].sort((left, right) => left.createdAt - right.createdAt)[0];
  const paths = resolveMetabotPaths(earliest.homeDir);
  const current = await readBotRoleInfo(paths.botRoleStatePath);
  await writeBotRoleInfo(paths.botRoleStatePath, { ...current, botType: 'twin' });
  result.twinSlug = earliest.slug;
  result.promoted = earliest.slug;
  return result;
}

/** The current twin's slug, or null when no Bot carries the twin role. */
export async function resolveCurrentTwinSlug(systemHomeDir: string): Promise<string | null> {
  const profiles = await listMetabotProfiles(systemHomeDir);
  for (const profile of profiles) {
    if ((await readBotType(profile)) === 'twin') return profile.slug;
  }
  return null;
}

/**
 * The machine default Bot's home directory. The Twin Bot IS the machine's
 * default Bot: every no-`--from` command and panel default resolves to it.
 * Falls back to the earliest-created Bot's home — the same pick
 * applyTwinInvariant's repair makes — so the default exists whenever any Bot
 * does, even if role storage is transiently twin-less. Null only when no Bots
 * exist. Callers that must verify the actual twin role (twin verbs, tool
 * re-authorization) use resolveCurrentTwinSlug instead.
 */
export async function resolveTwinHomeDir(systemHomeDir: string): Promise<string | null> {
  const profiles = await listMetabotProfiles(systemHomeDir);
  let earliest: MetabotProfileFull | null = null;
  for (const profile of profiles) {
    if (!earliest || profile.createdAt < earliest.createdAt) earliest = profile;
    if ((await readBotType(profile)) === 'twin') return profile.homeDir;
  }
  return earliest?.homeDir ?? null;
}

export interface TwinWorkerRosterEntry {
  slug: string;
  name: string;
  globalMetaId: string | null;
  botType: MetabotBotType | null;
  ownerGlobalMetaId: string | null;
  role: string | null;
  bio: string | null;
  goal: string | null;
  skills: string[];
  dshLlmModel: string | null;
  /** Dates of the three most recent dream diaries (capability evidence). */
  recentDiaryDates: string[];
  /** One-line snippet of the latest diary (capability evidence). */
  latestDiarySnippet: string | null;
  /** Currently running/queued delegated steps. */
  activeSteps: number;
}

/** Sanitized roster of local Worker Bots for the twin's local_workers_list tool. */
export async function buildTwinWorkerRoster(
  systemHomeDir: string,
  twinSlug: string,
): Promise<TwinWorkerRosterEntry[]> {
  const profiles = await listMetabotProfiles(systemHomeDir);
  const roster: TwinWorkerRosterEntry[] = [];
  for (const profile of profiles) {
    if (profile.slug === twinSlug) continue;
    const paths = resolveMetabotPaths(profile.homeDir);
    const dreamStore = createDreamStore(paths);
    const orchestration = createOrchestrationStore(paths);
    const [summaries, activeSteps] = await Promise.all([
      dreamStore.listDailySummaries({ limit: 3 }).catch(() => []),
      orchestration.activeStepCountForWorker(profile.slug).catch(() => 0),
    ]);
    roster.push({
      slug: profile.slug,
      name: profile.name,
      globalMetaId: profile.globalMetaId || null,
      botType: profile.botType ?? null,
      ownerGlobalMetaId: profile.ownerGlobalMetaId ?? null,
      role: truncateRosterField(profile.role),
      bio: truncateRosterField(profile.bio),
      goal: truncateRosterField(profile.goal),
      skills: profile.allowChatSkills.slice(0, 12),
      dshLlmModel: profile.dshLlmModel ?? null,
      recentDiaryDates: summaries.map((summary) => summary.summaryDate),
      latestDiarySnippet: truncateRosterField(summaries[0]?.summaryText ?? null, 300),
      activeSteps,
    });
  }
  return roster.sort((left, right) => left.name.localeCompare(right.name));
}

/** Render the roster as the `## Local Worker Roster` prompt block. */
export function formatTwinWorkerRosterBlock(roster: TwinWorkerRosterEntry[]): string {
  if (roster.length === 0) {
    return '## Local Worker Roster\n(no local Worker Bots yet)';
  }
  const lines = roster.map((entry) => {
    const parts = [
      `- ${entry.name} (slug=${entry.slug})`,
      entry.globalMetaId ? `MetaID: ${entry.globalMetaId}` : null,
      entry.role ? `Role: ${entry.role}` : null,
      entry.bio ? `Bio: ${entry.bio}` : null,
      entry.goal ? `Goal: ${entry.goal}` : null,
      entry.skills.length > 0 ? `Skills: ${entry.skills.join(', ')}` : null,
      entry.recentDiaryDates.length > 0 ? `Recent activity: ${entry.recentDiaryDates.join(', ')}` : null,
      entry.activeSteps > 0 ? `Active delegated steps: ${entry.activeSteps}` : 'Available',
    ].filter(Boolean);
    return parts.join('; ');
  });
  return ['## Local Worker Roster', ...lines].join('\n');
}
