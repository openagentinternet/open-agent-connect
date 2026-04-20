import type { AskMasterConfig } from '../config/configTypes';
import { collectMasterContext } from './masterContextCollector';
import { packageMasterContextForAsk } from './masterContextPackager';
import type {
  CollectedMasterContext,
  MasterContextCollectionInput,
  PackagedMasterAskDraft,
} from './masterContextTypes';
import type { MasterDirectoryItem } from './masterTypes';

export interface ManualAskHostAction {
  kind: 'manual_ask';
  utterance: string;
  preferredMasterName?: string | null;
  preferredMasterKind?: string | null;
}

export type HostAskMasterAction =
  | ManualAskHostAction
  | {
      kind: 'accept_suggest';
      traceId: string;
      suggestionId: string;
    }
  | {
      kind: 'reject_suggest';
      traceId: string;
      suggestionId: string;
      reason?: string | null;
    };

export interface PreparedManualAskHostAction {
  action: ManualAskHostAction;
  collected: CollectedMasterContext;
  draft: PackagedMasterAskDraft;
  selectedTarget: MasterDirectoryItem;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeManualAskAction(action: ManualAskHostAction | Record<string, unknown>): ManualAskHostAction {
  const record = (action ?? {}) as Record<string, unknown>;
  return {
    kind: 'manual_ask',
    utterance: normalizeText(record.utterance),
    preferredMasterName: normalizeText(record.preferredMasterName) || null,
    preferredMasterKind: normalizeText(record.preferredMasterKind) || null,
  };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of value) {
    const text = normalizeText(entry);
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    normalized.push(text);
  }
  return normalized;
}

function mentionsDebugMaster(value: string): boolean {
  return /\bdebug master\b/i.test(value);
}

function normalizeComparableText(value: unknown): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isManualAskCommand(value: string): boolean {
  return Boolean(extractPreferredMasterNameFromUtterance(value))
    || /^(?:please\s+|can you\s+|could you\s+|would you\s+|let'?s\s+|help me\s+|go\s+)?ask\s+(?:a\s+|the\s+)?master\b/i.test(value)
    || /^(?:please\s+|can you\s+|could you\s+|would you\s+|let'?s\s+|help me\s+|go\s+)?ask\s+debug master\b/i.test(value)
    || /^(?:请|帮我|麻烦你|去)?\s*(?:去问|问问).*(?:master|Master)/i.test(value);
}

function extractPreferredMasterNameFromUtterance(value: string): string | null {
  const utterance = normalizeText(value);
  if (!utterance) {
    return null;
  }

  const directMatch = utterance.match(
    /^(?:please\s+|can you\s+|could you\s+|would you\s+|let'?s\s+|help me\s+|go\s+)?ask\s+(.+?\bmaster)\b/i
  );
  const namedTarget = normalizeText(directMatch?.[1]);
  if (namedTarget && !/^(?:a|the)\s+master$/i.test(namedTarget)) {
    return namedTarget;
  }

  const chineseMatch = utterance.match(/(?:去问|问问)(.+?\bmaster)\b/i);
  const chineseTarget = normalizeText(chineseMatch?.[1]);
  if (chineseTarget) {
    return chineseTarget;
  }

  return null;
}

function derivePreferredMasterName(action: ManualAskHostAction): string | null {
  const explicit = normalizeText(action.preferredMasterName);
  if (explicit) {
    return explicit;
  }
  const utterance = normalizeText(action.utterance);
  if (mentionsDebugMaster(utterance)) {
    return 'debug master';
  }
  return extractPreferredMasterNameFromUtterance(utterance);
}

function derivePreferredMasterKind(action: ManualAskHostAction): string | null {
  const explicit = normalizeText(action.preferredMasterKind);
  if (explicit) {
    return explicit;
  }
  const utterance = normalizeText(action.utterance);
  if (mentionsDebugMaster(utterance)) {
    return 'debug';
  }
  const derivedName = extractPreferredMasterNameFromUtterance(utterance);
  const kindMatch = normalizeText(derivedName).match(/^([A-Za-z0-9_-]+)\s+master$/i);
  if (kindMatch) {
    return normalizeText(kindMatch[1]);
  }
  return null;
}

function matchesPreferredMasterName(entry: MasterDirectoryItem, preferredMasterName: string | null): boolean {
  const preferredName = normalizeComparableText(preferredMasterName);
  if (!preferredName) {
    return false;
  }
  const displayName = normalizeComparableText(entry.displayName);
  const serviceName = normalizeComparableText(entry.serviceName);
  return displayName === preferredName
    || serviceName === preferredName
    || displayName.includes(preferredName)
    || serviceName.includes(preferredName);
}

function matchesPreferredMasterKind(entry: MasterDirectoryItem, preferredMasterKind: string | null): boolean {
  const preferredKind = normalizeComparableText(preferredMasterKind);
  if (!preferredKind) {
    return false;
  }
  return normalizeComparableText(entry.masterKind) === preferredKind;
}

function scoreManualAskTarget(input: {
  entry: MasterDirectoryItem;
  preferredMasterName: string | null;
  preferredMasterKind: string | null;
  trustedMasterPins: Set<string>;
}): [number, number, number, number, number, number] {
  const displayName = normalizeComparableText(input.entry.displayName);
  const serviceName = normalizeComparableText(input.entry.serviceName);
  const preferredName = normalizeComparableText(input.preferredMasterName);
  const preferredKind = normalizeComparableText(input.preferredMasterKind);
  const exactNameMatch = preferredName
    ? Number(displayName === preferredName || serviceName === preferredName)
    : 0;
  const partialNameMatch = preferredName
    ? Number(displayName.includes(preferredName) || serviceName.includes(preferredName))
    : 0;
  const kindMatch = preferredKind
    ? Number(normalizeComparableText(input.entry.masterKind) === preferredKind)
    : 0;
  const trusted = Number(input.trustedMasterPins.has(normalizeText(input.entry.masterPinId)));
  const official = Number(input.entry.official === true);
  const updatedAt = Number.isFinite(input.entry.updatedAt) ? Math.trunc(input.entry.updatedAt) : 0;
  return [exactNameMatch, partialNameMatch, kindMatch, trusted, official, updatedAt];
}

function extractFallbackTaskText(input: {
  utterance: string;
  context: MasterContextCollectionInput | Record<string, unknown>;
}): string | null {
  const record = (input.context ?? {}) as Record<string, unknown>;
  const conversation = (record.conversation ?? {}) as Record<string, unknown>;
  const currentUserRequest = normalizeText(conversation.currentUserRequest);
  if (currentUserRequest && !isManualAskCommand(currentUserRequest)) {
    return currentUserRequest;
  }

  const utterance = normalizeText(input.utterance);
  const messages = Array.isArray(conversation.recentMessages) ? conversation.recentMessages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = messages[index];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const message = entry as Record<string, unknown>;
    if (normalizeText(message.role) !== 'user') {
      continue;
    }
    const content = normalizeText(message.content);
    if (!content || content === utterance || isManualAskCommand(content)) {
      continue;
    }
    return content;
  }

  return null;
}

export function selectMasterForManualAsk(input: {
  action: ManualAskHostAction | Record<string, unknown>;
  masters: MasterDirectoryItem[];
  trustedMasters?: string[];
}): MasterDirectoryItem | null {
  const action = normalizeManualAskAction(input.action);
  const preferredMasterName = derivePreferredMasterName(action);
  const preferredMasterKind = derivePreferredMasterKind(action);
  const trustedMasterPins = new Set(normalizeStringArray(input.trustedMasters));
  const candidates = input.masters.filter((entry) => entry.available !== false && entry.online !== false);
  if (candidates.length === 0) {
    return null;
  }

  const nameMatchedCandidates = preferredMasterName
    ? candidates.filter((entry) => matchesPreferredMasterName(entry, preferredMasterName))
    : candidates;
  if (preferredMasterName && nameMatchedCandidates.length === 0) {
    return null;
  }

  const kindMatchedCandidates = preferredMasterKind
    ? nameMatchedCandidates.filter((entry) => matchesPreferredMasterKind(entry, preferredMasterKind))
    : nameMatchedCandidates;
  if (preferredMasterKind && kindMatchedCandidates.length === 0) {
    return null;
  }

  return [...kindMatchedCandidates].sort((left, right) => {
    const leftScore = scoreManualAskTarget({
      entry: left,
      preferredMasterName,
      preferredMasterKind,
      trustedMasterPins,
    });
    const rightScore = scoreManualAskTarget({
      entry: right,
      preferredMasterName,
      preferredMasterKind,
      trustedMasterPins,
    });
    for (let index = 0; index < leftScore.length; index += 1) {
      if (rightScore[index] !== leftScore[index]) {
        return rightScore[index] - leftScore[index];
      }
    }
    return 0;
  })[0] ?? null;
}

export function prepareManualAskHostAction(input: {
  action: ManualAskHostAction | Record<string, unknown>;
  context: MasterContextCollectionInput | Record<string, unknown>;
  masters: MasterDirectoryItem[];
  config: Pick<AskMasterConfig, 'contextMode' | 'trustedMasters'>;
}): PreparedManualAskHostAction {
  const action = normalizeManualAskAction(input.action);
  if (!action.utterance) {
    throw new Error('Manual Ask Master host action requires a non-empty utterance.');
  }

  const selectedTarget = selectMasterForManualAsk({
    action,
    masters: input.masters,
    trustedMasters: input.config.trustedMasters,
  });
  if (!selectedTarget) {
    throw new Error('No eligible online Master matched the current host action.');
  }

  const collected = collectMasterContext(input.context);
  const fallbackTaskText = extractFallbackTaskText({
    utterance: action.utterance,
    context: input.context,
  });
  const explicitTaskText = isManualAskCommand(collected.questionCandidate ?? '')
    ? fallbackTaskText
    : null;
  const draft = packageMasterContextForAsk({
    collected,
    target: {
      servicePinId: selectedTarget.masterPinId,
      providerGlobalMetaId: selectedTarget.providerGlobalMetaId,
      masterKind: selectedTarget.masterKind,
      displayName: selectedTarget.displayName,
    },
    triggerMode: 'manual',
    contextMode: input.config.contextMode,
    explicitUserTask: explicitTaskText,
    explicitQuestion: explicitTaskText,
  });

  return {
    action,
    collected,
    draft,
    selectedTarget,
  };
}
