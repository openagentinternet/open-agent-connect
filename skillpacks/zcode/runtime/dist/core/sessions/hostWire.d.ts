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
export declare const SESSIONS_MCP_SERVER_NAME = "metabot-sessions";
export interface SessionsMcpCommand {
    command: string;
    args: string[];
}
export interface WireSessionsMcpInput {
    /** Which host's MCP config to edit: `zcode` or `kimi` (both pull tier). */
    host: string;
    /** Injected command/args (defaults to the running metabot binary). */
    mcpCommand?: SessionsMcpCommand;
    /** Overrides `~/.zcode` / `~/.agents` / `~/.kimi-code` (tests). */
    zcodeDir?: string;
    agentsDir?: string;
    kimiDir?: string;
    remove?: boolean;
}
export interface WireSessionsMcpResult {
    host: string;
    configFile: string;
    wired: boolean;
    backedUpTo?: string;
}
export declare function wireSessionsMcp(input: WireSessionsMcpInput): Promise<WireSessionsMcpResult>;
