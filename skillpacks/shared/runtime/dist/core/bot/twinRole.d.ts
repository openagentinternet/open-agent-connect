import { type MetabotBotType } from './botRole';
export interface TwinInvariantResult {
    twinSlug: string | null;
    promoted: string | null;
    demoted: string[];
}
/**
 * Enforce the one-twin invariant. With `preferredTwinSlug`, that Bot becomes
 * the twin and every other Bot is demoted to worker. Without it, a missing
 * twin is repaired by promoting the earliest-created Bot. Best-effort callers
 * should invoke this after bot create/update/delete.
 */
export declare function applyTwinInvariant(systemHomeDir: string, options?: {
    preferredTwinSlug?: string;
}): Promise<TwinInvariantResult>;
/** The current twin's slug, or null when no Bot carries the twin role. */
export declare function resolveCurrentTwinSlug(systemHomeDir: string): Promise<string | null>;
/**
 * The machine default Bot's home directory. The Twin Bot IS the machine's
 * default Bot: every no-`--from` command and panel default resolves to it.
 * Falls back to the earliest-created Bot's home — the same pick
 * applyTwinInvariant's repair makes — so the default exists whenever any Bot
 * does, even if role storage is transiently twin-less. Null only when no Bots
 * exist. Callers that must verify the actual twin role (twin verbs, tool
 * re-authorization) use resolveCurrentTwinSlug instead.
 */
export declare function resolveTwinHomeDir(systemHomeDir: string): Promise<string | null>;
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
export declare function buildTwinWorkerRoster(systemHomeDir: string, twinSlug: string): Promise<TwinWorkerRosterEntry[]>;
/** Render the roster as the `## Local Worker Roster` prompt block. */
export declare function formatTwinWorkerRosterBlock(roster: TwinWorkerRosterEntry[]): string;
