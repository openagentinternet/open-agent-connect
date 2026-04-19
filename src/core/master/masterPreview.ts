import { buildMasterRequestJson, parseMasterRequest, type MasterMessageArtifact, type MasterRequestMessage } from './masterMessageSchema';
import type { MasterDirectoryItem } from './masterTypes';

export type MasterAskContextMode = 'compact' | 'standard' | 'full_task';
export type MasterAskTriggerMode = 'manual' | 'suggest' | 'auto';
export type MasterAskConfirmationMode = 'always' | 'sensitive_only' | 'never';

export interface MasterAskDraft {
  target: {
    servicePinId: string;
    providerGlobalMetaId: string;
    masterKind: string;
    displayName?: string | null;
  };
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

function normalizeArtifacts(value: unknown, limit: number): MasterMessageArtifact[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const artifacts: MasterMessageArtifact[] = [];
  for (const entry of value) {
    if (artifacts.length >= limit) {
      break;
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const item = entry as Record<string, unknown>;
    const kind = normalizeText(item.kind);
    const label = normalizeText(item.label);
    const content = normalizeText(item.content);
    if (!kind || !label || !content) {
      continue;
    }
    artifacts.push({
      kind,
      label,
      content,
      mimeType: normalizeText(item.mimeType) || null,
    });
  }
  return artifacts;
}

function resolveContextMode(value: unknown): 'compact' | 'standard' {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'compact') {
    return 'compact';
  }
  return 'standard';
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
  const userTask = normalizeText(draft.userTask);
  const question = normalizeText(draft.question);
  if (!userTask || !question) {
    throw new Error('Master ask draft must include userTask and question.');
  }

  const contextMode = resolveContextMode(draft.contextMode);
  const itemLimit = contextMode === 'compact' ? 3 : 8;
  const relevantFiles = normalizeStringArray(draft.relevantFiles).slice(0, itemLimit);
  const artifacts = normalizeArtifacts(draft.artifacts, itemLimit);
  const constraints = normalizeStringArray(draft.constraints);
  const triggerMode = resolveTriggerMode(draft.triggerMode);
  const desiredOutputMode = resolveDesiredOutputMode(draft.desiredOutput) || 'structured_help';

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
      workspaceSummary: normalizeText(draft.workspaceSummary) || null,
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
      goal: normalizeText(draft.goal) || null,
      errorSummary: normalizeText(draft.errorSummary) || null,
      diffSummary: normalizeText(draft.diffSummary) || null,
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
        goal: normalizeText(draft.goal) || null,
      },
      context: {
        contextMode,
        workspaceSummary: normalizeText(draft.workspaceSummary) || null,
        errorSummary: normalizeText(draft.errorSummary) || null,
        diffSummary: normalizeText(draft.diffSummary) || null,
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
        requiresConfirmation: true,
        policyMode: input.confirmationMode,
        confirmCommand: `metabot master ask --trace-id ${input.traceId} --confirm`,
      },
      request: parsedRequest.value,
    },
  };
}
