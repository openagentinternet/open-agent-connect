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

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SESSIONS_MCP_SERVER_NAME = 'metabot-sessions';

export interface SessionsMcpCommand {
  command: string;
  args: string[];
}

export interface WireSessionsMcpInput {
  /** Which host's MCP config to edit. P2b: `zcode`. */
  host: string;
  /** Injected command/args (defaults to the running metabot binary). */
  mcpCommand?: SessionsMcpCommand;
  /** Overrides `~/.zcode` / `~/.agents` (tests). */
  zcodeDir?: string;
  agentsDir?: string;
  remove?: boolean;
}

export interface WireSessionsMcpResult {
  host: string;
  configFile: string;
  wired: boolean;
  backedUpTo?: string;
}

function resolveMcpCommand(): SessionsMcpCommand {
  // The running CLI is the server: node <metabot-entry> mcp. argv[1] is the
  // JS entry (dist/cli/main.js or its installed bin link); resolve through
  // realpath so a symlinked install still points at a stable path.
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : 'metabot';
  return { command: process.execPath, args: [entry, 'mcp'] };
}

function candidateConfigFiles(input: WireSessionsMcpInput): string[] {
  const files: string[] = [];
  const zcodeBase = input.zcodeDir ?? path.join(os.homedir(), '.zcode');
  files.push(path.join(zcodeBase, 'cli', 'config.json'));
  const agentsBase = input.agentsDir ?? path.join(os.homedir(), '.agents');
  files.push(path.join(agentsBase, 'mcp.json'));
  return files;
}

export async function wireSessionsMcp(input: WireSessionsMcpInput): Promise<WireSessionsMcpResult> {
  if (input.host !== 'zcode') {
    throw new Error(`Unsupported host for sessions MCP wiring: ${input.host} (supported: zcode)`);
  }
  const mcpCommand = input.mcpCommand ?? resolveMcpCommand();

  // Prefer the first candidate whose file exists (the ZCode config, else
  // the agents fallback); when none exists, create the first candidate.
  let configFile: string = candidateConfigFiles(input)[0];
  let raw: string | null = null;
  for (const candidate of candidateConfigFiles(input)) {
    try {
      raw = await fs.readFile(candidate, 'utf8');
      configFile = candidate;
      break;
    } catch {
      continue;
    }
  }

  let parsed: Record<string, unknown> = {};
  if (raw !== null) {
    try {
      const value = JSON.parse(raw);
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        parsed = value as Record<string, unknown>;
      }
    } catch {
      throw new Error(`${configFile} is not valid JSON; fix it before wiring the sessions MCP server.`);
    }
  }

  const mcpServers = parsed.mcpServers && typeof parsed.mcpServers === 'object' && !Array.isArray(parsed.mcpServers)
    ? { ...(parsed.mcpServers as Record<string, unknown>) }
    : {};

  let wired: boolean;
  if (input.remove) {
    wired = !(SESSIONS_MCP_SERVER_NAME in mcpServers);
    delete mcpServers[SESSIONS_MCP_SERVER_NAME];
  } else {
    mcpServers[SESSIONS_MCP_SERVER_NAME] = { command: mcpCommand.command, args: mcpCommand.args };
    wired = true;
  }
  parsed.mcpServers = mcpServers;

  let backedUpTo: string | undefined;
  if (raw !== null) {
    backedUpTo = `${configFile}.bak-sessions`;
    await fs.writeFile(backedUpTo, raw, { mode: 0o600 });
  }
  await fs.mkdir(path.dirname(configFile), { recursive: true });
  await fs.writeFile(configFile, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
  return { host: input.host, configFile, wired, backedUpTo };
}
