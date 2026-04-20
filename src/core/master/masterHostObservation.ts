import type {
  MasterContextCollectionInput,
  MasterContextFileExcerpt,
  MasterContextToolResult,
  MasterHostDirectorySnapshot,
  MasterHostObservationFrame,
  MasterHostSignalsInput,
} from './masterContextTypes'
import { isSensitivePath, sanitizeRelevantFiles, sanitizeSummaryText } from './masterContextSanitizer'

const RECENT_DIFF_WINDOW_MS = 5 * 60 * 1000

function normalizeText(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim()
    : ''
}

function normalizeNullableText(value: unknown): string | null {
  const normalized = normalizeText(value)
  return normalized || null
}

function normalizeBoolean(value: unknown): boolean {
  return value === true
}

function normalizeInteger(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value))
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.trunc(parsed))
    }
  }

  return fallback
}

function normalizeNullableInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value))
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.trunc(parsed))
    }
  }
  return null
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const entry of value) {
    const safeValue = sanitizeSummaryText(entry)
    if (!safeValue || seen.has(safeValue)) {
      continue
    }
    seen.add(safeValue)
    normalized.push(safeValue)
  }
  return normalized
}

function normalizeToolResults(value: unknown): MasterContextToolResult[] {
  if (!Array.isArray(value)) {
    return []
  }
  const results: MasterContextToolResult[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue
    }
    const record = entry as Record<string, unknown>
    const toolName = normalizeText(record.toolName)
    if (!toolName) {
      continue
    }
    results.push({
      toolName,
      exitCode: typeof record.exitCode === 'number' && Number.isFinite(record.exitCode)
        ? Math.trunc(record.exitCode)
        : null,
      stdout: typeof record.stdout === 'string' ? record.stdout.trim() : '',
      stderr: typeof record.stderr === 'string' ? record.stderr.trim() : '',
    })
  }
  return results
}

function normalizeFileExcerpts(value: unknown): MasterContextFileExcerpt[] {
  if (!Array.isArray(value)) {
    return []
  }
  const excerpts: MasterContextFileExcerpt[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue
    }
    const record = entry as Record<string, unknown>
    const filePath = normalizeText(record.path)
    const content = typeof record.content === 'string' ? record.content.trim() : ''
    if (!filePath || !content || isSensitivePath(filePath)) {
      continue
    }
    excerpts.push({
      path: filePath,
      content,
    })
  }
  return excerpts
}

function countMessages(value: unknown, role: 'user' | 'assistant'): number {
  if (!Array.isArray(value)) {
    return 0
  }
  return value.reduce((count, entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return count
    }
    const record = entry as Record<string, unknown>
    return normalizeText(record.role) === role && normalizeText(record.content)
      ? count + 1
      : count
  }, 0)
}

function extractFailingTests(result: MasterContextToolResult): string[] {
  const sources = [result.stdout, result.stderr].filter(Boolean)
  const tests: string[] = []
  const seen = new Set<string>()
  for (const source of sources) {
    const patterns = [
      /not ok\s+\d+\s+-\s+([^\n]+)/gi,
      /(?:^|\n)(?:FAIL|✕)\s+([^\n]+)/gi,
    ]
    for (const pattern of patterns) {
      let match: RegExpExecArray | null
      while ((match = pattern.exec(source)) !== null) {
        const testName = sanitizeSummaryText(match[1])
        if (!testName || seen.has(testName)) {
          continue
        }
        seen.add(testName)
        tests.push(testName)
      }
    }
  }
  return tests
}

function extractErrorSignature(result: MasterContextToolResult): string | null {
  const sources = [result.stderr, result.stdout]
  for (const source of sources) {
    if (!source) {
      continue
    }
    const explicitMatch = source.match(/(?:AssertionError|TypeError|ReferenceError|SyntaxError|Error):[^\n]*/i)
    if (explicitMatch) {
      return sanitizeSummaryText(explicitMatch[0])
    }
    const codeMatch = source.match(/\bERR_[A-Z0-9_]+\b/)
    if (codeMatch) {
      return sanitizeSummaryText(`Error: ${codeMatch[0]}`)
    }
    const firstLine = sanitizeSummaryText(source.split(/\r?\n/, 1)[0])
    if (firstLine) {
      return firstLine
    }
  }
  return null
}

function countRepeatedFailures(signatures: string[]): number {
  const counts = new Map<string, number>()
  for (const signature of signatures) {
    counts.set(signature, (counts.get(signature) ?? 0) + 1)
  }
  return Array.from(counts.values()).reduce((total, count) => (
    count > 1 ? total + count : total
  ), 0)
}

function readDirectorySnapshot(value: unknown): MasterHostDirectorySnapshot {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  return {
    availableMasters: normalizeInteger(record.availableMasters),
    trustedMasters: normalizeInteger(record.trustedMasters),
    onlineMasters: normalizeInteger(record.onlineMasters),
  }
}

function readHostSignals(value: unknown): MasterHostSignalsInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return value as MasterHostSignalsInput
}

function deriveNoProgressWindowMs(input: {
  now: number
  noProgressWindowMs: number | null
  lastMeaningfulDiffAt: number | null
}): number | null {
  if (input.noProgressWindowMs !== null) {
    return input.noProgressWindowMs
  }
  if (input.lastMeaningfulDiffAt === null || input.now < input.lastMeaningfulDiffAt) {
    return null
  }
  return Math.max(0, input.now - input.lastMeaningfulDiffAt)
}

function deriveDiffChangedRecently(input: {
  explicitValue: unknown
  now: number
  lastMeaningfulDiffAt: number | null
  diffSummary: string | null
}): boolean {
  if (typeof input.explicitValue === 'boolean') {
    return input.explicitValue
  }
  if (input.lastMeaningfulDiffAt !== null) {
    return input.now >= input.lastMeaningfulDiffAt
      && input.now - input.lastMeaningfulDiffAt <= RECENT_DIFF_WINDOW_MS
  }
  return Boolean(input.diffSummary)
}

function deriveActiveFileCount(input: {
  explicitValue: unknown
  relevantFiles: string[]
  fileExcerpts: MasterContextFileExcerpt[]
}): number {
  const explicit = normalizeNullableInteger(input.explicitValue)
  if (explicit !== null) {
    return explicit
  }
  const safeRelevantFiles = sanitizeRelevantFiles(input.relevantFiles, 100)
  const safeExcerptPaths = input.fileExcerpts
    .map((entry) => entry.path)
    .filter((filePath) => !isSensitivePath(filePath))
  return new Set([...safeRelevantFiles, ...safeExcerptPaths]).size
}

function deriveCandidateMasterKind(input: {
  explicitHint: unknown
  reviewCheckpointRisk: boolean
  recentFailures: number
  failingTests: number
  failingCommands: number
  repeatedErrorSignatures: string[]
  uncertaintySignals: string[]
}): string | null {
  const explicit = normalizeNullableText(input.explicitHint)
  if (explicit) {
    return explicit
  }
  if (
    input.reviewCheckpointRisk
    || input.uncertaintySignals.includes('patch_risk')
    || input.uncertaintySignals.includes('review_checkpoint_risk')
  ) {
    return 'review'
  }
  if (
    input.recentFailures > 0
    || input.failingTests > 0
    || input.failingCommands > 0
    || input.repeatedErrorSignatures.length > 0
    || input.uncertaintySignals.length > 0
  ) {
    return 'debug'
  }
  return null
}

export function buildMasterHostObservation(
  input: MasterContextCollectionInput | Record<string, unknown>
): MasterHostObservationFrame {
  const raw = (input ?? {}) as MasterContextCollectionInput
  const hostSignals = readHostSignals(raw.hostSignals)
  const toolResults = normalizeToolResults(raw.tools?.recentToolResults)
  const fileExcerpts = normalizeFileExcerpts(raw.workspace?.fileExcerpts)
  const errorSignatures = toolResults
    .filter((result) => result.exitCode !== null && result.exitCode !== 0)
    .map((result) => extractErrorSignature(result))
    .filter((entry): entry is string => Boolean(entry))

  let failingTests = 0
  let failingCommands = 0
  for (const result of toolResults) {
    if (result.exitCode === null || result.exitCode === 0) {
      continue
    }
    const extractedTests = extractFailingTests(result)
    if (extractedTests.length > 0) {
      failingTests += extractedTests.length
      continue
    }
    failingCommands += 1
  }

  const now = normalizeInteger(raw.now, Date.now())
  const lastMeaningfulDiffAt = normalizeNullableInteger(hostSignals.lastMeaningfulDiffAt)
  const uncertaintySignals = normalizeStringArray(hostSignals.uncertaintySignals)
  const reviewCheckpointRisk = normalizeBoolean(hostSignals.reviewCheckpointRisk)
  const recentFailures = toolResults.filter((result) => result.exitCode !== null && result.exitCode !== 0).length
  const candidateMasterKindHint = deriveCandidateMasterKind({
    explicitHint: hostSignals.candidateMasterKindHint,
    reviewCheckpointRisk,
    recentFailures,
    failingTests,
    failingCommands,
    repeatedErrorSignatures: Array.from(new Set(errorSignatures)),
    uncertaintySignals,
  })

  return {
    now,
    traceId: normalizeNullableText(raw.traceId),
    hostMode: normalizeNullableText(raw.hostMode) || 'unknown',
    workspaceId: normalizeNullableText(hostSignals.workspaceId),
    userIntent: {
      explicitlyAskedForMaster: normalizeBoolean(hostSignals.explicitlyAskedForMaster),
      explicitlyRejectedSuggestion: normalizeBoolean(hostSignals.explicitlyRejectedSuggestion),
      explicitlyRejectedAutoAsk: normalizeBoolean(hostSignals.explicitlyRejectedAutoAsk),
    },
    activity: {
      recentUserMessages: countMessages(raw.conversation?.recentMessages, 'user'),
      recentAssistantMessages: countMessages(raw.conversation?.recentMessages, 'assistant'),
      recentToolCalls: toolResults.length,
      recentFailures,
      repeatedFailureCount: countRepeatedFailures(errorSignatures),
      noProgressWindowMs: deriveNoProgressWindowMs({
        now,
        noProgressWindowMs: normalizeNullableInteger(hostSignals.noProgressWindowMs),
        lastMeaningfulDiffAt,
      }),
      lastMeaningfulDiffAt,
    },
    diagnostics: {
      failingTests,
      failingCommands,
      repeatedErrorSignatures: Array.from(new Set(errorSignatures)),
      uncertaintySignals,
      lastFailureSummary: errorSignatures[errorSignatures.length - 1] ?? null,
    },
    workState: {
      hasPlan: normalizeBoolean(raw.planner?.hasPlan),
      todoBlocked: normalizeBoolean(raw.planner?.todoBlocked),
      diffChangedRecently: deriveDiffChangedRecently({
        explicitValue: hostSignals.diffChangedRecently,
        now,
        lastMeaningfulDiffAt,
        diffSummary: normalizeNullableText(raw.workspace?.diffSummary),
      }),
      onlyReadingWithoutConverging: normalizeBoolean(raw.planner?.onlyReadingWithoutConverging),
      activeFileCount: deriveActiveFileCount({
        explicitValue: hostSignals.activeFileCount,
        relevantFiles: Array.isArray(raw.workspace?.relevantFiles) ? raw.workspace.relevantFiles : [],
        fileExcerpts,
      }),
    },
    directory: readDirectorySnapshot(hostSignals.directory),
    hints: {
      candidateMasterKindHint,
      preferredMasterName: normalizeNullableText(hostSignals.preferredMasterName),
      reviewCheckpointRisk,
    },
  }
}
