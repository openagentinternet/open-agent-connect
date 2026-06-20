import { type BrowserCacheClearResult, type BrowserCacheSnapshot, type BrowserCommandResult, type BrowserResolveResult, BrowserRuntimeSnapshot, type BrowserSettingsSnapshot, BrowserTrustedActionInput, BrowserTrustedActionResult } from '@openagentinternet/agent-browser-host-contract';
import type { BrowserContextResult } from '@openagentinternet/agent-browser-core';
export type Awaitable<T> = T | Promise<T>;
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
