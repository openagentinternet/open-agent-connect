"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMasterHostObservation = buildMasterHostObservation;
const masterContextSanitizer_1 = require("./masterContextSanitizer");
const RECENT_DIFF_WINDOW_MS = 5 * 60 * 1000;
function normalizeText(value) {
    return typeof value === 'string'
        ? value.replace(/\s+/g, ' ').trim()
        : '';
}
function normalizeNullableText(value) {
    const normalized = normalizeText(value);
    return normalized || null;
}
function normalizeBoolean(value) {
    return value === true;
}
function normalizeInteger(value, fallback = 0) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(0, Math.trunc(value));
    }
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) {
            return Math.max(0, Math.trunc(parsed));
        }
    }
    return fallback;
}
function normalizeNullableInteger(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(0, Math.trunc(value));
    }
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) {
            return Math.max(0, Math.trunc(parsed));
        }
    }
    return null;
}
function normalizeStringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const seen = new Set();
    const normalized = [];
    for (const entry of value) {
        const safeValue = (0, masterContextSanitizer_1.sanitizeSummaryText)(entry);
        if (!safeValue || seen.has(safeValue)) {
            continue;
        }
        seen.add(safeValue);
        normalized.push(safeValue);
    }
    return normalized;
}
function normalizeToolResults(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const results = [];
    for (const entry of value) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            continue;
        }
        const record = entry;
        const toolName = normalizeText(record.toolName);
        if (!toolName) {
            continue;
        }
        results.push({
            toolName,
            exitCode: typeof record.exitCode === 'number' && Number.isFinite(record.exitCode)
                ? Math.trunc(record.exitCode)
                : null,
            stdout: typeof record.stdout === 'string' ? record.stdout.trim() : '',
            stderr: typeof record.stderr === 'string' ? record.stderr.trim() : '',
        });
    }
    return results;
}
function normalizeFileExcerpts(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const excerpts = [];
    for (const entry of value) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            continue;
        }
        const record = entry;
        const filePath = normalizeText(record.path);
        const content = typeof record.content === 'string' ? record.content.trim() : '';
        if (!filePath || !content || (0, masterContextSanitizer_1.isSensitivePath)(filePath)) {
            continue;
        }
        excerpts.push({
            path: filePath,
            content,
        });
    }
    return excerpts;
}
function countMessages(value, role) {
    if (!Array.isArray(value)) {
        return 0;
    }
    return value.reduce((count, entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            return count;
        }
        const record = entry;
        return normalizeText(record.role) === role && normalizeText(record.content)
            ? count + 1
            : count;
    }, 0);
}
function extractFailingTests(result) {
    const sources = [result.stdout, result.stderr].filter(Boolean);
    const tests = [];
    const seen = new Set();
    for (const source of sources) {
        const patterns = [
            /not ok\s+\d+\s+-\s+([^\n]+)/gi,
            /(?:^|\n)(?:FAIL|✕)\s+([^\n]+)/gi,
        ];
        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(source)) !== null) {
                const testName = (0, masterContextSanitizer_1.sanitizeSummaryText)(match[1]);
                if (!testName || seen.has(testName)) {
                    continue;
                }
                seen.add(testName);
                tests.push(testName);
            }
        }
    }
    return tests;
}
function extractErrorSignature(result) {
    const sources = [result.stderr, result.stdout];
    for (const source of sources) {
        if (!source) {
            continue;
        }
        const explicitMatch = source.match(/(?:AssertionError|TypeError|ReferenceError|SyntaxError|Error):[^\n]*/i);
        if (explicitMatch) {
            return (0, masterContextSanitizer_1.sanitizeSummaryText)(explicitMatch[0]);
        }
        const codeMatch = source.match(/\bERR_[A-Z0-9_]+\b/);
        if (codeMatch) {
            return (0, masterContextSanitizer_1.sanitizeSummaryText)(`Error: ${codeMatch[0]}`);
        }
        const firstLine = (0, masterContextSanitizer_1.sanitizeSummaryText)(source.split(/\r?\n/, 1)[0]);
        if (firstLine) {
            return firstLine;
        }
    }
    return null;
}
function countRepeatedFailures(signatures) {
    const counts = new Map();
    for (const signature of signatures) {
        counts.set(signature, (counts.get(signature) ?? 0) + 1);
    }
    return Array.from(counts.values()).reduce((total, count) => (count > 1 ? total + count : total), 0);
}
function readDirectorySnapshot(value) {
    const record = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
    return {
        availableMasters: normalizeInteger(record.availableMasters),
        trustedMasters: normalizeInteger(record.trustedMasters),
        onlineMasters: normalizeInteger(record.onlineMasters),
    };
}
function readHostSignals(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return value;
}
function deriveNoProgressWindowMs(input) {
    if (input.noProgressWindowMs !== null) {
        return input.noProgressWindowMs;
    }
    if (input.lastMeaningfulDiffAt === null || input.now < input.lastMeaningfulDiffAt) {
        return null;
    }
    return Math.max(0, input.now - input.lastMeaningfulDiffAt);
}
function deriveDiffChangedRecently(input) {
    if (typeof input.explicitValue === 'boolean') {
        return input.explicitValue;
    }
    if (input.lastMeaningfulDiffAt !== null) {
        return input.now >= input.lastMeaningfulDiffAt
            && input.now - input.lastMeaningfulDiffAt <= RECENT_DIFF_WINDOW_MS;
    }
    return Boolean(input.diffSummary);
}
function deriveActiveFileCount(input) {
    const explicit = normalizeNullableInteger(input.explicitValue);
    if (explicit !== null) {
        return explicit;
    }
    const safeRelevantFiles = (0, masterContextSanitizer_1.sanitizeRelevantFiles)(input.relevantFiles, 100);
    const safeExcerptPaths = input.fileExcerpts
        .map((entry) => entry.path)
        .filter((filePath) => !(0, masterContextSanitizer_1.isSensitivePath)(filePath));
    return new Set([...safeRelevantFiles, ...safeExcerptPaths]).size;
}
function deriveCandidateMasterKind(input) {
    const explicit = normalizeNullableText(input.explicitHint);
    if (explicit) {
        return explicit;
    }
    if (input.reviewCheckpointRisk
        || input.uncertaintySignals.includes('patch_risk')
        || input.uncertaintySignals.includes('review_checkpoint_risk')) {
        return 'review';
    }
    if (input.recentFailures > 0
        || input.failingTests > 0
        || input.failingCommands > 0
        || input.repeatedErrorSignatures.length > 0
        || input.uncertaintySignals.length > 0) {
        return 'debug';
    }
    return null;
}
function buildMasterHostObservation(input) {
    const raw = (input ?? {});
    const hostSignals = readHostSignals(raw.hostSignals);
    const toolResults = normalizeToolResults(raw.tools?.recentToolResults);
    const fileExcerpts = normalizeFileExcerpts(raw.workspace?.fileExcerpts);
    const errorSignatures = toolResults
        .filter((result) => result.exitCode !== null && result.exitCode !== 0)
        .map((result) => extractErrorSignature(result))
        .filter((entry) => Boolean(entry));
    let failingTests = 0;
    let failingCommands = 0;
    for (const result of toolResults) {
        if (result.exitCode === null || result.exitCode === 0) {
            continue;
        }
        const extractedTests = extractFailingTests(result);
        if (extractedTests.length > 0) {
            failingTests += extractedTests.length;
            continue;
        }
        failingCommands += 1;
    }
    const now = normalizeInteger(raw.now, Date.now());
    const lastMeaningfulDiffAt = normalizeNullableInteger(hostSignals.lastMeaningfulDiffAt);
    const uncertaintySignals = normalizeStringArray(hostSignals.uncertaintySignals);
    const reviewCheckpointRisk = normalizeBoolean(hostSignals.reviewCheckpointRisk);
    const recentFailures = toolResults.filter((result) => result.exitCode !== null && result.exitCode !== 0).length;
    const candidateMasterKindHint = deriveCandidateMasterKind({
        explicitHint: hostSignals.candidateMasterKindHint,
        reviewCheckpointRisk,
        recentFailures,
        failingTests,
        failingCommands,
        repeatedErrorSignatures: Array.from(new Set(errorSignatures)),
        uncertaintySignals,
    });
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
    };
}
