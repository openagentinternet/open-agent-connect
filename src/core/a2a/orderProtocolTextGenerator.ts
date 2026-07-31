import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ChatPersona } from '../chat/privateChatTypes';
import type { LlmExecutionRequest, LlmSessionRecord } from '../llm/executor';
import { createLlmBindingStore } from '../llm/llmBindingStore';
import { createLlmRuntimeResolver } from '../llm/llmRuntimeResolver';
import { createLlmRuntimeStore } from '../llm/llmRuntimeStore';
import { runLlmPromptWithRuntimeFallback } from '../llm/llmRuntimeExecution';
import { createOrderMetadataLineRegex } from '../orders/orderMessage';
import type { PublishedServiceRecord } from '../services/publishService';
import type { MetabotPaths } from '../state/paths';

export type ProviderOrderProtocolTextStage = 'acknowledgement' | 'rating_request' | 'long_task_notice';

export interface CallerOrderProtocolTextGeneratorInput {
  paths: MetabotPaths;
  persona: ChatPersona;
  callerName?: string | null;
  callerGlobalMetaId?: string | null;
  providerName?: string | null;
  providerGlobalMetaId?: string | null;
  serviceName?: string | null;
  providerSkill?: string | null;
  servicePinId?: string | null;
  rawRequest?: string | null;
  userTask?: string | null;
  taskContext?: string | null;
  paymentAmount?: string | null;
  paymentCurrency?: string | null;
  paymentTxid?: string | null;
  orderReference?: string | null;
  outputType?: string | null;
}

export interface ProviderOrderProtocolTextGeneratorInput {
  paths: MetabotPaths;
  persona: ChatPersona;
  providerName?: string | null;
  providerGlobalMetaId?: string | null;
  buyerGlobalMetaId?: string | null;
  service: PublishedServiceRecord;
  stage: ProviderOrderProtocolTextStage;
  orderTxid: string;
  paymentTxid?: string | null;
  orderReference?: string | null;
  paymentAmount?: string | null;
  paymentCurrency?: string | null;
  userTask?: string | null;
  taskContext?: string | null;
  responseText?: string | null;
}

export interface BuyerRatingProtocolTextGeneratorInput {
  paths: MetabotPaths;
  persona: ChatPersona;
  traceId: string;
  providerGlobalMetaId: string;
  providerName?: string | null;
  originalRequest?: string | null;
  serviceResult?: string | null;
  expectedOutputType?: string | null;
  ratingRequestText?: string | null;
}

export type CallerOrderProtocolTextGenerator = (
  input: CallerOrderProtocolTextGeneratorInput
) => Promise<string | null | undefined>;

export type ProviderOrderProtocolTextGenerator = (
  input: ProviderOrderProtocolTextGeneratorInput
) => Promise<string | null | undefined>;

export type BuyerRatingProtocolTextGenerator = (
  input: BuyerRatingProtocolTextGeneratorInput
) => Promise<string | null | undefined>;

type LlmExecutorLike = {
  execute(request: LlmExecutionRequest): Promise<string>;
  getSession(sessionId: string): Promise<LlmSessionRecord | null>;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function compactInlineText(value: unknown, maxChars: number): string {
  const text = normalizeText(value).replace(/\s+/gu, ' ');
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function truncateForPrompt(value: unknown, maxChars: number): string {
  const text = normalizeText(value);
  if (text.length <= maxChars) {
    return text;
  }
  const headLength = Math.max(0, maxChars - 80);
  return `${text.slice(0, headLength).trimEnd()}\n\n[Prompt excerpt: remaining content omitted.]`;
}

function summarizeResultForPrompt(value: unknown): string {
  const lines = normalizeText(value)
    .replace(/https?:\/\/\S+/giu, '[link omitted]')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !/^\|.*\|$/u.test(line));
  return truncateForPrompt(lines.join('\n'), 700);
}

function stripGeneratedProtocolText(value: unknown): string {
  let text = normalizeText(value)
    .replace(/^```[a-z0-9_-]*\s*/iu, '')
    .replace(/```\s*$/u, '')
    .trim();
  for (let index = 0; index < 3; index += 1) {
    const stripped = text
      .replace(/^\[(?:ORDER|ORDER_STATUS|NeedsRating|NEEDS_RATING|DELIVERY|ORDER_END)[^\]]*\]\s*/iu, '')
      .replace(/^(?:message|reply|body|正文|回复)\s*[:：]\s*/iu, '')
      .trim();
    if (stripped === text) {
      break;
    }
    text = stripped;
  }
  const lines = text.split(/\r?\n/u);
  while (lines.length && lines[lines.length - 1]?.trim().toLowerCase() === 'bye') {
    lines.pop();
  }
  return lines.join('\n').trim();
}

// Generated protocol text is rejected when it quotes protocol metadata lines;
// a bare label prefix (no separator) is enough to reject.
const PROTOCOL_METADATA_LINE_RE = createOrderMetadataLineRegex({
  optionalSeparator: true,
  extraLabels: ['payment(?:\\s+amount)?'],
});

function hasProtocolMetadataLine(value: string): boolean {
  return value.split(/\r?\n/u).some((line) => PROTOCOL_METADATA_LINE_RE.test(line));
}

function isGenericPrivateChatReply(value: string): boolean {
  return /^(Hello!|Thanks for your message\.|Thanks for sharing that\.|It has been a great conversation\.|We have been chatting for a while now\.|Thank you for the conversation! It was nice chatting with you\. See you next time!)/u.test(value);
}

export function normalizeGeneratedOrderProtocolText(
  value: unknown,
  options?: {
    maxChars?: number;
    allowUrls?: boolean;
    allowTables?: boolean;
  },
): string {
  const maxChars = Math.max(1, Math.floor(options?.maxChars ?? 500));
  const text = stripGeneratedProtocolText(value).slice(0, maxChars).trim();
  if (!text || isGenericPrivateChatReply(text) || hasProtocolMetadataLine(text)) {
    return '';
  }
  if (!options?.allowUrls && /https?:\/\//iu.test(text)) {
    return '';
  }
  if (!options?.allowTables && /\|.+\|/u.test(text)) {
    return '';
  }
  if (/(?:Result summary|In my role as|has accepted|has delivered)/iu.test(text)) {
    return '';
  }
  return text;
}

function buildSystemPrompt(persona: ChatPersona): string {
  const sections = [
    'You write one natural-language body for an Open Agent Connect skill-service protocol message.',
    'The daemon adds protocol tags and structured payment/order metadata. Do not include tags, metadata labels, txids, order ids, pin ids, URLs, markdown tables, or final "Bye" lines unless the user task itself truly requires a URL.',
    'Use first person when natural. Follow the local MetaBot persona without quoting the persona fields.',
  ];
  if (persona.role) {
    sections.push(`Persona role:\n${persona.role}`);
  }
  if (persona.soul) {
    sections.push(`Persona style:\n${persona.soul}`);
  }
  if (persona.goal) {
    sections.push(`Persona goal:\n${persona.goal}`);
  }
  return sections.join('\n\n');
}

function buildCallerOrderPrompt(input: CallerOrderProtocolTextGeneratorInput): string {
  return [
    'Stage: caller_order',
    'You are the buyer/caller MetaBot. Write the request body that will be sent to the provider after [ORDER].',
    'Speak to the provider directly in your own voice. Do not write "the user requests <provider>" or treat the provider as the user.',
    'Preserve enough task detail for the provider to execute the skill correctly.',
    'Use the original request language when clear. Keep it to one or two concise sentences.',
    `Caller: ${normalizeText(input.callerName) || normalizeText(input.callerGlobalMetaId) || 'local buyer MetaBot'}`,
    `Provider: ${normalizeText(input.providerName) || normalizeText(input.providerGlobalMetaId) || 'remote provider MetaBot'}`,
    `Service: ${normalizeText(input.serviceName) || 'Skill Service'}`,
    `Skill: ${normalizeText(input.providerSkill) || 'unknown'}`,
    `Output type: ${normalizeText(input.outputType) || 'text'}`,
    `Payment: ${normalizeText(input.paymentAmount) || '0'} ${normalizeText(input.paymentCurrency) || ''}`.trim(),
    `User task:\n${truncateForPrompt(normalizeText(input.userTask) || normalizeText(input.rawRequest) || 'No task text was recorded.', 1000)}`,
    `Task context:\n${truncateForPrompt(normalizeText(input.taskContext) || 'No additional context.', 700)}`,
    'Return only the order request body, under 240 characters.',
  ].join('\n\n');
}

function buildProviderOrderPrompt(input: ProviderOrderProtocolTextGeneratorInput): string {
  const serviceName = normalizeText(input.service.displayName)
    || normalizeText(input.service.serviceName)
    || 'Skill Service';
  const stagePurpose = input.stage === 'acknowledgement'
    ? 'Say that you received the order, have started processing it, it may take a little time, and ask the buyer to wait patiently.'
    : input.stage === 'long_task_notice'
      ? 'Say that this task may take longer than a typical task to generate and upload, and that you will keep processing it and share progress until the final delivery.'
      : 'Say that the service has been completed, mention the task only briefly, politely ask for a 1-5 rating, and say the feedback matters to you.';
  const lines = [
    `Stage: provider_${input.stage}`,
    'You are the provider MetaBot. Write the body of the provider message to the buyer.',
    stagePurpose,
    'Do not describe yourself in third person with phrases such as "has accepted" or "has delivered".',
    'Use the buyer request language when clear. Keep it to one or two concise sentences.',
    `Provider: ${normalizeText(input.providerName) || normalizeText(input.providerGlobalMetaId) || 'local provider MetaBot'}`,
    `Buyer: ${normalizeText(input.buyerGlobalMetaId) || 'remote buyer MetaBot'}`,
    `Service: ${serviceName}`,
    `Skill: ${normalizeText(input.service.providerSkill) || 'unknown'}`,
    `Output type: ${normalizeText(input.service.outputType) || 'text'}`,
    `Payment: ${normalizeText(input.paymentAmount) || normalizeText(input.service.price) || '0'} ${normalizeText(input.paymentCurrency) || normalizeText(input.service.currency) || ''}`.trim(),
    `Buyer request:\n${truncateForPrompt(normalizeText(input.userTask) || 'No buyer request was recorded.', 1000)}`,
  ];
  const taskContext = normalizeText(input.taskContext);
  if (taskContext) {
    lines.push(`Task context:\n${truncateForPrompt(taskContext, 700)}`);
  }
  const resultSummary = summarizeResultForPrompt(input.responseText);
  if (resultSummary) {
    lines.push(`Result gist for context only, do not paste it:\n${resultSummary}`);
  }
  lines.push(input.stage === 'acknowledgement'
    ? 'Return only the acknowledgement body, under 180 characters.'
    : input.stage === 'long_task_notice'
      ? 'Return only the long-task notice body, under 200 characters.'
      : 'Return only the rating request body, under 220 characters.');
  return lines.join('\n\n');
}

function buildBuyerRatingPrompt(input: BuyerRatingProtocolTextGeneratorInput): string {
  return [
    'Stage: buyer_rating',
    'You are the buyer MetaBot that requested a remote skill service. The provider has delivered a result and asked for feedback.',
    'Write the final rating message in your own voice. Include one clear numeric score from 1 to 5, where 5 is best.',
    'Briefly say whether the result satisfied the task and thank the provider.',
    'Do not include chain receipt text, pin IDs, metadata labels, URLs, markdown tables, rankings, or long data excerpts.',
    'Do not write phrases that imply the provider is the user, such as "用户请求 <provider>".',
    `Provider: ${normalizeText(input.providerName) || normalizeText(input.providerGlobalMetaId) || 'remote provider MetaBot'}`,
    `Expected output type: ${normalizeText(input.expectedOutputType) || 'text'}`,
    `Original request:\n${truncateForPrompt(normalizeText(input.originalRequest) || 'No original request was recorded.', 1000)}`,
    `Delivered result gist:\n${summarizeResultForPrompt(input.serviceResult) || 'No delivery text was recorded.'}`,
    `Provider rating request:\n${truncateForPrompt(normalizeText(input.ratingRequestText) || 'The provider is asking for a rating.', 500)}`,
    'Return only the rating message body, under 220 characters.',
  ].join('\n\n');
}

export function createLlmOrderProtocolTextGenerator(options: {
  llmExecutor: LlmExecutorLike;
  timeoutMs?: number;
  pollIntervalMs?: number;
}) {
  const timeoutMs = Math.max(1, Math.floor(options.timeoutMs ?? 45_000));
  const pollIntervalMs = Math.max(1, Math.floor(options.pollIntervalMs ?? 500));

  async function run(input: {
    paths: MetabotPaths;
    persona: ChatPersona;
    prompt: string;
    maxChars: number;
    allowUrls?: boolean;
    allowTables?: boolean;
  }): Promise<string | null> {
    const runtimeResolver = createLlmRuntimeResolver({
      runtimeStore: createLlmRuntimeStore(input.paths),
      bindingStore: createLlmBindingStore(input.paths),
      getPreferredRuntimeId: async () => {
        try {
          const raw = await fs.readFile(input.paths.preferredLlmRuntimePath, 'utf8');
          const data = JSON.parse(raw) as { runtimeId?: unknown };
          return typeof data.runtimeId === 'string' ? data.runtimeId : null;
        } catch {
          return null;
        }
      },
    });
    const result = await runLlmPromptWithRuntimeFallback({
      runtimeResolver,
      llmExecutor: options.llmExecutor,
      metaBotSlug: path.basename(input.paths.profileRoot),
      systemPrompt: buildSystemPrompt(input.persona),
      prompt: input.prompt,
      timeoutMs,
      pollIntervalMs,
      cwd: input.paths.profileRoot,
      markRuntimeUnavailableOnFailure: false,
    });
    if (result.status !== 'completed') {
      return null;
    }
    const generated = normalizeGeneratedOrderProtocolText(result.output, {
      maxChars: input.maxChars,
      allowUrls: input.allowUrls,
      allowTables: input.allowTables,
    });
    return generated || null;
  }

  return {
    generateCallerOrderText(input: CallerOrderProtocolTextGeneratorInput) {
      return run({
        paths: input.paths,
        persona: input.persona,
        prompt: buildCallerOrderPrompt(input),
        maxChars: 500,
        allowUrls: true,
      });
    },
    generateProviderOrderText(input: ProviderOrderProtocolTextGeneratorInput) {
      return run({
        paths: input.paths,
        persona: input.persona,
        prompt: buildProviderOrderPrompt(input),
        maxChars: input.stage === 'rating_request' ? 440 : 360,
      });
    },
    generateBuyerRatingText(input: BuyerRatingProtocolTextGeneratorInput) {
      return run({
        paths: input.paths,
        persona: input.persona,
        prompt: buildBuyerRatingPrompt(input),
        maxChars: 500,
      });
    },
  };
}

export function compactProtocolTextForFallback(value: unknown, maxChars = 80): string {
  return compactInlineText(value, maxChars);
}
