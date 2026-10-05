"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CURSOR_STATIC_MODELS = exports.CODEX_STATIC_MODELS = exports.CLAUDE_STATIC_MODELS = void 0;
exports.discoverModelCatalog = discoverModelCatalog;
const node_child_process_1 = require("node:child_process");
const llmRuntimeDiscovery_1 = require("./llmRuntimeDiscovery");
const CLAUDE_LIST_MODELS_TIMEOUT_MS = 20_000;
const CODEX_DEBUG_MODELS_TIMEOUT_MS = 15_000;
const CURSOR_LIST_MODELS_TIMEOUT_MS = 15_000;
const MIN_CODEX_DEBUG_MODELS_VERSION = '0.122.0';
const CLAUDE_LIST_MODELS_REQUEST_ID = 'oac-list-models';
const PROBE_KILL_GRACE_MS = 2_000;
const CLAUDE_LIST_MODELS_ARGS = [
    '--print',
    '--verbose',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    // Without any --mcp-config this resolves to "no MCP servers at all":
    // discovery must not boot the user's servers to enumerate a model list.
    '--strict-mcp-config',
];
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
/**
 * Runs a one-shot probe process. When `stdinLine` is given it is written once
 * and stdin is closed immediately (EOF-as-end-of-session, the same one-shot
 * contract multica uses for claude list_models); `keepStdinOpen` keeps the
 * stream open for CLIs that exit only on EOF after answering.
 */
function runProbeProcess(input) {
    return new Promise((resolve) => {
        const child = (0, node_child_process_1.spawn)(input.binaryPath, input.args, {
            env: input.env ?? process.env,
            shell: false,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderrTail = '';
        let settled = false;
        let timedOut = false;
        let killTimer;
        const finish = (output) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            if (killTimer)
                clearTimeout(killTimer);
            resolve(output);
        };
        const timer = setTimeout(() => {
            timedOut = true;
            try {
                child.kill('SIGTERM');
            }
            catch { /* best effort */ }
            killTimer = setTimeout(() => {
                try {
                    child.kill('SIGKILL');
                }
                catch { /* best effort */ }
                child.stdout?.destroy();
                child.stderr?.destroy();
                finish({ ok: false, stdout, stderrTail, error: `probe timed out after ${input.timeoutMs}ms` });
            }, PROBE_KILL_GRACE_MS);
        }, input.timeoutMs);
        child.stdin.on('error', () => undefined);
        if (input.stdinLine !== undefined) {
            child.stdin.write(`${input.stdinLine}\n`);
            child.stdin.end();
        }
        else {
            child.stdin.end();
        }
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk) => {
            stderrTail += chunk;
            if (stderrTail.length > 4096)
                stderrTail = stderrTail.slice(-4096);
        });
        child.on('error', (error) => finish({ ok: false, stdout, stderrTail, error: error.message }));
        child.on('close', (code) => {
            if (timedOut)
                return;
            finish({ ok: code === 0, stdout, stderrTail, error: code === 0 ? undefined : `exited with code ${code ?? 'unknown'}` });
        });
    });
}
function parseClaudeListModels(stdout) {
    for (const rawLine of stdout.split('\n')) {
        const line = rawLine.trim();
        if (!line)
            continue;
        let message;
        try {
            message = JSON.parse(line);
        }
        catch {
            continue;
        }
        if (message.type !== 'control_response' || !isRecord(message.response))
            continue;
        const response = message.response;
        if (response.request_id !== CLAUDE_LIST_MODELS_REQUEST_ID)
            continue;
        if (response.subtype !== 'success') {
            // Old CLIs answer "Unsupported control request subtype: list_models".
            return { models: [], error: String(response.error ?? 'list_models control request failed') };
        }
        const payload = isRecord(response.response) ? response.response : {};
        const rows = Array.isArray(payload.models) ? payload.models : [];
        const models = [];
        for (const row of rows) {
            if (!isRecord(row))
                continue;
            const info = row;
            if (typeof info.value !== 'string' || !info.value || info.value === 'default')
                continue;
            const id = typeof info.resolvedModel === 'string' && info.resolvedModel ? info.resolvedModel : info.value;
            models.push({
                id,
                label: typeof info.displayName === 'string' && info.displayName ? info.displayName : id,
                ...(info.disabled === true ? { disabled: true } : {}),
            });
        }
        if (!models.length)
            return { models: [], error: 'list_models returned no usable models' };
        return { models };
    }
    return { models: [], error: 'no control_response for the list_models request' };
}
function parseCodexDebugModels(stdout) {
    let parsed;
    try {
        parsed = JSON.parse(stdout);
    }
    catch {
        return [];
    }
    const rows = isRecord(parsed) && Array.isArray(parsed.models) ? parsed.models : [];
    const models = [];
    for (const row of rows) {
        if (!isRecord(row))
            continue;
        const info = row;
        if (typeof info.slug !== 'string' || !info.slug || info.visibility === 'hide')
            continue;
        models.push({
            id: info.slug,
            label: typeof info.display_name === 'string' && info.display_name ? info.display_name : info.slug,
        });
    }
    // The first visible entry is the catalog's preferred default (codex's own
    // picker ordering).
    if (models.length)
        models[0].default = true;
    return models;
}
const CURSOR_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
function parseCursorListModels(stdout) {
    const models = [];
    const seen = new Set();
    for (const rawLine of stdout.split('\n')) {
        const line = rawLine.trim();
        if (!line)
            continue;
        const separator = line.indexOf(' - ');
        if (separator <= 0)
            continue;
        const id = line.slice(0, separator).trim();
        let label = line.slice(separator + 3).trim();
        if (!CURSOR_ID_PATTERN.test(id) || seen.has(id))
            continue;
        seen.add(id);
        const isDefault = label.includes('default');
        const paren = label.indexOf('(');
        if (paren > 0)
            label = label.slice(0, paren).trim();
        if (!label)
            label = id;
        models.push({ id, label, ...(isDefault ? { default: true } : {}) });
    }
    return models;
}
/** Static fallback, ported from multica's claudeStaticModels (2026-10). */
exports.CLAUDE_STATIC_MODELS = [
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', default: true },
    { id: 'claude-fable-5-1', label: 'Claude Fable 5.1' },
    { id: 'claude-fable-5', label: 'Claude Fable 5' },
    { id: 'claude-opus-5', label: 'Claude Opus 5' },
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
    { id: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
];
/** Static fallback, ported from multica's codexStaticModels (2026-10). */
exports.CODEX_STATIC_MODELS = [
    { id: 'gpt-6-astra', label: 'GPT-6 Astra', default: true },
    { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
    { id: 'gpt-6-sol', label: 'GPT-6 Sol' },
    { id: 'gpt-6-luna', label: 'GPT-6 Luna' },
    { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
    { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
    { id: 'gpt-5.5', label: 'GPT-5.5' },
    { id: 'gpt-5.4', label: 'GPT-5.4' },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4-Mini' },
    { id: 'gpt-5.3-codex', label: 'GPT-5.3-Codex' },
    { id: 'gpt-5.2', label: 'GPT-5.2' },
];
/** Minimal static fallback: cursor model ids shift too fast to bake (multica). */
exports.CURSOR_STATIC_MODELS = [
    { id: 'auto', label: 'Auto', default: true },
];
async function discoverClaudeModelCatalog(input) {
    const request = JSON.stringify({
        type: 'control_request',
        request_id: CLAUDE_LIST_MODELS_REQUEST_ID,
        request: { subtype: 'list_models' },
    });
    const probe = await runProbeProcess({
        binaryPath: input.binaryPath,
        args: CLAUDE_LIST_MODELS_ARGS,
        env: input.env,
        timeoutMs: input.timeoutMs ?? CLAUDE_LIST_MODELS_TIMEOUT_MS,
        stdinLine: request,
    });
    if (probe.ok) {
        const parsed = parseClaudeListModels(probe.stdout);
        if (parsed.models.length) {
            return { provider: 'claude-code', source: 'live', models: parsed.models };
        }
        return { provider: 'claude-code', source: 'static', models: exports.CLAUDE_STATIC_MODELS, reason: parsed.error ?? probe.error };
    }
    return {
        provider: 'claude-code',
        source: 'static',
        models: exports.CLAUDE_STATIC_MODELS,
        reason: probe.error ?? (probe.stderrTail.trim() || 'list_models probe failed'),
    };
}
async function discoverCodexModelCatalog(input) {
    if (input.version && !(0, llmRuntimeDiscovery_1.cliVersionAtLeast)(input.version, MIN_CODEX_DEBUG_MODELS_VERSION)) {
        return {
            provider: 'codex',
            source: 'static',
            models: exports.CODEX_STATIC_MODELS,
            reason: `codex ${input.version} predates \`debug models\` (${MIN_CODEX_DEBUG_MODELS_VERSION})`,
        };
    }
    const timeoutMs = input.timeoutMs ?? CODEX_DEBUG_MODELS_TIMEOUT_MS;
    const live = await runProbeProcess({ binaryPath: input.binaryPath, args: ['debug', 'models'], env: input.env, timeoutMs });
    const liveModels = live.ok ? parseCodexDebugModels(live.stdout) : [];
    if (liveModels.length) {
        return { provider: 'codex', source: 'live', models: liveModels };
    }
    const bundled = await runProbeProcess({ binaryPath: input.binaryPath, args: ['debug', 'models', '--bundled'], env: input.env, timeoutMs });
    const bundledModels = bundled.ok ? parseCodexDebugModels(bundled.stdout) : [];
    if (bundledModels.length) {
        return { provider: 'codex', source: 'bundled', models: bundledModels, reason: live.error ?? 'live catalog unavailable' };
    }
    return {
        provider: 'codex',
        source: 'static',
        models: exports.CODEX_STATIC_MODELS,
        reason: bundled.error ?? 'debug models returned no usable catalog',
    };
}
async function discoverCursorModelCatalog(input) {
    const probe = await runProbeProcess({
        binaryPath: input.binaryPath,
        args: ['--list-models'],
        env: input.env,
        timeoutMs: input.timeoutMs ?? CURSOR_LIST_MODELS_TIMEOUT_MS,
    });
    // cursor-agent exits non-zero with the row data still on stdout when the
    // account is restricted; parse whatever it printed before degrading.
    const models = parseCursorListModels(probe.stdout);
    if (models.length) {
        return { provider: 'cursor', source: 'live', models };
    }
    return {
        provider: 'cursor',
        source: 'static',
        models: exports.CURSOR_STATIC_MODELS,
        reason: probe.error ?? (probe.stderrTail.trim() || 'list-models probe failed'),
    };
}
/**
 * Discovers the model catalog for a provider. Never throws: every failure
 * path degrades to the flagged static fallback so callers can render a
 * usable picker offline.
 */
async function discoverModelCatalog(input) {
    switch (input.provider) {
        case 'claude-code':
            return discoverClaudeModelCatalog(input);
        case 'codex':
            return discoverCodexModelCatalog(input);
        case 'cursor':
            return discoverCursorModelCatalog(input);
    }
}
