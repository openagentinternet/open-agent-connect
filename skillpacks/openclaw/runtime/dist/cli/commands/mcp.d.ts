import { type MetabotCommandResult } from '../../core/contracts/commandResult';
import type { CliRuntimeContext } from '../types';
/**
 * `metabot mcp` — the local session MCP server (local session adapters
 * P2a). Speaks JSON-RPC 2.0 over stdio (the MCP stdio transport) so an MCP
 * host (ZCode, Claude Desktop, any MCP client) can list this machine's
 * sessions, long-poll its session inbox, and read delivery receipts. The
 * tool handlers are the same daemon-backed dependency proxies the CLI uses
 * (they auto-start the daemon). Session identity: `--name <name>` registers
 * a named session; otherwise the process registers env-detected (or as a
 * generic MCP client keyed by pid).
 *
 * This command takes over stdout for the protocol — the returned result is
 * marked `__rawStdoutHandled` so the CLI's JSON-line printer stays silent.
 */
export declare function runMcpCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>>;
