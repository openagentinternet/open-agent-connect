"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectProcessLogFileChain = selectProcessLogFileChain;
exports.redactLoomProcessLog = redactLoomProcessLog;
exports.renderLoomProcessLog = renderLoomProcessLog;
exports.writeLoomProcessLogFile = writeLoomProcessLogFile;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const SUPPORTED_PROCESS_LOG_FILE_CHAINS = new Set(['mvc', 'btc', 'opcat']);
const DEFAULT_MAX_LOG_BYTES = 100 * 1024;
const TRUNCATION_NOTE = '\n\n> Process log truncated to fit the Loom process log size limit.\n';
const SECRET_KEY_RE = String.raw `(?:[A-Z0-9_]+_API_KEY|[A-Z0-9_]+_TOKEN|api_key|api-key|access_token|access-token|token|API_KEY|TOKEN)`;
function isSupportedProcessLogFileChain(value) {
    return SUPPORTED_PROCESS_LOG_FILE_CHAINS.has(value);
}
function selectProcessLogFileChain(recordChain, fileChain) {
    if (fileChain !== undefined) {
        if (isSupportedProcessLogFileChain(fileChain)) {
            return fileChain;
        }
        throw new Error(`Unsupported Loom process log file chain: ${fileChain}`);
    }
    if (isSupportedProcessLogFileChain(recordChain)) {
        return recordChain;
    }
    if (recordChain === 'doge') {
        return 'mvc';
    }
    throw new Error(`Unsupported Loom record chain for process logs: ${recordChain}`);
}
function redactLoomProcessLog(input) {
    let output = String(input ?? '');
    if (/PRIVATE KEY/.test(output)) {
        output = output.replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]');
    }
    if (/\b(?:mnemonic|seed phrase|seed words|seed_words|recovery phrase|secret phrase|seed)\b/i.test(output)) {
        output = output.replace(/\b(["']?(?:mnemonic|seed phrase|seed words|seed_words|recovery phrase|secret phrase|seed)["']?\s*(?::|=)\s*)(?:"[^"]*"|'[^']*'|[^\n\r,}]+)/gi, '$1[REDACTED MNEMONIC]');
    }
    if (/Authorization/i.test(output)) {
        output = output.replace(/(Authorization:\s*(?:Bearer|token)\s+)[^\s"'`]+/gi, '$1[REDACTED]');
        output = output.replace(/(["']?Authorization["']?\s*:\s*["']?(?:Bearer|token)\s+)[^"',}\s]+/gi, '$1[REDACTED]');
    }
    if (/https?:\/\/[^/\s@]+@/i.test(output)) {
        output = output.replace(/\b(https?:\/\/)([^@\s/]+)@/gi, '$1[REDACTED]@');
    }
    if (/--(?:token|api-key|api_key|access-token|access_token)/i.test(output)) {
        output = output.replace(/(^|\s)(--(?:token|api-key|api_key|access-token|access_token))(?:=|\s+)(?:"[^"]*"|'[^']*'|[^\s"'`]+)/gi, '$1$2 [REDACTED]');
    }
    if (/(?:api[-_]?key|access[-_]?token|token)/i.test(output)) {
        output = output.replace(new RegExp(`\\b(${SECRET_KEY_RE}=)(?:"[^"]*"|'[^']*'|[^&/@\\s"'\\x60,}]+)`, 'gi'), '$1[REDACTED]');
        output = output.replace(new RegExp(`\\b(${SECRET_KEY_RE}:\\s*)(?:"[^"]*"|'[^']*'|[^&/@\\s"'\\x60,}]+)`, 'gi'), '$1[REDACTED]');
        output = output.replace(new RegExp(`(["']?${SECRET_KEY_RE}["']?\\s*:\\s*)(["'])([^"']*)\\2`, 'gi'), '$1$2[REDACTED]$2');
    }
    return output;
}
function pushSection(lines, title, values) {
    const present = values.filter((value) => value.trim().length > 0);
    if (present.length === 0) {
        return;
    }
    lines.push('', `## ${title}`, ...present);
}
function safeStringify(value) {
    const seen = new WeakSet();
    const json = JSON.stringify(value, (_key, nestedValue) => {
        if (typeof nestedValue === 'bigint') {
            return nestedValue.toString();
        }
        if (typeof nestedValue === 'object' && nestedValue !== null) {
            if (seen.has(nestedValue)) {
                return '[Circular]';
            }
            seen.add(nestedValue);
        }
        return nestedValue;
    }, 2);
    return json ?? String(value);
}
function formatJson(value) {
    return ['```json', safeStringify(value), '```'].join('\n');
}
function renderValue(value) {
    return redactLoomProcessLog(String(value));
}
function renderDiagnostic(value) {
    if (value instanceof Error) {
        return redactLoomProcessLog(value.message);
    }
    if (typeof value === 'object' && value !== null) {
        return redactLoomProcessLog(formatJson(value));
    }
    return renderValue(value);
}
function byteSafePrefix(input, maxBytes) {
    let output = '';
    for (const character of input) {
        const next = `${output}${character}`;
        if (Buffer.byteLength(next, 'utf8') > maxBytes) {
            break;
        }
        output = next;
    }
    return output;
}
function truncateToMaxBytes(content, maxBytes) {
    if (maxBytes <= 0) {
        return '';
    }
    const contentBytes = Buffer.byteLength(content, 'utf8');
    if (contentBytes <= maxBytes) {
        return content;
    }
    const noteBytes = Buffer.byteLength(TRUNCATION_NOTE, 'utf8');
    if (noteBytes > maxBytes) {
        return byteSafePrefix('[truncated]', maxBytes);
    }
    const keepBytes = maxBytes - noteBytes;
    return `${byteSafePrefix(content, keepBytes)}${TRUNCATION_NOTE}`;
}
function assertSafeProcessLogFileName(fileName) {
    if (fileName.length === 0
        || (0, node_path_1.isAbsolute)(fileName)
        || fileName.includes('/')
        || fileName.includes('\\')
        || fileName === '..') {
        throw new Error(`Unsafe Loom process log file name: ${fileName}`);
    }
}
function renderLoomProcessLog(input) {
    const maxBytes = input.maxBytes ?? DEFAULT_MAX_LOG_BYTES;
    const lines = ['# Loom Process Log'];
    pushSection(lines, 'Task And Claim', [
        input.taskPinId ? `- Task: ${renderValue(input.taskPinId)}` : '',
        input.claimPinId ? `- Claim: ${renderValue(input.claimPinId)}` : '',
    ]);
    pushSection(lines, 'Actor', [
        input.actor?.slug ? `- Slug: ${renderValue(input.actor.slug)}` : '',
        input.actor?.globalMetaId ? `- Global MetaID: ${renderValue(input.actor.globalMetaId)}` : '',
    ]);
    pushSection(lines, 'Repo And Branch', [
        input.repo?.uri ? `- Repo: ${renderValue(input.repo.uri)}` : '',
        input.repo?.branch ? `- Branch: ${renderValue(input.repo.branch)}` : '',
        input.repo?.workspacePath ? `- Workspace: ${renderValue(input.repo.workspacePath)}` : '',
    ]);
    pushSection(lines, 'Round Note', [
        input.roundNote ? redactLoomProcessLog(input.roundNote) : '',
    ]);
    pushSection(lines, 'LLM', [
        input.llm?.model ? `- Model: ${renderValue(input.llm.model)}` : '',
        input.llm?.sessionId ? `- Session: ${renderValue(input.llm.sessionId)}` : '',
    ]);
    pushSection(lines, 'Checks', (input.checks ?? []).map((check) => {
        const details = [
            check.exitCode === undefined ? '' : `exit=${check.exitCode}`,
            check.durationMs === undefined ? '' : `durationMs=${check.durationMs}`,
        ].filter(Boolean).join(', ');
        const detailText = details ? ` (${details})` : '';
        const streams = [
            check.stdoutSummary ? `stdout: ${redactLoomProcessLog(check.stdoutSummary)}` : '',
            check.stderrSummary ? `stderr: ${redactLoomProcessLog(check.stderrSummary)}` : '',
        ].filter(Boolean).join('; ');
        const streamText = streams ? ` - ${streams}` : '';
        const summary = check.summary && !streams ? ` - ${redactLoomProcessLog(check.summary)}` : '';
        return `- ${renderValue(check.status)}: ${redactLoomProcessLog(check.command)}${detailText}${streamText}${summary}`;
    }));
    pushSection(lines, 'Git Changes', (input.git?.changes ?? []).map((change) => `- ${renderValue(change)}`));
    pushSection(lines, 'Commits', (input.git?.commits ?? []).map((commit) => `- ${renderValue(commit.sha)} ${redactLoomProcessLog(commit.message)}`));
    pushSection(lines, 'Status Decision', [
        input.statusDecision?.status ? `- Status: ${renderValue(input.statusDecision.status)}` : '',
        input.statusDecision?.summary
            ? `- Summary: ${redactLoomProcessLog(input.statusDecision.summary)}`
            : '',
    ]);
    pushSection(lines, 'Payload Preview', [
        input.payloadPreview === undefined ? '' : redactLoomProcessLog(formatJson(input.payloadPreview)),
    ]);
    pushSection(lines, 'Chain Result', [
        input.chainResult === undefined ? '' : redactLoomProcessLog(formatJson(input.chainResult)),
    ]);
    pushSection(lines, 'Errors', (input.errors ?? []).map((error) => `- ${renderDiagnostic(error)}`));
    pushSection(lines, 'Raw Log', [
        input.rawLog === undefined ? '' : redactLoomProcessLog(input.rawLog),
    ]);
    return truncateToMaxBytes(lines.join('\n'), maxBytes);
}
async function writeLoomProcessLogFile(input) {
    assertSafeProcessLogFileName(input.fileName);
    const path = (0, node_path_1.join)(input.directory, input.fileName);
    await (0, promises_1.mkdir)(input.directory, { recursive: true });
    let content = renderLoomProcessLog(input);
    if (!content.endsWith('\n')) {
        const withNewline = `${content}\n`;
        if (input.maxBytes === undefined
            || (input.maxBytes > 0 && Buffer.byteLength(withNewline, 'utf8') <= input.maxBytes)) {
            content = withNewline;
        }
    }
    await (0, promises_1.writeFile)(path, content, 'utf8');
    return { path, content };
}
