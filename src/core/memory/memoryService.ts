// Composition layer over the memory stores: assembles the prompt-injection
// XML for one conversation turn, and applies post-turn memory extraction.
// Ports IDBots coworkRunner.buildScopedMemoryPromptBlocksXml /
// CoworkStore.applyTurnMemoryUpdates onto the file-backed stores.
import { promises as fs } from 'node:fs';

import type { MetabotPaths } from '../state/paths';
import { createDreamStore, type DreamStore } from './dreamStore';
import { buildExperiencePromptBlocksXml } from './experiencePromptBlocks';
import { extractTurnMemoryChanges } from './memoryExtractor';
import { judgeMemoryCandidate } from './memoryJudge';
import { buildScopedMemoryPromptBlocks } from './memoryPromptBlocks';
import { resolveMemoryScopes, type ResolvedMemoryScopes } from './memoryScopeResolver';
import { createMemoryPolicyStore, type MemoryPolicyStore } from './memoryPolicy';
import { createMemoryStore, type MemoryStore } from './memoryStore';
import { normalizeMemoryMatchKey, scoreDeleteMatch } from './memoryText';
import { RECENT_SUMMARIES_PROMPT_DAYS } from './experiencePromptBlocks';
import type {
  ApplyTurnMemoryUpdatesOptions,
  ApplyTurnMemoryUpdatesResult,
  MemoryEffectivePolicy,
} from './memoryTypes';

export interface MemoryBlocksRequest {
  channel?: string;
  peerGlobalMetaId?: string;
  externalConversationId?: string;
  userText?: string;
}

export interface MemoryBlocksResult {
  xml: string;
  policy: MemoryEffectivePolicy;
  resolution: ResolvedMemoryScopes;
}

const OWNER_SCOPE_FETCH_MIN_ITEMS = 12;
const VALUE_BOUNDARIES_MAX_ITEMS = 5;

async function readSelfIdentityText(store: MemoryStore): Promise<string> {
  const entries = await store.list({
    usageClass: 'self_identity',
    status: 'created',
    limit: 1,
  });
  return entries[0]?.text ?? '';
}

/**
 * Build the full memory injection for one turn: scoped fact blocks plus the
 * experience hot layer (self-identity, value boundaries). Dream summaries and
 * knowledge blocks join in their own phases — the builders already tolerate
 * their absence.
 */
export async function buildMemoryBlocksForRequest(
  paths: MetabotPaths,
  input: MemoryBlocksRequest,
  stores: { memory?: MemoryStore; policy?: MemoryPolicyStore; dream?: DreamStore } = {},
): Promise<MemoryBlocksResult> {
  const memory = stores.memory ?? createMemoryStore(paths);
  const policyStore = stores.policy ?? createMemoryPolicyStore(paths);
  const dream = stores.dream ?? createDreamStore(paths);
  const policy = await policyStore.effectivePolicy();
  const resolution = resolveMemoryScopes({
    sourceChannel: input.channel,
    peerGlobalMetaId: input.peerGlobalMetaId,
    externalConversationId: input.externalConversationId,
  });
  if (!policy.memoryEnabled) {
    return { xml: '', policy, resolution };
  }

  const ownerEntries = await memory.list({
    scopeKind: 'owner',
    scopeKey: 'owner:self',
    status: 'created',
    limit: Math.max(policy.memoryUserMemoriesMaxItems, OWNER_SCOPE_FETCH_MIN_ITEMS),
    touchLastUsed: true,
  });

  let contactEntries: typeof ownerEntries = [];
  let conversationEntries: typeof ownerEntries = [];
  if (resolution.writeScope.kind === 'contact') {
    contactEntries = await memory.list({
      scope: resolution.writeScope,
      status: 'created',
      limit: policy.memoryUserMemoriesMaxItems,
      touchLastUsed: true,
    });
  } else if (resolution.writeScope.kind === 'conversation') {
    conversationEntries = await memory.list({
      scope: resolution.writeScope,
      status: 'created',
      limit: policy.memoryUserMemoriesMaxItems,
      touchLastUsed: true,
    });
  }

  const scopedXml = buildScopedMemoryPromptBlocks({
    channel: input.channel,
    ownerEntries,
    contactEntries,
    conversationEntries,
    currentUserText: input.userText,
    maxScopedEntries: 12,
    maxOwnerOperationalPreferences: 3,
    maxTotalChars: policy.memoryPromptMaxChars,
  });

  // The experience hot layer describes the bot itself (self-identity, its
  // self-distilled conduct rules, its recent dream diaries) — never owner
  // facts — so it is injected for every channel, matching the IDBots A2A path.
  const selfIdentityText = await readSelfIdentityText(memory);
  const valueBoundaries = await memory.list({
    usageClass: 'value_boundary',
    status: 'created',
    limit: VALUE_BOUNDARIES_MAX_ITEMS,
  });
  const recentSummaries = await dream.listDailySummaries({ limit: RECENT_SUMMARIES_PROMPT_DAYS });
  const experienceXml = buildExperiencePromptBlocksXml({
    identityText: selfIdentityText || null,
    summaries: recentSummaries.map((summary) => ({
      summaryDate: summary.summaryDate,
      summaryText: summary.summaryText,
      sessionRefs: summary.sessionRefs,
    })),
    valueBoundaries,
  });

  return {
    xml: [scopedXml, experienceXml].filter(Boolean).join('\n\n'),
    policy,
    resolution,
  };
}

function emptyTurnResult(): ApplyTurnMemoryUpdatesResult {
  return {
    totalChanges: 0,
    created: 0,
    updated: 0,
    deleted: 0,
    judgeRejected: 0,
    llmReviewed: 0,
    skipped: 0,
  };
}

/**
 * Post-turn memory write path: regex extraction (+ optional LLM judge for
 * borderline candidates), then create/revive or delete inside the resolved
 * write scope. Ported from CoworkStore.applyTurnMemoryUpdates.
 */
export async function applyTurnMemoryExtraction(
  paths: MetabotPaths,
  options: ApplyTurnMemoryUpdatesOptions,
  stores: { memory?: MemoryStore; policy?: MemoryPolicyStore } = {},
): Promise<ApplyTurnMemoryUpdatesResult> {
  const memory = stores.memory ?? createMemoryStore(paths);
  const policyStore = stores.policy ?? createMemoryPolicyStore(paths);
  const policy = await policyStore.effectivePolicy();
  const result = emptyTurnResult();
  if (!policy.memoryEnabled) {
    return result;
  }

  const resolved = resolveMemoryScopes({
    sourceChannel: options.channel,
    peerGlobalMetaId: options.peerGlobalMetaId,
    externalConversationId: options.externalConversationId,
  });

  const extracted = extractTurnMemoryChanges({
    userText: options.userText,
    assistantText: options.assistantText,
    guardLevel: policy.memoryGuardLevel,
    maxImplicitAdds: policy.memoryImplicitUpdateEnabled ? 2 : 0,
  });
  result.totalChanges = extracted.length;

  for (const change of extracted) {
    if (change.action === 'add') {
      if (!policy.memoryImplicitUpdateEnabled && !change.isExplicit) {
        result.skipped += 1;
        continue;
      }
      const judge = await judgeMemoryCandidate({
        text: change.text,
        isExplicit: change.isExplicit,
        guardLevel: policy.memoryGuardLevel,
        ...(policy.memoryLlmJudgeEnabled && options.judgeComplete
          ? { judgeComplete: options.judgeComplete }
          : {}),
      });
      if (judge.source === 'llm') {
        result.llmReviewed += 1;
      }
      if (!judge.accepted) {
        result.judgeRejected += 1;
        result.skipped += 1;
        continue;
      }

      const write = await memory.createOrRevive({
        text: change.text,
        confidence: change.confidence,
        isExplicit: change.isExplicit,
        scope: resolved.writeScope,
        source: {
          role: 'user',
          sessionId: options.sessionId,
          messageId: options.userMessageId,
          sourceChannel: options.channel,
          sourceType: change.isExplicit ? 'turn_explicit' : 'turn_implicit',
          sourceId: options.userMessageId,
        },
      });

      if (!change.isExplicit && options.assistantMessageId) {
        // The assistant half of the turn rides on the same entry as a source.
        await memory.addSource(write.memory.id, resolved.writeScope, {
          role: 'assistant',
          sessionId: options.sessionId,
          messageId: options.assistantMessageId,
          sourceChannel: options.channel,
          sourceType: 'turn_assistant',
          sourceId: options.assistantMessageId,
        });
      }

      if (write.created) result.created += 1;
      else if (write.updated) result.updated += 1;
      else result.skipped += 1;
      continue;
    }

    const key = normalizeMemoryMatchKey(change.text);
    if (!key) {
      result.skipped += 1;
      continue;
    }

    const candidates = await memory.list({
      scope: resolved.writeScope,
      status: 'all',
      includeDeleted: false,
      limit: 100,
    });
    let target: (typeof candidates)[number] | null = null;
    let bestScore = 0;
    for (const entry of candidates) {
      const currentKey = normalizeMemoryMatchKey(entry.text);
      if (!currentKey) continue;
      const score = scoreDeleteMatch(currentKey, key);
      if (score <= bestScore) continue;
      bestScore = score;
      target = entry;
    }

    if (!target) {
      result.skipped += 1;
      continue;
    }

    const deleted = await memory.remove({
      id: target.id,
      scope: resolved.writeScope,
    });
    if (deleted) result.deleted += 1;
    else result.skipped += 1;
  }

  await memory.markOrphanImplicitMemoriesStale({ scope: resolved.writeScope });
  return result;
}
