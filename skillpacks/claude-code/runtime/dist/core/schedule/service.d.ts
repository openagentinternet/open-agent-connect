import type { MetabotPaths } from '../state/paths';
import { type ScheduleRunExecutor, type ScheduleRunTrigger } from './store';
/** One LLM turn for a scheduled task. */
export interface ScheduleLlmTurn {
    prompt: string;
    systemPrompt: string;
}
export interface RunScheduledTaskDeps {
    runLlm: (turn: ScheduleLlmTurn) => Promise<{
        ok: true;
        output: string;
    } | {
        ok: false;
        error: string;
    }>;
    now?: number;
}
export type RunScheduledTaskResult = {
    kind: 'already_running';
} | {
    kind: 'failed';
    error: string;
} | {
    kind: 'completed';
    output: string;
};
/**
 * Bot persona framing that wraps every scheduled task prompt (v1 has no
 * per-task systemPrompt; the persona + a short scheduled-task framing stand
 * in for it).
 */
export declare function buildScheduleSystemPrompt(paths: MetabotPaths): Promise<string>;
/**
 * Claim one task, run the prompt through the injected LLM runner, and settle
 * the run honestly (executor throw/timeout → error; otherwise success).
 */
export declare function runScheduledTask(paths: MetabotPaths, input: {
    taskId: string;
    trigger: ScheduleRunTrigger;
    executor: ScheduleRunExecutor | null;
}, deps: RunScheduledTaskDeps): Promise<RunScheduledTaskResult>;
