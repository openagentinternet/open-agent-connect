"use strict";
/**
 * Host MCP wiring for the local session server (local session adapters
 * P2b). Writes the `metabot-sessions` MCP server entry into a host's MCP
 * configuration so its sessions can pull their inbox (`metabot mcp`).
 *
 * First host: ZCode (`~/.zcode/cli/config.json`, falling back to
 * `~/.agents/mcp.json` while ZCode reads that file instead). The edited
 * file is backed up next to itself before the first write of a wire run;
 * `--remove` drops the entry. Unknown JSON is preserved: only the
 * `mcpServers` map is touched.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SESSIONS_MCP_SERVER_NAME = void 0;
exports.wireSessionsMcp = wireSessionsMcp;
const node_fs_1 = require("node:fs");
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
exports.SESSIONS_MCP_SERVER_NAME = 'metabot-sessions';
function resolveMcpCommand() {
    // The running CLI is the server: node <metabot-entry> mcp. argv[1] is the
    // JS entry (dist/cli/main.js or its installed bin link); resolve through
    // realpath so a symlinked install still points at a stable path.
    const entry = process.argv[1] ? node_path_1.default.resolve(process.argv[1]) : 'metabot';
    return { command: process.execPath, args: [entry, 'mcp'] };
}
function candidateConfigFiles(input) {
    const files = [];
    if (input.host === 'kimi') {
        // Kimi Code reads the same {"mcpServers": …} stdio map from
        // ~/.kimi-code/mcp.json (verified against a live 2.0.2 install).
        const kimiBase = input.kimiDir ?? node_path_1.default.join(node_os_1.default.homedir(), '.kimi-code');
        files.push(node_path_1.default.join(kimiBase, 'mcp.json'));
        return files;
    }
    const zcodeBase = input.zcodeDir ?? node_path_1.default.join(node_os_1.default.homedir(), '.zcode');
    files.push(node_path_1.default.join(zcodeBase, 'cli', 'config.json'));
    const agentsBase = input.agentsDir ?? node_path_1.default.join(node_os_1.default.homedir(), '.agents');
    files.push(node_path_1.default.join(agentsBase, 'mcp.json'));
    return files;
}
async function wireSessionsMcp(input) {
    if (input.host !== 'zcode' && input.host !== 'kimi') {
        throw new Error(`Unsupported host for sessions MCP wiring: ${input.host} (supported: zcode, kimi)`);
    }
    const mcpCommand = input.mcpCommand ?? resolveMcpCommand();
    // Prefer the first candidate whose file exists (the ZCode config, else
    // the agents fallback); when none exists, create the first candidate.
    let configFile = candidateConfigFiles(input)[0];
    let raw = null;
    for (const candidate of candidateConfigFiles(input)) {
        try {
            raw = await node_fs_1.promises.readFile(candidate, 'utf8');
            configFile = candidate;
            break;
        }
        catch {
            continue;
        }
    }
    let parsed = {};
    if (raw !== null) {
        try {
            const value = JSON.parse(raw);
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                parsed = value;
            }
        }
        catch {
            throw new Error(`${configFile} is not valid JSON; fix it before wiring the sessions MCP server.`);
        }
    }
    const mcpServers = parsed.mcpServers && typeof parsed.mcpServers === 'object' && !Array.isArray(parsed.mcpServers)
        ? { ...parsed.mcpServers }
        : {};
    let wired;
    if (input.remove) {
        wired = !(exports.SESSIONS_MCP_SERVER_NAME in mcpServers);
        delete mcpServers[exports.SESSIONS_MCP_SERVER_NAME];
    }
    else {
        mcpServers[exports.SESSIONS_MCP_SERVER_NAME] = { command: mcpCommand.command, args: mcpCommand.args };
        wired = true;
    }
    parsed.mcpServers = mcpServers;
    let backedUpTo;
    if (raw !== null) {
        backedUpTo = `${configFile}.bak-sessions`;
        await node_fs_1.promises.writeFile(backedUpTo, raw, { mode: 0o600 });
    }
    await node_fs_1.promises.mkdir(node_path_1.default.dirname(configFile), { recursive: true });
    await node_fs_1.promises.writeFile(configFile, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
    return { host: input.host, configFile, wired, backedUpTo };
}
