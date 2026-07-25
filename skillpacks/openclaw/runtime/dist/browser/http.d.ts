import { type BrowserCacheClearResult, type BrowserCacheSnapshot, type BrowserCommandResult, type BrowserResolveResult, BrowserRuntimeSnapshot, type BrowserSettingsSnapshot, BrowserTrustedActionInput, BrowserTrustedActionResult } from '@openagentinternet/agent-browser-host-contract';
import type { BrowserContextResult } from '@openagentinternet/agent-browser-core';
export type Awaitable<T> = T | Promise<T>;
/** Result shape for `POST /api/browser/tabs/open`. */
export interface BrowserTabOpenResult {
    ok: true;
    uri: string;
    /** Number of currently-open Browser pages the open request reached. */
    pagesReached: number;
    /** Present only when no page was open. */
    note?: string;
}
/**
 * A fire-and-forget transport sink for daemon→Browser-page tab pushes.
 *
 * ABC tabs are strictly client-only and session-level (see
 * `browser-tabs-host-integration.md`): they hold no server-side state and the
 * daemon never learns tab ids. This sink exists purely so an external caller
 * (e.g. `metabot browser tab open --uri`) can fan a single open request out to
 * every currently-open Browser page, which then feeds ABC's built-in
 * `AgentBrowserTabs.openTab`. It is not tab-state storage.
 *
 * Sinks are registered/unregistered by the daemon SSE route that owns each
 * connected page; `broadcastBrowserTabOpen` is called from the POST route.
 */
export interface BrowserTabEventSink {
    /** Deliver an `agent-browser:open-tab` event to one subscribed page. */
    (event: {
        type: 'agent-browser:open-tab';
        uri: string;
    }): void;
}
/** Register a sink. Returns an unregister function for cleanup. */
export declare function registerBrowserTabSink(sink: BrowserTabEventSink): () => void;
/** Number of currently-subscribed Browser pages (used to report "no page open"). */
export declare function browserTabSinkCount(): number;
/**
 * Fan an open-tab request out to every subscribed Browser page. Never throws:
 * each sink is its own best-effort try/catch boundary. Returns the number of
 * pages reached.
 */
export declare function broadcastBrowserTabOpen(uri: string): number;
export interface BrowserHttpHandlers {
    getRuntime?: (input?: {
        actorId?: string;
        from?: string;
    }) => Awaitable<BrowserCommandResult<BrowserRuntimeSnapshot>>;
    getContext?: (input?: {
        actorId?: string;
        from?: string;
    }) => Awaitable<BrowserCommandResult<BrowserContextResult>>;
    resolve?: (input: {
        uri: string;
        actorId?: string;
        from?: string;
    }) => Awaitable<BrowserCommandResult<BrowserResolveResult>>;
    getSettings?: (input?: {
        actorId?: string;
        from?: string;
    }) => Awaitable<BrowserCommandResult<BrowserSettingsSnapshot>>;
    updateSettings?: (input: {
        actorId?: string;
        from?: string;
        browser?: Record<string, unknown>;
    } & Record<string, unknown>) => Awaitable<BrowserCommandResult<BrowserSettingsSnapshot>>;
    getCache?: (input?: {
        actorId?: string;
        from?: string;
    }) => Awaitable<BrowserCommandResult<BrowserCacheSnapshot>>;
    clearCache?: (input: {
        actorId?: string;
        from?: string;
        scope?: string;
        pinId?: string;
        cacheKey?: string;
    } & Record<string, unknown>) => Awaitable<BrowserCommandResult<BrowserCacheClearResult>>;
    runTrustedAction?: (input: BrowserTrustedActionInput & {
        from?: string;
    }) => Awaitable<BrowserCommandResult<BrowserTrustedActionResult>>;
    metafileUpload?: (input: {
        actorId?: string;
        from?: string;
    } & Record<string, unknown>) => Awaitable<BrowserCommandResult<BrowserTrustedActionResult>>;
}
export interface BrowserHttpRouteContext {
    method: string;
    url: URL;
    handlers?: BrowserHttpHandlers;
    readJsonBody: () => Promise<Record<string, unknown>>;
    sendJson: (status: number, payload: unknown) => void;
    sendMethodNotAllowed: (allowed: string[]) => void;
}
export declare function statusForBrowserResult(result: BrowserCommandResult<unknown>): number;
export declare function handleBrowserApiRoutes(context: BrowserHttpRouteContext): Promise<boolean>;
