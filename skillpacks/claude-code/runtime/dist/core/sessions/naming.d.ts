/**
 * Session naming (local session adapters P1).
 *
 * Directory names default to `<dir>-<agent>` (`api-claude`), get `-2`/`-3`
 * on collision, and stay with their conversation: a re-registered session
 * key keeps the name it already had (reason-network's name-keeping rule),
 * and a NEW session never pushes a kept name aside — it takes the next free
 * suffix. A name someone asked for (`--name`, later `claim`/`listen --as`)
 * is honored when free and suffixed when not.
 */
export declare function slugifySessionName(raw: string): string;
export declare function shortAgentName(agent: string): string;
/** `<basename(cwd)>-<agent>`, slugified; `session-<agent>` without a usable cwd. */
export declare function defaultSessionName(input: {
    cwd?: string;
    agent: string;
}): string;
/**
 * First free name: the requested/default name when untaken, else `-2`,
 * `-3`, … `takenNames` should already exclude the session being named.
 */
export declare function resolveSessionName(input: {
    requested?: string;
    defaultName: string;
    takenNames: Iterable<string>;
}): string;
