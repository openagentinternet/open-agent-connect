import type { BrowserHostAdapter } from '../../core/browser/hostTypes';
import { type MetabotCommandResult } from '../../core/contracts/commandResult';
export interface StandaloneBrowserPreviewAsset {
    body: Buffer | string;
    contentType: string;
}
export interface StandaloneBrowserPreviewAssetInput {
    previewId: string;
    assetPath: string;
}
export interface StandaloneBrowserHostAdapter extends BrowserHostAdapter {
    resolvePreviewAsset(input: StandaloneBrowserPreviewAssetInput): Promise<MetabotCommandResult<StandaloneBrowserPreviewAsset>>;
}
export interface CreateStandaloneBrowserHostAdapterInput {
    fetch?: typeof fetch;
    env?: NodeJS.ProcessEnv;
    now?: () => number;
}
export declare function createStandaloneBrowserHostAdapter(input?: CreateStandaloneBrowserHostAdapterInput): StandaloneBrowserHostAdapter;
