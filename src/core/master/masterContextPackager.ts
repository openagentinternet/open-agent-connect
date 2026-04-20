import type {
  CollectedMasterContext,
  MasterAskTargetRef,
  PackagedMasterAskDraft,
} from './masterContextTypes';
import {
  getMasterContextBudget,
  resolvePublicMasterAskContextMode,
} from './masterContextTypes';
import {
  sanitizeArtifacts,
  sanitizeConstraintList,
  sanitizeRelevantFiles,
  sanitizeSummaryText,
  sanitizeTaskText,
} from './masterContextSanitizer';

function normalizeText(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim()
    : '';
}

function normalizeNullableText(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized || null;
}

function deriveDefaultQuestion(collected: CollectedMasterContext): string {
  if (collected.questionCandidate) {
    return collected.questionCandidate;
  }
  const safeErrorSignature = sanitizeSummaryText(collected.diagnostics.repeatedErrorSignatures[0]);
  if (safeErrorSignature) {
    return `What is the most likely root cause of "${safeErrorSignature}", and what should I try next?`;
  }
  if (collected.diagnostics.failingTests[0]) {
    return `Why is "${collected.diagnostics.failingTests[0]}" failing, and what should I try next?`;
  }
  return 'What is the most likely root cause and the next best fix?';
}

function normalizeTriggerMode(value: unknown): 'manual' | 'suggest' | 'auto' {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'suggest' || normalized === 'auto') {
    return normalized;
  }
  return 'manual';
}

export function packageMasterContextForAsk(input: {
  collected: CollectedMasterContext;
  target?: MasterAskTargetRef | null;
  triggerMode?: string | null;
  contextMode?: string | null;
  explicitUserTask?: string | null;
  explicitQuestion?: string | null;
  desiredOutputMode?: string | null;
}): PackagedMasterAskDraft {
  const contextMode = resolvePublicMasterAskContextMode(input.contextMode);
  const budget = getMasterContextBudget(contextMode);
  const defaultUserTask = 'Diagnose the current blocked task with Ask Master.';
  const defaultQuestion = 'What is the most likely root cause and the next best fix?';
  const userTask = sanitizeTaskText(
    normalizeNullableText(input.explicitUserTask)
      ?? input.collected.taskSummary
      ?? defaultUserTask,
    defaultUserTask
  );
  const question = sanitizeTaskText(
    normalizeNullableText(input.explicitQuestion)
      ?? deriveDefaultQuestion(input.collected),
    defaultQuestion
  );
  const relevantFiles = sanitizeRelevantFiles(input.collected.workState.relevantFiles, budget.relevantFiles);
  const artifacts = sanitizeArtifacts(input.collected.artifacts, budget.artifacts, budget.artifactChars)
    .map((artifact) => ({
      kind: 'text' as const,
      label: artifact.label,
      content: artifact.content,
    }));

  return {
    target: input.target ?? undefined,
    triggerMode: normalizeTriggerMode(input.triggerMode),
    contextMode,
    userTask,
    question,
    goal: sanitizeSummaryText(input.collected.workState.goal),
    workspaceSummary: sanitizeSummaryText(input.collected.workspaceSummary),
    errorSummary: sanitizeSummaryText(input.collected.workState.errorSummary),
    diffSummary: sanitizeSummaryText(input.collected.workState.diffSummary),
    relevantFiles,
    artifacts,
    constraints: sanitizeConstraintList(input.collected.workState.constraints),
    desiredOutput: {
      mode: normalizeNullableText(input.desiredOutputMode) ?? 'structured_help',
    },
  };
}
