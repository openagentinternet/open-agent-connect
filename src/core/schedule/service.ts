// Scheduled-task orchestration: the claim → execute → settle loop shared by
// the daemon tick and `metabot schedule run`. The LLM transport is injected
// (`runLlmPromptWithRuntimeFallback` on both call sites), so DSH-style hosts
// can drive tasks across the process boundary with the same store semantics.
import path from 'node:path';

import { loadChatPersona } from '../chat/chatPersonaLoader';
import type { MetabotPaths } from '../state/paths';
import {
  createScheduleStore,
  type ScheduleRunExecutor,
  type ScheduleRunTrigger,
} from './store';

/** One LLM turn for a scheduled task. */
export interface ScheduleLlmTurn {
  prompt: string;
  systemPrompt: string;
}

export interface RunScheduledTaskDeps {
  runLlm: (turn: ScheduleLlmTurn) => Promise<{ ok: true; output: string } | { ok: false; error: string }>;
  now?: number;
}

export type RunScheduledTaskResult =
  | { kind: 'already_running' }
  | { kind: 'failed'; error: string }
  | { kind: 'completed'; output: string };

/**
 * Bot persona framing that wraps every scheduled task prompt (v1 has no
 * per-task systemPrompt; the persona + a short scheduled-task framing stand
 * in for it).
 */
export async function buildScheduleSystemPrompt(paths: MetabotPaths): Promise<string> {
  const persona = await loadChatPersona(paths);
  const slug = path.basename(paths.profileRoot);
  const botName = persona.identity?.name || slug;
  const parts = [
    `You are ${botName}, a MetaBot. This is a scheduled task that fired for you.`,
    'Do the work the prompt asks for, honestly and self-contained.',
    'You are acting asynchronously: there is no human watching live, so report your result plainly when the task asks for one.',
  ];
  if (persona.role) parts.push(`Your role:\n${persona.role}`);
  if (persona.soul) parts.push(`Your character:\n${persona.soul}`);
  return parts.join('\n\n');
}

/**
 * Claim one task, run the prompt through the injected LLM runner, and settle
 * the run honestly (executor throw/timeout → error; otherwise success).
 */
export async function runScheduledTask(
  paths: MetabotPaths,
  input: {
    taskId: string;
    trigger: ScheduleRunTrigger;
    executor: ScheduleRunExecutor | null;
  },
  deps: RunScheduledTaskDeps,
): Promise<RunScheduledTaskResult> {
  const store = createScheduleStore(paths);
  // Build the persona framing before claiming so a persona read failure never
  // leaves a claimed run unsettled.
  const systemPrompt = await buildScheduleSystemPrompt(paths);
  const claimed = await store.claim(input.taskId, {
    trigger: input.trigger,
    executor: input.executor,
  }, deps.now !== undefined ? { now: deps.now } : {});
  if (!claimed.ok) {
    if (claimed.code === 'already_running') return { kind: 'already_running' };
    return { kind: 'failed', error: `task claim failed: ${claimed.code}` };
  }
  const { run, task } = claimed;
  try {
    const outcome = await deps.runLlm({ prompt: task.prompt, systemPrompt });
    if (!outcome.ok) {
      await store.complete(run.id, { error: outcome.error });
      return { kind: 'failed', error: outcome.error };
    }
    await store.complete(run.id, {});
    return { kind: 'completed', output: outcome.output };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.complete(run.id, { error: message });
    return { kind: 'failed', error: message };
  }
}