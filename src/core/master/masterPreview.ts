import { buildMasterRequestJson, parseMasterRequest, type MasterMessageArtifact, type MasterRequestMessage } from './masterMessageSchema';
import {
  getMasterContextBudget,
  resolvePublicMasterAskContextMode,
  type MasterAskContextMode,
  type MasterAskTargetRef,
  type MasterAskTriggerMode,
} from './masterContextTypes';
import {
  sanitizeArtifacts,
  sanitizeConstraintList,
  sanitizeRelevantFiles,
  sanitizeSummaryText,
  sanitizeTaskText,
} from './masterContextSanitizer';
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
    };
    confirmation: {
      requiresConfirmation: boolean;
      policyMode: MasterAskConfirmationMode;
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
      },
      confirmation: {
        requiresConfirmation: input.confirmationMode !== 'never',
        policyMode: input.confirmationMode,
        confirmCommand: `metabot master ask --trace-id ${input.traceId} --confirm`,
      },
      request: parsedRequest.value,
    },
  };
}
