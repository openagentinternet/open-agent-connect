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
import { type MetabotCommandResult } from '../core/contracts/commandResult';
import type { Signer } from '../core/signing/signer';
export interface MetaTaskDaemonHandlers {
    board: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    task: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    replay: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    refresh: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    claim: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    submit: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    verify: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    release: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    publish: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    publishSpec: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    amend: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    /** Internal: the watch heartbeat (not routed over HTTP today). */
    watch: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    /** F13: prefilled participation draft for a bot session (never a write). */
    draft: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
}
/**
 * Build the MetaTask handler group: one system-level store, one refresher
 * (ordinary HTTP callers coalesce to one sweep per 60s), and the local-roster
 * resolver that feeds board myRoles/myStats and display identities.
 */
export declare function createMetaTaskDaemonHandlers(input: {
    systemHomeDir: string;
    /** Minimum sweep spacing for ordinary HTTP callers (tests drop it to 0). */
    minIntervalMs?: number;
    /** Writes need a per-profile signer factory (the daemon owns all chain writes). */
    createSignerForProfileHome?: (homeDir: string) => Signer | Promise<Signer>;
    log?: (message: string) => void;
}): MetaTaskDaemonHandlers;
