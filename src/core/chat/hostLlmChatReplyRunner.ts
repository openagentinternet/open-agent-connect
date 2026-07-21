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
      '## Chain Write Actor (critical)',
      `You are replying as local MetaBot profile \`${metaBotSlug}\`.`,
      `- Any on-chain write MUST pass \`--from ${metaBotSlug}\` on every metabot CLI command.`,
      '- This includes `buzz post`, `file upload`, `chain write`, and `chat private`.',
      '- Never omit `--from` in this private chat turn; omission uses the host active identity and publishes under the wrong MetaBot.',
    ];
    if (allowedSkillScope.skills.length > 0) {
      actorLines.push(
        '- When a private chat skill performs uploads or config reads, keep the same `--from` slug on every related command.',
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
    `When ANY of the following conditions are met, add ${CLOSE_CONVERSATION_SIGNAL} on its own final line at the very end of your reply:`,
    '- The conversation objective has been achieved',
    '- The other party says goodbye or signals the end',
    '- There are no more valuable topics to discuss',
    `- Approaching the turn limit (currently turn ${conversation.turnCount} of ${maxTurns})`,
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
  const historyLines = recentMessages.flatMap((msg) => {
    const name = msg.direction === 'outbound' ? selfName : peerName;
    const normalizedContent = msg.direction === 'outbound'
      ? stripPlanningPreamble(msg.content)
      : normalizeText(msg.content);
    if (!normalizedContent) {
      return [];
    }
    return `${name}: ${normalizedContent}`;
  });

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
    };
    if (enforceSkillScope) {
      request.skillIsolation = 'strict';
    }
    if (allowedSkillScope.skills.length > 0) {
      request.skills = allowedSkillScope.skills;
      request.skillSourcePaths = allowedSkillScope.skillSourcePaths;
    }

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
    // A session that hangs until the poll deadline is a runtime-side signal
    // regardless of skill isolation, so always cool the runtime down here.
    await resolver.markRuntimeUnavailable(resolved.runtime.id, 'LLM runtime timed out while running chat reply.').catch(() => {});
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
      );
      if (outcome) {
        // Track lastUsedAt on the binding that was successfully used.
        if (outcome.bindingId) {
          runtimeResolver.markBindingUsed(outcome.bindingId).catch(() => { /* best effort */ });
        }
        return outcome.result;
      }
    }

    // All runtimes failed — either fall back to template-only reply or skip.
    return templateFallbackAllowedForTurn ? fallbackRunner(input) : { state: 'skip' };
  };
}

// Exported for testing.
export { buildChatPrompt, parseRunnerOutput, stripPlanningPreamble, isPlanningPreambleLine };
