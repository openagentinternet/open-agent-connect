export type MasterAskContextMode = 'compact' | 'standard' | 'full_task';
export type MasterAskTriggerMode = 'manual' | 'suggest' | 'auto';
export type PublicMasterAskContextMode = 'compact' | 'standard';

export interface MasterAskTargetRef {
  servicePinId: string;
  providerGlobalMetaId: string;
  masterKind: string;
  displayName?: string | null;
}

export interface MasterContextConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface MasterContextToolResult {
  toolName: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface MasterContextFileExcerpt {
  path: string;
  content: string;
}

export interface MasterContextCollectionInput {
  now: number;
  hostMode: string;
  traceId: string | null;
  conversation: {
    currentUserRequest: string | null;
    recentMessages: MasterContextConversationMessage[];
  };
  tools: {
    recentToolResults: MasterContextToolResult[];
  };
  workspace: {
    goal: string | null;
    constraints: string[];
    relevantFiles: string[];
    diffSummary: string | null;
    fileExcerpts: MasterContextFileExcerpt[];
  };
  planner: {
    hasPlan: boolean;
    todoBlocked: boolean;
    onlyReadingWithoutConverging: boolean;
  };
}

export interface CollectedMasterContextArtifact {
  kind: 'text';
  label: string;
  content: string;
  source: 'terminal' | 'test' | 'diff' | 'chat' | 'file_excerpt';
  path: string | null;
}

export interface CollectedMasterContext {
  hostMode: string;
  taskSummary: string | null;
  questionCandidate: string | null;
  workspaceSummary: string | null;
  diagnostics: {
    failingTests: string[];
    failingCommands: string[];
    repeatedErrorSignatures: string[];
    stderrHighlights: string[];
  };
  workState: {
    goal: string | null;
    constraints: string[];
    errorSummary: string | null;
    diffSummary: string | null;
    relevantFiles: string[];
  };
  artifacts: CollectedMasterContextArtifact[];
}

export interface PackagedMasterAskDraft {
  target?: MasterAskTargetRef;
  triggerMode: MasterAskTriggerMode;
  contextMode: PublicMasterAskContextMode;
  userTask: string;
  question: string;
  goal: string | null;
  workspaceSummary: string | null;
  errorSummary: string | null;
  diffSummary: string | null;
  relevantFiles: string[];
  artifacts: Array<{
    kind: 'text';
    label: string;
    content: string;
  }>;
  constraints: string[];
  desiredOutput: {
    mode: string;
  };
}

export interface MasterContextBudget {
  relevantFiles: number;
  artifacts: number;
  artifactChars: number;
}

const MASTER_CONTEXT_BUDGETS: Record<PublicMasterAskContextMode, MasterContextBudget> = {
  compact: {
    relevantFiles: 3,
    artifacts: 3,
    artifactChars: 320,
  },
  standard: {
    relevantFiles: 8,
    artifacts: 8,
    artifactChars: 1200,
  },
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function resolveMasterAskContextMode(value: unknown): MasterAskContextMode {
  const normalized = normalizeText(value);
  if (normalized === 'compact' || normalized === 'full_task') {
    return normalized;
  }
  return 'standard';
}

export function resolvePublicMasterAskContextMode(value: unknown): PublicMasterAskContextMode {
  const resolved = resolveMasterAskContextMode(value);
  return resolved === 'compact' ? 'compact' : 'standard';
}

export function getMasterContextBudget(value: unknown): MasterContextBudget {
  return MASTER_CONTEXT_BUDGETS[resolvePublicMasterAskContextMode(value)];
}
