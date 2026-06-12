import { type MetabotCommandResult } from '../contracts/commandResult';
import type { MetaAppGalleryRecord } from '../metaapp/types';
import type { BotBrowserConfig, BrowserResolveResult } from './types';
export interface ResolveBrowserResourceInput {
    uri: string;
    config: BotBrowserConfig;
    fetch?: typeof fetch;
    metaAppLookup?: (pinId: string) => Promise<MetaAppGalleryRecord | null>;
    metaAppResolve?: (pinId: string) => Promise<MetabotCommandResult<MetaAppGalleryRecord>>;
}
export declare function resolveBrowserResource(input: ResolveBrowserResourceInput): Promise<MetabotCommandResult<BrowserResolveResult>>;
