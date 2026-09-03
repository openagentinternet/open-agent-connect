/** Local-timezone `YYYY-MM` shard name for one timestamp. */
export declare function monthShardForMs(ms: number): string;
/** Existing `YYYY-MM` directory names under one kind root, ascending. */
export declare function listMonthDirs(kindRoot: string): Promise<string[]>;
/** All `YYYY-MM` shards intersecting [fromMs, toMs), ascending. */
export declare function monthsInWindow(fromMs: number, toMs: number): string[];
/** The current plus previous `count - 1` local-month shards, ascending. */
export declare function recentMonthShards(count: number, nowMs?: number): string[];
