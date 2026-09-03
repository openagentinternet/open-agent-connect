import type { MetabotPaths } from '../state/paths';
/** Map each known subject GlobalMetaID to a display name; unknown ids are absent. */
export declare function resolveContactNames(paths: MetabotPaths, subjectGlobalMetaIds: string[]): Promise<Map<string, string>>;
