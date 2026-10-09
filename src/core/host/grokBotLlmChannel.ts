import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveMetabotPaths } from '../state/paths';
import {
  grokBotBindingPathForProfile,
  readGrokBotBinding,
  recordGrokBotWebhookDelivery,
} from './grokBotBinding';
import { postGrokBotWebhook } from './grokBotWebhook';

export const GROK_BOT_LLM_TASK_TIMEOUT_MS = 10 * 60_000;
export const GROK_BOT_LLM_TASK_POLL_INTERVAL_MS = 5_000;

export interface GrokBotLlmTaskResponse {
  taskId: string;
  status: 'ok' | 'failed';
  output?: string;
  error?: string;
}

/**
 * Passive-LLM channel for Grok Bot-bound profiles. Grok Bot exposes no local
 * LLM endpoint OAC can call, so a generation becomes a structured task: the
 * daemon POSTs an `llm-task` envelope to the assistant's routine webhook (the
 * same channel as private-chat delivery), and the assistant answers by
 * writing `<taskId>.response.json` next to the request file under
 * `.runtime/state/grok-bot-llm-tasks/`. One POST, bounded polling, no
 * retries; any failure returns null so the caller falls through its normal
 * chain unchanged.
 */
export function createGrokBotWebhookCompletion(options: {
  homeDir: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  pollIntervalMs?: number;
  createTaskId?: () => string;
  now?: () => Date;
  logWarning?: (scope: string, message: string) => void;
}): (request: { botSlug?: string; system: string; user: string; maxTokens?: number }) => Promise<string | null> {
  const logWarning = options.logWarning ?? (() => undefined);
  return async (request) => {
    const paths = resolveMetabotPaths(options.homeDir);
    const bindingPath = grokBotBindingPathForProfile(options.homeDir);
    let binding;
    try {
      binding = await readGrokBotBinding(bindingPath);
    } catch (error) {
      logWarning('[grok-bot llm task]', `binding unreadable: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
    if (!binding.webhook) {
      return null;
    }

    const now = options.now ?? (() => new Date());
    const taskId = (options.createTaskId ?? randomUUID)();
    const tasksRoot = paths.grokBotLlmTasksRoot;
    const requestPath = path.join(tasksRoot, `${taskId}.request.json`);
    const responsePath = path.join(tasksRoot, `${taskId}.response.json`);
    const slug = path.basename(paths.profileRoot);
    const createdAt = now().toISOString();

    const cleanup = async () => {
      await fs.rm(requestPath, { force: true }).catch(() => undefined);
      await fs.rm(responsePath, { force: true }).catch(() => undefined);
    };

    try {
      await fs.mkdir(tasksRoot, { recursive: true });
      await fs.writeFile(requestPath, `${JSON.stringify({
        taskId,
        type: 'llm-task',
        host: 'grok-bot',
        slug,
        system: request.system,
        prompt: request.user,
        createdAt,
      }, null, 2)}\n`, 'utf8');

      const posted = await postGrokBotWebhook({
        binding,
        payload: {
          type: 'llm-task',
          host: 'grok-bot',
          slug,
          taskId,
          system: request.system,
          prompt: request.user,
          responsePath,
          createdAt,
        },
        fetchImpl: options.fetchImpl ?? fetch,
        timeoutMs: 15_000,
      });
      await recordGrokBotWebhookDelivery(bindingPath, {
        at: now().toISOString(),
        status: posted.ok ? 'ok' : 'failed',
        kind: 'llm-task',
        error: posted.ok ? null : posted.error,
      });
      if (!posted.ok) {
        logWarning('[grok-bot llm task]', `webhook POST failed: ${posted.error}`);
        await cleanup();
        return null;
      }

      const timeoutMs = options.timeoutMs ?? GROK_BOT_LLM_TASK_TIMEOUT_MS;
      const pollIntervalMs = options.pollIntervalMs ?? GROK_BOT_LLM_TASK_POLL_INTERVAL_MS;
      const deadlineMs = Date.now() + timeoutMs;
      while (Date.now() < deadlineMs) {
        let raw: string | null = null;
        try {
          raw = await fs.readFile(responsePath, 'utf8');
        } catch {
          raw = null;
        }
        if (raw !== null) {
          let response: GrokBotLlmTaskResponse | null = null;
          try {
            const parsed = JSON.parse(raw) as GrokBotLlmTaskResponse;
            if (parsed && parsed.taskId === taskId && (parsed.status === 'ok' || parsed.status === 'failed')) {
              response = parsed;
            }
          } catch {
            response = null;
          }
          if (response) {
            await cleanup();
            if (response.status === 'ok' && typeof response.output === 'string' && response.output.trim()) {
              return response.output;
            }
            logWarning('[grok-bot llm task]', response.error ?? 'task failed without an error message');
            return null;
          }
          // A file with the right name but unparsable content is still being
          // written; keep polling until the deadline.
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
      logWarning('[grok-bot llm task]', `timed out after ${timeoutMs}ms waiting for ${responsePath}`);
      await cleanup();
      return null;
    } catch (error) {
      logWarning('[grok-bot llm task]', error instanceof Error ? error.message : String(error));
      await cleanup();
      return null;
    }
  };
}
