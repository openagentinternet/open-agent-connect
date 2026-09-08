import { type MetabotCommandResult } from '../contracts/commandResult';
export declare const METAAPP_WRITE_IDEMPOTENCY_WINDOW_MS = 60000;
type MetaAppWriteCommandResult = MetabotCommandResult<Record<string, unknown>>;
export declare function stableMetaAppWriteHash(kind: string, parts: Array<string | undefined | null>): string;
export interface MetaAppWriteGuard {
    run(input: {
        idemKey: string;
        lockKey?: string;
        fn: () => Promise<MetaAppWriteCommandResult>;
    }): Promise<MetaAppWriteCommandResult>;
}
export declare function createMetaAppWriteGuard(input?: {
    now?: () => number;
    windowMs?: number;
}): MetaAppWriteGuard;
export {};
