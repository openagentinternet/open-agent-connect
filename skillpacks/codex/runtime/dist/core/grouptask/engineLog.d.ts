export declare const GROUP_TASK_ENGINE_LOG_FILE_NAME = "grouptask-engine.log";
export declare const DEFAULT_GROUP_TASK_ENGINE_LOG_MAX_BYTES: number;
export type GroupTaskEngineLogWriter = ((message: string) => void) & {
    /** Resolves once every line queued so far has been written (or dropped). */
    flush(): Promise<void>;
};
export declare function resolveGroupTaskEngineLogPath(logsRoot: string): string;
export declare function createGroupTaskEngineLogWriter(options: {
    logFile: string;
    maxBytes?: number;
}): GroupTaskEngineLogWriter;
/**
 * Read the trailing bytes of the engine log (plus its rolled generation when
 * the live file is shorter than requested). Best-effort: returns '' when the
 * log does not exist or cannot be read.
 */
export declare function readGroupTaskEngineLogTail(logFile: string, tailBytes?: number): Promise<string>;
