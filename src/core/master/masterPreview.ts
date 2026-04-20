import { buildMasterRequestJson, parseMasterRequest, type MasterMessageArtifact, type MasterRequestMessage } from './masterMessageSchema';
import {
  getMasterContextBudget,
  resolvePublicMasterAskContextMode,
  type MasterAskContextMode,
  type MasterAskTargetRef,
  type MasterAskTriggerMode,
} from './masterContextTypes';
import {
  hasSensitiveContent,
  hasSensitivePathSnippet,
  isSensitivePath,
  sanitizeArtifacts,
  sanitizeConstraintList,
  sanitizeRelevantFiles,
  sanitizeSummaryText,
  sanitizeTaskText,
} from './masterContextSanitizer';
import type { MasterPayloadSafetySummary } from './masterAutoPolicy';
import type { MasterDirectoryItem } from './masterTypes';

export type MasterAskConfirmationMode = 'always' | 'sensitive_only' | 'never';

export interface MasterAskDraft {
  target: MasterAskTargetRef;
  triggerMode?: MasterAskTriggerMode | string | null;
  contextMode?: MasterAskContextMode | string | null;
  userTask: string;
  question: string;
  goal?: string | null;
  workspaceSummary?: string | null;
  errorSummary?: string | null;
  diffSummary?: string | null;
  relevantFiles?: string[];
  artifacts?: Array<Record<string, unknown>>;
  constraints?: string[];
  desiredOutput?: {
    mode?: string | null;
  } | null;
}

export interface PreparedMasterAskPreview {
  request: MasterRequestMessage;
  requestJson: string;
  preview: {
    target: {
      displayName: string;
      masterKind: string;
      providerGlobalMetaId: string;
      servicePinId: string;
      official: boolean;
      trustedTier: string | null;
      pricingMode: string | null;
      hostModes: string[];
    };
    intent: {
      userTask: string;
      question: string;
      goal: string | null;
    };
    context: {
      contextMode: 'compact' | 'standard';
      workspaceSummary: string | null;
      errorSummary: string | null;
      diffSummary: string | null;
      relevantFiles: string[];
      artifacts: MasterMessageArtifact[];
      constraints: string[];
    };
    safety: {
      noImplicitRepoUpload: true;
      noImplicitSecrets: true;
      transport: 'simplemsg';
      deliveryTarget: string;
      sensitivity: MasterPayloadSafetySummary;
    };
    confirmation: {
      requiresConfirmation: boolean;
      policyMode: MasterAskConfirmationMode;
      frictionMode: 'preview_confirm' | 'direct_send';
      confirmCommand: string;
    };
    request: MasterRequestMessage;
  };
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveTriggerMode(value: unknown): MasterAskTriggerMode {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'suggest' || normalized === 'auto') {
    return normalized;
  }
  return 'manual';
}

function resolveDesiredOutputMode(value: unknown): string | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return normalizeText((value as Record<string, unknown>).mode) || null;
  }
  return normalizeText(value) || null;
}

function readExtensionStrings(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  const extension = value as Record<string, unknown>;
  const strings: string[] = [];
  for (const entry of [
    extension.goal,
    extension.errorSummary,
    extension.diffSummary,
    extension.constraints,
  ]) {
    if (typeof entry === 'string') {
      const text = normalizeText(entry);
      if (text) {
        strings.push(text);
      }
      continue;
    }
    if (Array.isArray(entry)) {
      for (const item of entry) {
        const text = normalizeText(item);
        if (text) {
          strings.push(text);
        }
      }
    }
  }
  return strings;
}

function appendSafetyReason(reasons: string[], reason: string): void {
  if (!reasons.includes(reason)) {
    reasons.push(reason);
  }
}

function stillLooksSensitive(value: string): boolean {
  return /\b(token|secret|credential|password)\b/i.test(value);
}

function buildMasterPayloadSafetySummary(request: MasterRequestMessage): MasterPayloadSafetySummary {
  const reasons: string[] = [];
  const textFields = [
    request.task.userTask,
    request.task.question,
    request.context.workspaceSummary ?? '',
    ...readExtensionStrings(request.extensions),
  ].filter(Boolean);

  for (const field of textFields) {
    if (hasSensitiveContent(field)) {
      appendSafetyReason(reasons, 'Request payload still includes secret-like content.');
    }
    if (hasSensitivePathSnippet(field)) {
      appendSafetyReason(reasons, 'Request payload still references a sensitive file path.');
    }
    if (stillLooksSensitive(field)) {
      appendSafetyReason(reasons, 'Request payload still references potentially sensitive auth material.');
    }
  }

  for (const filePath of request.context.relevantFiles) {
    if (isSensitivePath(filePath)) {
      appendSafetyReason(reasons, 'Request payload still references a sensitive file path.');
    }
  }

  for (const artifact of request.context.artifacts) {
    if (hasSensitiveContent(artifact.label) || hasSensitiveContent(artifact.content)) {
      appendSafetyReason(reasons, 'Request artifact still includes secret-like content.');
    }
    if (hasSensitivePathSnippet(artifact.label) || hasSensitivePathSnippet(artifact.content)) {
      appendSafetyReason(reasons, 'Request artifact still references a sensitive file path.');
    }
    if (stillLooksSensitive(artifact.label) || stillLooksSensitive(artifact.content)) {
      appendSafetyReason(reasons, 'Request artifact still references potentially sensitive auth material.');
    }
  }

  return {
    isSensitive: reasons.length > 0,
    reasons,
  };
}

export function buildMasterAskPreview(input: {
  draft: MasterAskDraft | Record<string, unknown>;
  resolvedTarget: MasterDirectoryItem;
  caller: {
    globalMetaId: string;
    name?: string | null;
    host: string;
  };
  traceId: string;
  requestId: string;
  confirmationMode: MasterAskConfirmationMode;
  requiresConfirmationOverride?: boolean | null;
}): PreparedMasterAskPreview {
  const draft = input.draft as MasterAskDraft;
  const rawUserTask = normalizeText(draft.userTask);
  const rawQuestion = normalizeText(draft.question);
  if (!rawUserTask || !rawQuestion) {
    throw new Error('Master ask draft must include userTask and question.');
  }
  const userTask = sanitizeTaskText(rawUserTask, rawUserTask);
  const question = sanitizeTaskText(rawQuestion, rawQuestion);

  const contextMode = resolvePublicMasterAskContextMode(draft.contextMode);
  const budget = getMasterContextBudget(contextMode);
  const relevantFiles = sanitizeRelevantFiles(draft.relevantFiles, budget.relevantFiles);
  const artifacts = sanitizeArtifacts(draft.artifacts, budget.artifacts, budget.artifactChars);
  const constraints = sanitizeConstraintList(draft.constraints);
  const triggerMode = resolveTriggerMode(draft.triggerMode);
  const desiredOutputMode = resolveDesiredOutputMode(draft.desiredOutput) || 'structured_help';
  const goal = sanitizeSummaryText(draft.goal);
  const workspaceSummary = sanitizeSummaryText(draft.workspaceSummary);
  const errorSummary = sanitizeSummaryText(draft.errorSummary);
  const diffSummary = sanitizeSummaryText(draft.diffSummary);

  const requestJson = buildMasterRequestJson({
    type: 'master_request',
    version: '1.0.0',
    requestId: input.requestId,
    traceId: input.traceId,
    caller: {
      globalMetaId: input.caller.globalMetaId,
      name: input.caller.name ?? null,
      host: input.caller.host,
    },
    target: {
      masterServicePinId: input.resolvedTarget.masterPinId,
      providerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
      masterKind: input.resolvedTarget.masterKind,
    },
    task: {
      userTask,
      question,
    },
    context: {
      workspaceSummary,
      relevantFiles,
      artifacts,
    },
    trigger: {
      mode: triggerMode,
      reason: triggerMode === 'manual'
        ? 'Caller explicitly requested Ask Master preview.'
        : 'Caller runtime suggested consulting a Master.',
    },
    desiredOutput: desiredOutputMode,
    extensions: {
      goal,
      errorSummary,
      diffSummary,
      constraints,
      contextMode,
      targetDisplayName: normalizeText(draft.target?.displayName) || input.resolvedTarget.displayName,
    },
  });
  const parsedRequest = parseMasterRequest(requestJson);
  if (!parsedRequest.ok) {
    throw new Error(parsedRequest.message);
  }
  const safetySummary = buildMasterPayloadSafetySummary(parsedRequest.value);
  const requiresConfirmation = input.requiresConfirmationOverride ?? input.confirmationMode !== 'never';

  return {
    request: parsedRequest.value,
    requestJson,
    preview: {
      target: {
        displayName: input.resolvedTarget.displayName,
        masterKind: input.resolvedTarget.masterKind,
        providerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
        servicePinId: input.resolvedTarget.masterPinId,
        official: input.resolvedTarget.official,
        trustedTier: input.resolvedTarget.trustedTier,
        pricingMode: input.resolvedTarget.pricingMode,
        hostModes: [...input.resolvedTarget.hostModes],
      },
      intent: {
        userTask,
        question,
        goal,
      },
      context: {
        contextMode,
        workspaceSummary,
        errorSummary,
        diffSummary,
        relevantFiles,
        artifacts,
        constraints,
      },
      safety: {
        noImplicitRepoUpload: true,
        noImplicitSecrets: true,
        transport: 'simplemsg',
        deliveryTarget: input.resolvedTarget.providerGlobalMetaId,
        sensitivity: safetySummary,
      },
      confirmation: {
        requiresConfirmation,
        policyMode: input.confirmationMode,
        frictionMode: requiresConfirmation ? 'preview_confirm' : 'direct_send',
        confirmCommand: `metabot master ask --trace-id ${input.traceId} --confirm`,
      },
      request: parsedRequest.value,
    },
  };
}
