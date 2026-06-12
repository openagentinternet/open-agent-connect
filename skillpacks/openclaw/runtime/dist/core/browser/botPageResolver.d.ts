import type { BrowserResolveResult } from './types';
export declare function buildBotPageResolveResult(input: {
    uri: string;
    normalizedUri: string;
    homepage: Record<string, unknown>;
    resolverUrl: string;
    templateId?: unknown;
}): BrowserResolveResult;
