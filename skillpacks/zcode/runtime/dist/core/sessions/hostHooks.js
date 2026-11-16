"use strict";
/**
 * Host hook wiring for the session turn tier (local session adapters P4b).
 *
 * Writes the `metabot hook <event>` handler into a host's hook config (and
 * the `metabot mcp` server into its MCP config) so hook-tier hosts —
 * Gemini CLI, Cursor — deliver inbox mail as additionalContext at the next
 * tool call / turn end. The edited files are backed up next to themselves;
 * removal only drops OUR entries (identified by the ` hook <host> ` command
 * marker), never the host's own hooks.
 *
 * Verified against reason-network's setup.rs and the local installs:
 * - Cursor: `~/.cursor/mcp.json` (mcpServers map) + `~/.cursor/hooks.json`
 *   (version 1 + a hooks map keyed by camelCase events).
 * - Gemini CLI: `~/.gemini/settings.json` (mcpServers + hooks keyed by
 *   PascalCase events, each group {matcher:"*", hooks:[{type:"command",
 *   name, command, timeout}]}).
 * Copilot and Grok CLI are deferred until their hook schemas can be
 * verified (the reference's Copilot hook entries carry a suspicious "shell"
 * key, and no local install exists to check against).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HOOK_HOSTS = void 0;
exports.wireHostHooks = wireHostHooks;
const node_fs_1 = require("node:fs");
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
exports.HOOK_HOSTS = ['cursor', 'gemini'];
function defaultCommandFor(host, event) {
    const entry = process.argv[1] ? node_path_1.default.resolve(process.argv[1]) : 'metabot';
    return [
        JSON.stringify(process.execPath),
        JSON.stringify(entry),
        'hook',
        host,
        event,
    ].join(' ');
}
async function readJsonFile(file) {
    let raw = null;
    try {
        raw = await node_fs_1.promises.readFile(file, 'utf8');
    }
    catch {
        return { raw: null, parsed: {} };
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`${file} is not a JSON object; fix it before wiring session hooks.`);
    }
    return { raw, parsed };
}
async function writeJsonFile(file, value, raw) {
    let backedUpTo;
    if (raw !== null) {
        backedUpTo = `${file}.bak-sessions`;
        await node_fs_1.promises.writeFile(backedUpTo, raw, { mode: 0o600 });
    }
    await node_fs_1.promises.mkdir(node_path_1.default.dirname(file), { recursive: true });
    await node_fs_1.promises.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    return { file, action: raw === null ? 'created' : 'updated', backedUpTo };
}
function mcpServersMap(parsed) {
    const existing = parsed.mcpServers;
    return existing && typeof existing === 'object' && !Array.isArray(existing)
        ? { ...existing }
        : {};
}
/**
 * reason-network's merge discipline: drop only OUR groups (identified by
 * the ` hook <host> ` command marker), drop groups left empty, then append
 * ours per event.
 */
function mergeHookGroups(hooks, host, groups) {
    const marker = ` hook ${host} `;
    const ours = (value) => JSON.stringify(value).includes(marker);
    for (const [event, list] of Object.entries(hooks)) {
        if (!Array.isArray(list)) {
            continue;
        }
        const kept = list
            .map((group) => {
            if (group && typeof group === 'object' && Array.isArray(group.hooks)) {
                const inner = group.hooks
                    .filter((handler) => !ours(handler));
                if (inner.length) {
                    return { ...group, hooks: inner };
                }
                return null;
            }
            return ours(group) ? null : group;
        })
            .filter((group) => group !== null);
        if (kept.length) {
            hooks[event] = kept;
        }
        else {
            delete hooks[event];
        }
    }
    for (const [event, group] of groups) {
        const list = Array.isArray(hooks[event]) ? [...hooks[event]] : [];
        list.push(group);
        hooks[event] = list;
    }
}
function asObjectMap(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? { ...value }
        : {};
}
async function wireCursor(input, commandFor, mcpCommand) {
    const dir = input.cursorDir ?? node_path_1.default.join(node_os_1.default.homedir(), '.cursor');
    const files = [];
    const mcpPath = node_path_1.default.join(dir, 'mcp.json');
    const mcp = await readJsonFile(mcpPath);
    const servers = mcpServersMap(mcp.parsed);
    if (input.remove) {
        delete servers['metabot-sessions'];
    }
    else {
        servers['metabot-sessions'] = {
            type: 'stdio',
            command: mcpCommand.command,
            args: mcpCommand.args,
            env: { OAC_HOOK_AGENT: 'cursor' },
        };
    }
    mcp.parsed.mcpServers = servers;
    files.push(await writeJsonFile(mcpPath, mcp.parsed, mcp.raw));
    const hooksPath = node_path_1.default.join(dir, 'hooks.json');
    const hooksFile = await readJsonFile(hooksPath);
    const hooks = asObjectMap(hooksFile.parsed.hooks);
    if (input.remove) {
        mergeHookGroups(hooks, 'cursor', []);
        if (Object.keys(hooks).length) {
            hooksFile.parsed.hooks = hooks;
            files.push(await writeJsonFile(hooksPath, hooksFile.parsed, hooksFile.raw));
        }
        else {
            files.push({ file: hooksPath, action: 'removed' });
        }
    }
    else {
        const entry = (event) => ({ command: commandFor(event), timeout: 10 });
        const postToolUse = entry('post-tool-use');
        postToolUse.matcher = '*';
        mergeHookGroups(hooks, 'cursor', [
            ['sessionStart', entry('session-start')],
            ['beforeSubmitPrompt', entry('user-prompt-submit')],
            ['postToolUse', postToolUse],
            ['stop', entry('stop')],
            ['sessionEnd', entry('session-end')],
        ]);
        hooksFile.parsed.version = hooksFile.parsed.version ?? 1;
        hooksFile.parsed.hooks = hooks;
        files.push(await writeJsonFile(hooksPath, hooksFile.parsed, hooksFile.raw));
    }
    return { host: 'cursor', files };
}
async function wireGemini(input, commandFor, mcpCommand) {
    const dir = input.geminiDir ?? node_path_1.default.join(node_os_1.default.homedir(), '.gemini');
    const settingsPath = node_path_1.default.join(dir, 'settings.json');
    const settings = await readJsonFile(settingsPath);
    const files = [];
    const servers = mcpServersMap(settings.parsed);
    if (input.remove) {
        delete servers['metabot-sessions'];
    }
    else {
        servers['metabot-sessions'] = {
            command: mcpCommand.command,
            args: mcpCommand.args,
            env: { OAC_HOOK_AGENT: 'gemini' },
            timeout: 660000,
            trust: true,
        };
    }
    settings.parsed.mcpServers = servers;
    const hooks = asObjectMap(settings.parsed.hooks);
    if (input.remove) {
        mergeHookGroups(hooks, 'gemini', []);
    }
    else {
        const group = (event, timeout) => ({
            matcher: '*',
            hooks: [{
                    type: 'command',
                    name: `metabot-sessions-${event}`,
                    command: commandFor(event),
                    timeout,
                }],
        });
        mergeHookGroups(hooks, 'gemini', [
            ['SessionStart', group('session-start', 10000)],
            ['BeforeAgent', group('user-prompt-submit', 10000)],
            ['AfterTool', group('post-tool-use', 10000)],
            ['AfterAgent', group('stop', 10000)],
            ['SessionEnd', group('session-end', 5000)],
        ]);
    }
    settings.parsed.hooks = hooks;
    files.push(await writeJsonFile(settingsPath, settings.parsed, settings.raw));
    return { host: 'gemini', files };
}
async function wireHostHooks(input) {
    const host = input.host;
    const commandFor = input.commandFor
        ? (event) => input.commandFor(host, event)
        : (event) => defaultCommandFor(host, event);
    const mcpCommand = input.mcpCommand ?? {
        command: process.execPath,
        args: [process.argv[1] ? node_path_1.default.resolve(process.argv[1]) : 'metabot', 'mcp'],
    };
    if (host === 'cursor') {
        return wireCursor(input, commandFor, mcpCommand);
    }
    if (host === 'gemini') {
        return wireGemini(input, commandFor, mcpCommand);
    }
    throw new Error(`Unsupported host for session hook wiring: ${String(host)} (supported: ${exports.HOOK_HOSTS.join(', ')})`);
}
