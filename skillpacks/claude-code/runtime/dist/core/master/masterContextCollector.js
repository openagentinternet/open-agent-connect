"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectMasterContext = collectMasterContext;
const masterContextSanitizer_1 = require("./masterContextSanitizer");
function normalizeText(value) {
    return typeof value === 'string'
        ? value.replace(/\s+/g, ' ').trim()
        : '';
}
function normalizeMultilineText(value) {
    return typeof value === 'string'
        ? value.trim()
        : '';
}
function normalizeNullableText(value) {
    const normalized = normalizeText(value);
    return normalized || null;
}
function normalizeStringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const seen = new Set();
    const normalized = [];
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
        const content = normalizeText(record.content);
        if (!filePath || !content) {
            continue;
        }
        excerpts.push({
            path: filePath,
            content,
        });
    }
    return excerpts;
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
            stdout: normalizeMultilineText(record.stdout),
            stderr: normalizeMultilineText(record.stderr),
        });
    }
    return results;
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
                const name = normalizeText(match[1]);
                if (!name || seen.has(name)) {
                    continue;
                }
                seen.add(name);
                tests.push(name);
            }
        }
    }
    return tests;
}
function extractErrorSignature(result) {
    const candidates = [result.stderr, result.stdout];
    for (const source of candidates) {
        if (!source) {
            continue;
        }
        for (const rawLine of source.split(/\r?\n/)) {
            const line = normalizeText(rawLine);
            if (!line) {
                continue;
            }
            if (/^(AssertionError|TypeError|ReferenceError|SyntaxError|Error):/i.test(line)) {
                return line;
            }
        }
        const firstLine = normalizeText(source.split(/\r?\n/, 1)[0]);
        if (firstLine) {
            return firstLine;
        }
    }
    return null;
}
function extractStderrHighlights(result) {
    const highlights = [];
    if (!result.stderr) {
        return highlights;
    }
    for (const rawLine of result.stderr.split(/\r?\n/)) {
        const line = normalizeText(rawLine);
        if (!line) {
            continue;
        }
        highlights.push(line);
        if (highlights.length >= 2) {
            break;
        }
    }
    return highlights;
}
function createArtifact(label, content, source, filePath = null) {
    const normalizedLabel = normalizeText(label);
    const normalizedContent = normalizeText(content);
    if (!normalizedLabel || !normalizedContent) {
        return null;
    }
    return {
        kind: 'text',
        label: normalizedLabel,
        content: normalizedContent,
        source,
        path: normalizeNullableText(filePath),
    };
}
function collectArtifacts(input) {
    const artifacts = [];
    const seen = new Set();
    const pushArtifact = (artifact) => {
        if (!artifact) {
            return;
        }
        const key = `${artifact.source}:${artifact.label}:${artifact.path ?? ''}:${artifact.content}`;
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        artifacts.push(artifact);
    };
    pushArtifact(createArtifact('current_request', input.currentUserRequest ?? '', 'chat'));
    for (const result of input.toolResults) {
        if (result.exitCode === null || result.exitCode === 0) {
            continue;
        }
        const failingTests = extractFailingTests(result);
        if (failingTests.length > 0) {
            pushArtifact(createArtifact('test_failure', `${failingTests[0]}\n${result.stderr || result.stdout}`, 'test'));
        }
        else if (result.stdout) {
            pushArtifact(createArtifact(`${result.toolName}:stdout`, result.stdout, 'terminal'));
        }
        if (result.stderr) {
            pushArtifact(createArtifact(`${result.toolName}:stderr`, result.stderr, 'terminal'));
        }
    }
    pushArtifact(createArtifact('diff_summary', input.diffSummary ?? '', 'diff'));
    for (const excerpt of input.fileExcerpts) {
        pushArtifact(createArtifact(`excerpt:${excerpt.path}`, excerpt.content, 'file_excerpt', excerpt.path));
    }
    return artifacts;
}
function composeWorkspaceSummary(input) {
    const parts = [];
    if (input.goal) {
        parts.push(input.goal);
    }
    if (input.todoBlocked) {
        parts.push('Current work is blocked.');
    }
    if (input.onlyReadingWithoutConverging) {
        parts.push('Recent activity is mostly reading or searching without converging.');
    }
    const safeRelevantFiles = (0, masterContextSanitizer_1.sanitizeRelevantFiles)(input.relevantFiles, 3);
    if (safeRelevantFiles.length > 0) {
        parts.push(`Relevant files: ${safeRelevantFiles.join(', ')}.`);
    }
    return parts.length > 0 ? parts.join(' ') : null;
}
function collectMasterContext(input) {
    const raw = (input ?? {});
    const currentUserRequest = normalizeNullableText(raw.conversation?.currentUserRequest);
    const recentMessages = Array.isArray(raw.conversation?.recentMessages)
        ? raw.conversation.recentMessages
            .filter((entry) => entry && typeof entry === 'object')
            .map((entry) => ({
            role: entry.role === 'assistant' ? 'assistant' : 'user',
            content: normalizeText(entry.content),
        }))
            .filter((entry) => entry.content)
        : [];
    const toolResults = normalizeToolResults(raw.tools?.recentToolResults);
    const relevantFiles = normalizeStringArray(raw.workspace?.relevantFiles);
    const fileExcerpts = normalizeFileExcerpts(raw.workspace?.fileExcerpts);
    const mergedRelevantFiles = normalizeStringArray([
        ...relevantFiles,
        ...fileExcerpts.map((excerpt) => excerpt.path),
    ]);
    const goal = normalizeNullableText(raw.workspace?.goal);
    const constraints = normalizeStringArray(raw.workspace?.constraints);
    const diffSummary = normalizeNullableText(raw.workspace?.diffSummary);
    const failingTests = toolResults.flatMap(extractFailingTests);
    const failingCommands = toolResults
        .filter((result) => result.exitCode !== null && result.exitCode !== 0)
        .map((result) => result.toolName);
    const repeatedErrorSignatures = normalizeStringArray(toolResults.map(extractErrorSignature));
    const stderrHighlights = normalizeStringArray(toolResults.flatMap(extractStderrHighlights));
    const errorSummary = repeatedErrorSignatures[0]
        ?? stderrHighlights[0]
        ?? (failingTests[0] ? `Failing test: ${failingTests[0]}` : null);
    const fallbackUserMessage = recentMessages.find((message) => message.role === 'user')?.content ?? null;
    const taskSummary = currentUserRequest || goal || fallbackUserMessage || null;
    const questionCandidate = currentUserRequest || fallbackUserMessage || null;
    const workspaceSummary = composeWorkspaceSummary({
        goal,
        relevantFiles: mergedRelevantFiles,
        todoBlocked: raw.planner?.todoBlocked === true,
        onlyReadingWithoutConverging: raw.planner?.onlyReadingWithoutConverging === true,
    });
    return {
        hostMode: normalizeText(raw.hostMode) || 'unknown',
        taskSummary,
        questionCandidate,
        workspaceSummary,
        diagnostics: {
            failingTests: normalizeStringArray(failingTests),
            failingCommands: normalizeStringArray(failingCommands),
            repeatedErrorSignatures,
            stderrHighlights,
        },
        workState: {
            goal,
            constraints,
            errorSummary,
            diffSummary,
            relevantFiles: mergedRelevantFiles,
        },
        artifacts: collectArtifacts({
            currentUserRequest,
            toolResults,
            diffSummary,
            fileExcerpts,
        }),
    };
}
