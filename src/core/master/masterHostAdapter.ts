import type { AskMasterConfig } from '../config/configTypes';
import { collectMasterContext } from './masterContextCollector';
import { packageMasterContextForAsk } from './masterContextPackager';
import type {
  CollectedMasterContext,
  MasterContextCollectionInput,
  PackagedMasterAskDraft,
} from './masterContextTypes';
import { evaluateMasterPolicy } from './masterPolicyGate';
import { resolveMasterCandidate, selectMasterCandidate } from './masterSelector';
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

function mentionsDebugMaster(value: string): boolean {
  return /\bdebug master\b/i.test(value);
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
  hostMode?: string | null;
  trustedMasters?: string[];
}): MasterDirectoryItem | null {
  const action = normalizeManualAskAction(input.action);
  const preferredMasterName = derivePreferredMasterName(action);
  const preferredMasterKind = derivePreferredMasterKind(action);
  return selectMasterCandidate({
    hostMode: normalizeText(input.hostMode) || 'unknown',
    preferredDisplayName: preferredMasterName,
    preferredMasterKind,
    trustedMasters: input.trustedMasters,
    onlineOnly: true,
    candidates: input.masters,
  });
}

export function prepareManualAskHostAction(input: {
  action: ManualAskHostAction | Record<string, unknown>;
  context: MasterContextCollectionInput | Record<string, unknown>;
  masters: MasterDirectoryItem[];
  config: Pick<AskMasterConfig, 'contextMode' | 'trustedMasters'>
    & Partial<Pick<AskMasterConfig, 'enabled' | 'triggerMode' | 'confirmationMode'>>;
}): PreparedManualAskHostAction {
  const action = normalizeManualAskAction(input.action);
  if (!action.utterance) {
    throw new Error('Manual Ask Master host action requires a non-empty utterance.');
  }

  const collected = collectMasterContext(input.context);
  const preferredMasterName = derivePreferredMasterName(action);
  const preferredMasterKind = derivePreferredMasterKind(action);
  const selection = resolveMasterCandidate({
    hostMode: collected.hostMode,
    preferredDisplayName: preferredMasterName,
    preferredMasterKind,
    trustedMasters: input.config.trustedMasters,
    onlineOnly: true,
    candidates: input.masters,
  });
  const selectedTarget = selection.selectedMaster ?? selectMasterForManualAsk({
    action,
    masters: input.masters,
    hostMode: collected.hostMode,
    trustedMasters: input.config.trustedMasters,
  });
  const policy = evaluateMasterPolicy({
    config: input.config,
    action: 'manual_ask',
    selectedMaster: selectedTarget,
  });
  if (!policy.allowed && policy.code) {
    const error = new Error(policy.blockedReason || 'Ask Master policy blocked the current host action.');
    (error as Error & { code?: string }).code = policy.code || undefined;
    throw error;
  }
  if (!selectedTarget) {
    const failureDetail = normalizeText(selection.failureMessage);
    const error = new Error(
      failureDetail
        ? `No eligible online Master matched the current host action. ${failureDetail}`
        : 'No eligible online Master matched the current host action.'
    );
    (error as Error & { code?: string }).code = selection.failureCode || 'master_not_found';
    throw error;
  }
  if (!policy.allowed) {
    const error = new Error(policy.blockedReason || 'Ask Master policy blocked the current host action.');
    (error as Error & { code?: string }).code = policy.code || undefined;
    throw error;
  }

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
    contextMode: policy.contextMode,
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
