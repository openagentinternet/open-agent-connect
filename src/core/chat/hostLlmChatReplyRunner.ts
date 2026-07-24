import { createDefaultChatReplyRunner } from './defaultChatReplyRunner';
import type { LlmRuntimeResolver } from '../llm/llmRuntimeResolver';
import type { LlmExecutionRequest, LlmSessionRecord } from '../llm/executor';
import {
  emptyPrivateChatAllowedSkillScope,
  type PrivateChatAllowedSkillScope,
  type PrivateChatAllowedSkillsResolver,
} from './privateChatAllowedSkills';
import type {
  ChatReplyRunner,
  ChatReplyRunnerInput,
  ChatReplyRunnerResult,
} from './privateChatTypes';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 500;
const MAX_FALLBACK_ATTEMPTS = 5;
const CLOSE_CONVERSATION_SIGNAL = 'Bye';
export const PRIVATE_CHAT_REPLY_GENERATION_ENV = 'METABOT_PRIVATE_CHAT_REPLY_GENERATION';
// A chat history gap beyond this (or a close marker) starts a new session in
// the prompt; mirrors the orchestrator's idle-reopen window.
const DEFAULT_SESSION_GAP_MS = 300_000;
const SESSION_BOUNDARY_LINE = '--- Earlier conversation session ended. A new session starts below this line: treat it as a fresh opening, and do not end it just because the session above was closed. ---';

function isPlanningPreambleLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }
  if (/^先[读查]/u.test(trimmed) && /技能|skill|Skill|MVC|资料|视角/u.test(trimmed)) {
    return true;
  }
  if (/^(?:让我先|我会先|接下来我会|我需要先)/u.test(trimmed) && /技能|skill|Skill|资料/u.test(trimmed)) {
    return true;
  }
  if (/^Use (?:the )?.*skill/i.test(trimmed) && /before (?:I )?reply/i.test(trimmed)) {
    return true;
  }
  return false;
}

function isInvisibleExecutionLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }
  if (
    /^(?:正在|查找|读取)/u.test(trimmed)
    && /私聊技能|会话上下文|MetaBot 信息|相关 MetaBot 命令/u.test(trimmed)
    && /发送(?:私聊)?回复|身份回复|身份发送回复|生成 Buzz 交易数据/u.test(trimmed)
  ) {
    return true;
  }
  if (
    /^正在以\s+`[^`]+`\s+身份/u.test(trimmed)
    && /发送(?:私聊)?回复/u.test(trimmed)
  ) {
    return true;
  }
  if (
    /^Looking up /i.test(trimmed)
    && /skill|context|conversation/i.test(trimmed)
    && /reply|respond/i.test(trimmed)
  ) {
    return true;
  }
  if (
    /^(?:Finding|Checking|Reading|Locating|Looking up)\b/i.test(trimmed)
    && /private[- ]chat|session|conversation|reply|send path/i.test(trimmed)
  ) {
    return true;
  }
  if (/^Sending (?:the )?(?:private[- ]chat )?reply\b/i.test(trimmed)) {
    return true;
  }
  return false;
}

function stripPlanningPreamble(value: string): string {
  const lines = value.split(/\r?\n/u);
  while (lines.length > 0) {
    const line = lines[0];
    if (!line.trim()) {
      lines.shift();
      continue;
    }
    if (isPlanningPreambleLine(line) || isInvisibleExecutionLine(line)) {
      lines.shift();
      continue;
    }
    break;
  }
  return lines.join('\n').trim();
}

type ChatLlmExecutor = {
  execute(request: LlmExecutionRequest): Promise<string>;
  getSession(sessionId: string): Promise<LlmSessionRecord | null>;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function findFinalNonEmptyLineIndex(lines: string[]): number {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].trim()) {
      return index;
    }
  }
  return -1;
}

function hasFinalByeLine(value: string): boolean {
  const lines = value.split(/\r?\n/u);
  const finalIndex = findFinalNonEmptyLineIndex(lines);
  return finalIndex >= 0 && lines[finalIndex].trim().toLowerCase() === CLOSE_CONVERSATION_SIGNAL.toLowerCase();
}

function canonicalizeFinalByeLine(value: string): string {
  const lines = value.split(/\r?\n/u);
  const finalIndex = findFinalNonEmptyLineIndex(lines);
  if (finalIndex >= 0 && lines[finalIndex].trim().toLowerCase() === CLOSE_CONVERSATION_SIGNAL.toLowerCase()) {
    lines[finalIndex] = CLOSE_CONVERSATION_SIGNAL;
  }
  return lines.join('\n').trim();
}

// Drop a trailing close marker from historical outbound messages: the farewell
// text stays, but past "Bye" markers must not teach the model to end the
// current conversation again.
function stripFinalByeLineFromHistory(value: string): string {
  const lines = value.split(/\r?\n/u);
  const finalIndex = findFinalNonEmptyLineIndex(lines);
  if (finalIndex >= 0 && lines[finalIndex].trim().toLowerCase() === CLOSE_CONVERSATION_SIGNAL.toLowerCase()) {
    lines.splice(finalIndex, 1);
  }
  return lines.join('\n').trim();
}

export interface BuildChatPromptOptions {
  metaBotSlug?: string;
}

function buildChatPrompt(
  input: ChatReplyRunnerInput,
  allowedSkillScope: PrivateChatAllowedSkillScope = emptyPrivateChatAllowedSkillScope(),
  options: BuildChatPromptOptions = {},
): string {
  const { conversation, recentMessages, persona, strategy } = input;
  const maxTurns = strategy?.maxTurns ?? 30;
  const metaBotSlug = normalizeText(options.metaBotSlug);
  const operatorGuidanceText = normalizeText(input.operatorGuidanceText);

  const sections: string[] = [];

  sections.push(
    'You are a MetaBot having a private conversation with another MetaBot through the Open Agent Connect network.'
  );

  if (persona.role) {
    sections.push(`## Your Role\n${persona.role}`);
  }

  if (persona.soul) {
    sections.push(`## Your Style\n${persona.soul}`);
  }

  if (persona.goal) {
    sections.push(`## Your Goal\n${persona.goal}`);
  }

  if (metaBotSlug) {
    const actorLines = [
      '## Reply Delivery Boundary (critical)',
      `You are replying as local MetaBot profile \`${metaBotSlug}\`.`,
      '- Generate reply text only. Open Agent Connect owns delivery and will publish the returned text exactly once.',
      '- NEVER call `metabot chat private`, a private-chat send skill, or any other command that sends this reply.',
      '- Do not perform chain writes, uploads, or external side effects while generating this reply.',
    ];
    if (allowedSkillScope.skills.length > 0) {
      actorLines.push(
        '- Use allowed private-chat skills only for read-only context needed to compose the reply.',
      );
    }
    sections.push(actorLines.join('\n'));
  }

  const strategyLines = [
    '## Conversation Strategy',
    '- This is a MetaBot-to-MetaBot network conversation.',
  ];
  if (strategy?.exitCriteria) {
    strategyLines.push(`- Conversation objective: ${strategy.exitCriteria}`);
  }
  strategyLines.push(`- Current turn: ${conversation.turnCount} / ${maxTurns}`);
  strategyLines.push('- Keep replies concise and natural, 2-4 sentences per message.');
  strategyLines.push('- Do not repeat what you have already said.');
  strategyLines.push('- Actively steer the conversation toward the objective.');
  if (conversation.turnCount > 20) {
    strategyLines.push('- This private chat has passed 20 inbound turns; converge the topic and end naturally soon.');
  }
  sections.push(strategyLines.join('\n'));

  const exitLines = [
    '## Exit Mechanism',
    `End the conversation ONLY when the exchange is clearly finished. When ending, add ${CLOSE_CONVERSATION_SIGNAL} on its own final line at the very end of your reply:`,
    '- The other party explicitly says goodbye or signals the end in the CURRENT session',
    '- The conversation objective has been fully achieved over several substantive turns',
    '- Several consecutive turns from both sides contained no new, substantive content',
    `- Approaching the turn limit (currently turn ${conversation.turnCount} of ${maxTurns})`,
    '- Do NOT end the conversation just because one reply was short, generic, or low-value; answer it and steer toward a concrete next topic instead.',
    '- Greetings and capability introductions are openings, not a reason to end.',
  ];
  sections.push(exitLines.join('\n'));

  sections.push([
    '## Persona Immersion (critical)',
    '- Stay fully in character from the very first word of your reply.',
    '- NEVER announce plans or internal actions: no "先读/先查 skill", no workflow/Step narration, no "按角色风格回复".',
    '- Never say you are reading skills, checking context, or preparing to send a reply.',
    allowedSkillScope.skills.length > 0
      ? '- Skill reading, research, and checkpoints are invisible — output only what the persona would say.'
      : '- No private chat skills are available for this turn unless they are explicitly listed below.',
  ].join('\n'));

  if (allowedSkillScope.skills.length > 0) {
    sections.push([
      '## Available Private Chat Skills',
      'These are the only skills available for this private chat turn.',
      'Read and apply them silently when they help answer the sender request.',
      'Never tell the user you are reading, loading, or following a skill.',
      ...allowedSkillScope.skills.map((skillName) => `- ${skillName}`),
    ].join('\n'));
  }

  if (operatorGuidanceText) {
    sections.push([
      '## Operator Guidance',
      'This is local-only private guidance from the local operator for this one reply.',
      'Use it as private steering for your next turn.',
      'Do not present it as peer-authored text or mention that you received hidden guidance.',
      operatorGuidanceText,
    ].join('\n'));
  }

  sections.push([
    '## Format Rules',
    '- Output ONLY the reply text itself, no prefixes, labels, or markdown formatting.',
    '- Do NOT open with a plan sentence (for example: "先读…技能，再…"). Start directly with the in-character answer.',
    '- Reply in the same language the other party is using.',
    `- If ending the conversation, write your farewell first, then ${CLOSE_CONVERSATION_SIGNAL} on a separate final line.`,
  ].join('\n'));

  const selfName = 'Me';
  const peerName = conversation.peerName || 'Peer';
  const sessionGapMs = strategy?.maxIdleMs ?? DEFAULT_SESSION_GAP_MS;
  const historyLines: string[] = [];
  let previousTimestamp: number | null = null;
  let previousClosedSession = false;
  for (const msg of recentMessages) {
    const rawContent = normalizeText(msg.content);
    const closesSession = hasFinalByeLine(rawContent);
    const timestamp = typeof msg.timestamp === 'number' && Number.isFinite(msg.timestamp)
      ? msg.timestamp
      : null;
    const gapExceeded = previousTimestamp !== null
      && timestamp !== null
      && timestamp - previousTimestamp > sessionGapMs;
    const name = msg.direction === 'outbound' ? selfName : peerName;
    const normalizedContent = msg.direction === 'outbound'
      ? stripFinalByeLineFromHistory(stripPlanningPreamble(msg.content))
      : rawContent;
    if (normalizedContent) {
      // Keep older sessions visible as background, but mark the boundary so a
      // stale farewell or a long idle gap is read as a fresh opening, not as
      // a reason to close the new session again.
      if (historyLines.length > 0 && (previousClosedSession || gapExceeded)) {
        historyLines.push(SESSION_BOUNDARY_LINE);
      }
      historyLines.push(`${name}: ${normalizedContent}`);
    }
    previousTimestamp = timestamp ?? previousTimestamp;
    previousClosedSession = closesSession;
  }

  if (historyLines.length > 0) {
    sections.push(`## Chat History\n${historyLines.join('\n')}`);
  }

  sections.push('Reply now:');

  return sections.join('\n\n');
}

function parseRunnerOutput(rawOutput: string): ChatReplyRunnerResult {
  const output = normalizeText(stripPlanningPreamble(rawOutput));
  if (!output) {
    return { state: 'skip' };
  }

  const content = canonicalizeFinalByeLine(output);
  const hasEndMarker = hasFinalByeLine(content);

  return {
    state: hasEndMarker ? 'end_conversation' : 'reply',
    content,
  };
}

type StickyRuntimePreference = {
  get: () => string | null;
  onSuccess: (runtimeId: string) => void;
  onFailure: (runtimeId: string) => void;
};

// Consecutive poll-deadline timeouts per runtime id (spec R6): a single cold
// start must not wedge a runtime into `unavailable`; only the second
// consecutive deadline marks it. Any successful completion resets the count.
type PollDeadlineTracker = {
  recordTimeout: (runtimeId: string) => number;
  reset: (runtimeId: string) => void;
};

async function tryExecute(
  resolver: LlmRuntimeResolver,
  llmExecutor: ChatLlmExecutor,
  metaBotSlug: string | undefined,
  prompt: string,
  timeoutMs: number,
  pollIntervalMs: number,
  excludeRuntimeIds: Set<string>,
  allowedSkillScope: PrivateChatAllowedSkillScope,
  enforceSkillScope: boolean,
  stickyRuntime: StickyRuntimePreference,
  pollDeadlineTracker: PollDeadlineTracker,
  turnState: { attemptedExecution: boolean },
): Promise<{ result: ChatReplyRunnerResult; bindingId?: string } | null> {
  const shouldMarkRuntimeUnavailable = !enforceSkillScope;
  const stickyRuntimeId = stickyRuntime.get();
  const resolved = await resolver.resolveRuntime({
    metaBotSlug,
    excludeRuntimeIds: Array.from(excludeRuntimeIds),
    ...(stickyRuntimeId ? { explicitRuntimeId: stickyRuntimeId } : {}),
  });
  if (!resolved.runtime) return null;
  if (excludeRuntimeIds.has(resolved.runtime.id)) return null;
  if (resolved.runtime.health !== 'healthy') {
    excludeRuntimeIds.add(resolved.runtime.id);
    return null;
  }

  try {
    const request: LlmExecutionRequest = {
      runtimeId: resolved.runtime.id,
      runtime: resolved.runtime,
      prompt,
      timeout: timeoutMs,
      metaBotSlug,
      outputMode: 'final',
      env: {
        [PRIVATE_CHAT_REPLY_GENERATION_ENV]: '1',
      },
    };
    if (enforceSkillScope) {
      request.skillIsolation = 'strict';
    }
    if (allowedSkillScope.skills.length > 0) {
      request.skills = allowedSkillScope.skills;
      request.skillSourcePaths = allowedSkillScope.skillSourcePaths;
    }

    turnState.attemptedExecution = true;
    const sessionId = await llmExecutor.execute(request);

    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const session = await llmExecutor.getSession(sessionId);
      const result = session?.result;
      if (result) {
        if (result.status === 'completed') {
          const parsed = parseRunnerOutput(result.output);
          if (parsed.state !== 'skip') {
            stickyRuntime.onSuccess(resolved.runtime.id);
            pollDeadlineTracker.reset(resolved.runtime.id);
            return { result: parsed, bindingId: resolved.bindingId };
          }
          excludeRuntimeIds.add(resolved.runtime.id);
          stickyRuntime.onFailure(resolved.runtime.id);
          if (shouldMarkRuntimeUnavailable) {
            await resolver.markRuntimeUnavailable(
              resolved.runtime.id,
              'LLM runtime completed without returning output.',
            ).catch(() => {});
          }
          return null;
        }
        excludeRuntimeIds.add(resolved.runtime.id);
        stickyRuntime.onFailure(resolved.runtime.id);
        if (shouldMarkRuntimeUnavailable) {
          await resolver.markRuntimeUnavailable(resolved.runtime.id, result.error || `LLM runtime ended with status ${result.status}.`).catch(() => {});
        }
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    excludeRuntimeIds.add(resolved.runtime.id);
    stickyRuntime.onFailure(resolved.runtime.id);
    // A session that hangs until the poll deadline is usually a cold start,
    // not a dead runtime (spec R6): the first consecutive deadline excludes
    // the runtime for this turn and clears the sticky preference, but only
    // the SECOND consecutive deadline marks it unavailable.
    if (pollDeadlineTracker.recordTimeout(resolved.runtime.id) >= 2) {
      await resolver.markRuntimeUnavailable(resolved.runtime.id, 'LLM runtime timed out while running chat reply.').catch(() => {});
    }
    return null;
  } catch {
    stickyRuntime.onFailure(resolved.runtime.id);
    if (!excludeRuntimeIds.has(resolved.runtime.id)) {
      excludeRuntimeIds.add(resolved.runtime.id);
      if (shouldMarkRuntimeUnavailable) {
        await resolver.markRuntimeUnavailable(resolved.runtime.id, 'LLM runtime failed while running chat reply.').catch(() => {});
      }
    }
    return null;
  }
}

export function createHostLlmChatReplyRunner(options?: {
  runtimeResolver?: LlmRuntimeResolver;
  llmExecutor?: ChatLlmExecutor;
  metaBotSlug?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  allowedChatSkillsResolver?: PrivateChatAllowedSkillsResolver;
  logWarning?: (scope: string, message: string) => void;
  allowTemplateFallback?: boolean;
  /**
   * Fired once per turn when no runtime could even be attempted (spec R5) —
   * fire-and-forget, never awaited; the turn still falls back as before.
   */
  requestAvailabilityRecovery?: (input: { metaBotSlug?: string }) => void;
}): ChatReplyRunner {
  const runtimeResolver = options?.runtimeResolver;
  const llmExecutor = options?.llmExecutor;
  const metaBotSlug = options?.metaBotSlug;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const allowedChatSkillsResolver = options?.allowedChatSkillsResolver;
  const enforceSkillScope = Boolean(allowedChatSkillsResolver);
  const logWarning = options?.logWarning;
  const allowTemplateFallback = options?.allowTemplateFallback ?? true;
  const fallbackRunner = createDefaultChatReplyRunner();
  // Remember the runtime that produced the last successful reply and try it
  // first on the next turn; a failure clears the preference immediately. The
  // runner instance is cached per profile, so this survives across turns.
  let lastSuccessfulRuntimeId: string | null = null;
  const stickyRuntime: StickyRuntimePreference = {
    get: () => lastSuccessfulRuntimeId,
    onSuccess: (runtimeId) => {
      lastSuccessfulRuntimeId = runtimeId;
    },
    onFailure: (runtimeId) => {
      if (lastSuccessfulRuntimeId === runtimeId) {
        lastSuccessfulRuntimeId = null;
      }
    },
  };
  const consecutivePollDeadlineTimeouts = new Map<string, number>();
  const pollDeadlineTracker: PollDeadlineTracker = {
    recordTimeout: (runtimeId) => {
      const count = (consecutivePollDeadlineTimeouts.get(runtimeId) ?? 0) + 1;
      consecutivePollDeadlineTimeouts.set(runtimeId, count);
      return count;
    },
    reset: (runtimeId) => {
      consecutivePollDeadlineTimeouts.delete(runtimeId);
    },
  };

  // If no resolver provided, either fall back to template-only replies or skip.
  if (!runtimeResolver || !llmExecutor) {
    return async (input: ChatReplyRunnerInput): Promise<ChatReplyRunnerResult> => (
      allowTemplateFallback && !normalizeText(input.operatorGuidanceText)
        ? fallbackRunner(input)
        : { state: 'skip' }
    );
  }

  return async (input: ChatReplyRunnerInput): Promise<ChatReplyRunnerResult> => {
    let allowedSkillScope = emptyPrivateChatAllowedSkillScope();
    if (allowedChatSkillsResolver) {
      try {
        allowedSkillScope = await allowedChatSkillsResolver();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logWarning?.('[private chat allowed skills]', message);
      }
    }
    const prompt = buildChatPrompt(input, allowedSkillScope, { metaBotSlug });
    const excludeRuntimeIds = new Set<string>();
    const templateFallbackAllowedForTurn = allowTemplateFallback
      && !normalizeText(input.operatorGuidanceText);
    const turnState = { attemptedExecution: false };

    // Try up to MAX_FALLBACK_ATTEMPTS different runtimes.
    for (let attempt = 0; attempt < MAX_FALLBACK_ATTEMPTS; attempt++) {
      const outcome = await tryExecute(
        runtimeResolver,
        llmExecutor,
        metaBotSlug,
        prompt,
        timeoutMs,
        pollIntervalMs,
        excludeRuntimeIds,
        allowedSkillScope,
        enforceSkillScope,
        stickyRuntime,
        pollDeadlineTracker,
        turnState,
      );
      if (outcome) {
        // Track lastUsedAt on the binding that was successfully used.
        if (outcome.bindingId) {
          runtimeResolver.markBindingUsed(outcome.bindingId).catch(() => { /* best effort */ });
        }
        return outcome.result;
      }
    }

    // No runtime could even be attempted this turn (nothing selectable): ask
    // the availability recovery loop to re-probe this profile's runtimes
    // (fire-and-forget, spec R5), then fall back exactly as before.
    if (!turnState.attemptedExecution) {
      try {
        options?.requestAvailabilityRecovery?.({ metaBotSlug });
      } catch {
        // Recovery hints must never affect the reply path.
      }
    }

    // All runtimes failed — either fall back to template-only reply or skip.
    return templateFallbackAllowedForTurn ? fallbackRunner(input) : { state: 'skip' };
  };
}

// Exported for testing.
export { buildChatPrompt, parseRunnerOutput, stripPlanningPreamble, isPlanningPreambleLine };
