/**
 * Daemon-side MetaWeb surf handler group (OAC port of the IDBots
 * SurfService host wiring): per-bot SurfService instances (slug-keyed mutex,
 * run store as the crash-recovery anchor) plus the `metabot surf *` HTTP
 * surface — status/run/enable/disable/budget.
 *
 * The unattended LLM session executor is injected (`runSurfSession`) by the
 * daemon runtime, which owns the passive-LLM chain (DSH pair via the
 * host-executor lease first, then local CLI runtimes) and the full surf tool
 * wiring (see runtime.ts). Everything file/store/identity-shaped resolves
 * here in-process.
 */
import { commandFailed } from '../core/contracts/commandResult';
import { type SurfSessionContext, type SurfSessionResult } from '../core/surf/service';
export interface SurfBotRef {
    slug: string;
    name: string;
    homeDir: string;
}
export interface CreateSurfDaemonHandlersInput {
    /** Resolve the acting bot (explicit slug, else the machine Twin). */
    resolveBot: (from?: string) => Promise<SurfBotRef | {
        failure: ReturnType<typeof commandFailed>;
    }>;
    /**
     * The unattended surf session executor (LLM tool loop; see runtime.ts).
     * Absent → digest-only runs (report + watermarks still advance).
     */
    runSurfSession?: (context: SurfSessionContext) => Promise<SurfSessionResult>;
    /** so.metaid.io override (METABOT_METAWEB_API_BASE_URL propagation). */
    metawebBaseUrl?: string;
    /** Structured log sink (engine log). */
    log?: (message: string) => void;
}
export declare function createSurfDaemonHandlers(input: CreateSurfDaemonHandlersInput): {
    /** Crash recovery at daemon boot: orphaned `running` rows become failed. */
    recoverAfterRestart: () => Promise<number>;
    status: (rawInput: {
        from?: string;
        limit?: number;
    }) => Promise<({
        state: import("../core/contracts/commandResult").MetabotCommandState;
        code?: string;
        message?: string;
    } & {
        ok: false;
        state: "waiting";
        pollAfterMs: number;
        localUiUrl?: string;
        data?: Record<string, unknown>;
    }) | ({
        state: import("../core/contracts/commandResult").MetabotCommandState;
        code?: string;
        message?: string;
    } & {
        ok: false;
        state: "manual_action_required";
        localUiUrl?: string;
        data?: Record<string, unknown>;
    }) | ({
        state: import("../core/contracts/commandResult").MetabotCommandState;
        code?: string;
        message?: string;
    } & {
        ok: false;
        state: "failed";
        data?: Record<string, unknown>;
    }) | ({
        state: import("../core/contracts/commandResult").MetabotCommandState;
        code?: string;
        message?: string;
    } & {
        ok: true;
        state: "success";
        data: {
            botSlug: string;
            runs: import("../core/surf/store").MetawebSurfRunRecord[];
            running: boolean;
            surfBeforeDreamEnabled: boolean;
            interactionBudget: number;
            preDreamDue: boolean;
            formatted: string;
        };
    }) | ({
        state: import("../core/contracts/commandResult").MetabotCommandState;
        code?: string;
        message?: string;
    } & {
        ok: true;
        state: "awaiting_confirmation";
        data: {
            botSlug: string;
            runs: import("../core/surf/store").MetawebSurfRunRecord[];
            running: boolean;
            surfBeforeDreamEnabled: boolean;
            interactionBudget: number;
            preDreamDue: boolean;
            formatted: string;
        };
    })>;
    run: (rawInput: {
        from?: string;
        trigger?: "manual-chat" | "manual-ui" | "pre-dream";
        wait?: boolean;
    }) => Promise<({
        state: import("../core/contracts/commandResult").MetabotCommandState;
        code?: string;
        message?: string;
    } & {
        ok: false;
        state: "waiting";
        pollAfterMs: number;
        localUiUrl?: string;
        data?: Record<string, unknown>;
    }) | ({
        state: import("../core/contracts/commandResult").MetabotCommandState;
        code?: string;
        message?: string;
    } & {
        ok: false;
        state: "manual_action_required";
        localUiUrl?: string;
        data?: Record<string, unknown>;
    }) | ({
        state: import("../core/contracts/commandResult").MetabotCommandState;
        code?: string;
        message?: string;
    } & {
        ok: false;
        state: "failed";
        data?: Record<string, unknown>;
    }) | ({
        state: import("../core/contracts/commandResult").MetabotCommandState;
        code?: string;
        message?: string;
    } & {
        ok: true;
        state: "success";
        data: {
            runId: string;
            trigger: string;
            status: string;
        };
    }) | ({
        state: import("../core/contracts/commandResult").MetabotCommandState;
        code?: string;
        message?: string;
    } & {
        ok: true;
        state: "awaiting_confirmation";
        data: {
            runId: string;
            trigger: string;
            status: string;
        };
    })>;
    enable: (rawInput: {
        from?: string;
    }) => Promise<({
        state: import("../core/contracts/commandResult").MetabotCommandState;
        code?: string;
        message?: string;
    } & {
        ok: false;
        state: "waiting";
        pollAfterMs: number;
        localUiUrl?: string;
        data?: Record<string, unknown>;
    }) | ({
        state: import("../core/contracts/commandResult").MetabotCommandState;
        code?: string;
        message?: string;
    } & {
        ok: false;
        state: "manual_action_required";
        localUiUrl?: string;
        data?: Record<string, unknown>;
    }) | ({
        state: import("../core/contracts/commandResult").MetabotCommandState;
        code?: string;
        message?: string;
    } & {
        ok: false;
        state: "failed";
        data?: Record<string, unknown>;
    }) | ({
        state: import("../core/contracts/commandResult").MetabotCommandState;
        code?: string;
        message?: string;
    } & {
        ok: true;
        state: "success";
        data: {
            surfBeforeDreamEnabled: boolean;
            interactionBudget: number;
            qaSurfRetired: boolean;
        };
    }) | ({
        state: import("../core/contracts/commandResult").MetabotCommandState;
        code?: string;
        message?: string;
    } & {
        ok: true;
        state: "awaiting_confirmation";
        data: {
            surfBeforeDreamEnabled: boolean;
            interactionBudget: number;
            qaSurfRetired: boolean;
        };
    })>;
    disable: (rawInput: {
        from?: string;
    }) => Promise<({
        state: import("../core/contracts/commandResult").MetabotCommandState;
        code?: string;
        message?: string;
    } & {
        ok: false;
        state: "waiting";
        pollAfterMs: number;
        localUiUrl?: string;
        data?: Record<string, unknown>;
    }) | ({
        state: import("../core/contracts/commandResult").MetabotCommandState;
        code?: string;
        message?: string;
    } & {
        ok: false;
        state: "manual_action_required";
        localUiUrl?: string;
        data?: Record<string, unknown>;
    }) | ({
        state: import("../core/contracts/commandResult").MetabotCommandState;
        code?: string;
        message?: string;
    } & {
        ok: false;
        state: "failed";
        data?: Record<string, unknown>;
    }) | ({
        state: import("../core/contracts/commandResult").MetabotCommandState;
        code?: string;
        message?: string;
    } & {
        ok: true;
        state: "success";
        data: {
            surfBeforeDreamEnabled: boolean;
        };
    }) | ({
        state: import("../core/contracts/commandResult").MetabotCommandState;
        code?: string;
        message?: string;
    } & {
        ok: true;
        state: "awaiting_confirmation";
        data: {
            surfBeforeDreamEnabled: boolean;
        };
    })>;
    budget: (rawInput: {
        from?: string;
        budget?: number;
    }) => Promise<({
        state: import("../core/contracts/commandResult").MetabotCommandState;
        code?: string;
        message?: string;
    } & {
        ok: false;
        state: "waiting";
        pollAfterMs: number;
        localUiUrl?: string;
        data?: Record<string, unknown>;
    }) | ({
        state: import("../core/contracts/commandResult").MetabotCommandState;
        code?: string;
        message?: string;
    } & {
        ok: false;
        state: "manual_action_required";
        localUiUrl?: string;
        data?: Record<string, unknown>;
    }) | ({
        state: import("../core/contracts/commandResult").MetabotCommandState;
        code?: string;
        message?: string;
    } & {
        ok: false;
        state: "failed";
        data?: Record<string, unknown>;
    }) | ({
        state: import("../core/contracts/commandResult").MetabotCommandState;
        code?: string;
        message?: string;
    } & {
        ok: true;
        state: "success";
        data: {
            interactionBudget: number;
        };
    }) | ({
        state: import("../core/contracts/commandResult").MetabotCommandState;
        code?: string;
        message?: string;
    } & {
        ok: true;
        state: "awaiting_confirmation";
        data: {
            interactionBudget: number;
        };
    })>;
};
export type SurfDaemonHandlers = ReturnType<typeof createSurfDaemonHandlers>;
