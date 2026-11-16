/**
 * Minimal stdio MCP server for the local session tools (local session
 * adapters P2a).
 *
 * Hand-rolled on purpose: the repo keeps protocol adapters in-house (the
 * executor backends hand-roll ACP and stream-json framers), and pulling the
 * MCP SDK for four tools is not worth the dependency. Speaks JSON-RPC 2.0
 * over newline-delimited stdio (the MCP stdio transport): initialize,
 * tools/list, tools/call, ping; notifications are ignored.
 *
 * The server is a thin client of the daemon: the injected backend is the
 * same dependency-proxy surface the CLI uses (it auto-starts the daemon).
 * The server binds ONE session identity at start (from `--name`/`--session`
 * or an env-detected registration); `check_inbox` serves that session's
 * mail queue. Transport state is kept per connection; IO is injected so
 * tests drive it without a real process.
 */
export interface McpToolBackend {
    listSessions(input: {
        all?: boolean;
    }): Promise<unknown>;
    registerSession(input: {
        agent: string;
        sessionId?: string;
        pid?: number;
        name?: string;
        source: 'mcp';
        deliverable: boolean;
    }): Promise<unknown>;
    checkInbox(input: {
        sessionKey: string;
        waitSecs?: number;
    }): Promise<unknown>;
    messageStatus(input: {
        ids: string[];
    }): Promise<unknown>;
    /** Optional: the P2b reply path (absent = send_message errors gracefully). */
    sendMessage?(input: {
        sessionKey: string;
        to: string;
        message: string;
    }): Promise<unknown>;
    /** Optional: non-consuming pending count (P5c unread notices). */
    pendingFor?(input: {
        sessionKey: string;
    }): Promise<number>;
}
export interface McpServerIo {
    /** Incoming JSON-RPC lines (already split). */
    input: AsyncIterable<string>;
    /** Outgoing JSON-RPC line writer. */
    write: (line: string) => void;
}
export interface McpServerOptions {
    /** Server version reported in initialize (defaults '0.0.0-local'). */
    version?: string;
    /** Bound session key for check_inbox (resolved by the CLI command). */
    sessionKey?: string;
}
export declare function createMcpSessionServer(io: McpServerIo, backend: McpToolBackend, options?: McpServerOptions): {
    run: () => Promise<void>;
};
