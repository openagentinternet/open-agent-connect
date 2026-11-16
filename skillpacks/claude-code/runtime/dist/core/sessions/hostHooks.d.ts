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
export declare const HOOK_HOSTS: readonly ["cursor", "gemini"];
export type HookHost = (typeof HOOK_HOSTS)[number];
export interface WireHostHooksInput {
    host: HookHost;
    remove?: boolean;
    /** Injectable command resolution (tests); defaults to the running CLI. */
    commandFor?: (host: HookHost, event: string) => string;
    mcpCommand?: {
        command: string;
        args: string[];
    };
    /** Overrides `~/.cursor` / `~/.gemini` (tests). */
    cursorDir?: string;
    geminiDir?: string;
}
export interface WireHostFileResult {
    file: string;
    action: 'created' | 'updated' | 'removed';
    backedUpTo?: string;
}
export interface WireHostHooksResult {
    host: HookHost;
    files: WireHostFileResult[];
}
export declare function wireHostHooks(input: WireHostHooksInput): Promise<WireHostHooksResult>;
