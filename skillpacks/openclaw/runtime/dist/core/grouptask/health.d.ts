/**
 * Group task health report — the read-only preflight the DSH banner and the
 * `metabot grouptask health` verb surface. The live-diagnosis round showed
 * the real failures are silent prerequisites: invites arriving while no
 * engine is alive expire without a trace, owner identity or twin absence
 * blocks creation, and a disabled simplemsg listener silently kills OpenTeam
 * intake. This module turns those into one inspectable snapshot; the engine
 * log tail carries whatever actually failed lately.
 */
import { type GroupTaskServiceContext } from './service';
export type GroupTaskHealthReport = {
    chair: {
        resolvable: true;
        slug: string;
        globalMetaId: string | null;
    } | {
        resolvable: false;
        reason: string;
    };
    ownerIdentity: {
        present: true;
        globalMetaId: string;
        name: string;
    } | {
        present: false;
    };
    simplemsgListenerEnabled: boolean;
    tasks: {
        active: number;
        total: number;
    };
    engine: {
        logFile: string | null;
        recentLines: string[];
    };
};
export declare function getGroupTaskHealth(ctx: GroupTaskServiceContext, input?: {
    /** Reader for the a2a listener switch; defaults to "unknown" = true. */
    readSimplemsgListenerEnabled?: () => Promise<boolean>;
    /** Absolute engine log path; null when the host has no log wiring. */
    engineLogFile?: string | null;
    /** Tail reader seam (tests); defaults to the rotating-log tail reader. */
    readEngineLogTail?: (logFile: string) => Promise<string>;
}): Promise<GroupTaskHealthReport>;
