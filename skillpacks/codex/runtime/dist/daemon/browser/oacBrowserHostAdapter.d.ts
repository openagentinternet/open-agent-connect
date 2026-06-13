import type { BrowserHostAdapter } from '../../core/browser/hostTypes';
import { type MetabotCommandResult } from '../../core/contracts/commandResult';
import type { createMetaAppPreviewSessionRegistry } from '../../core/metaapp/previewSessions';
type MetaAppPreviewSessions = ReturnType<typeof createMetaAppPreviewSessionRegistry>;
type OacBrowserActionHandler = (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
export interface OacBrowserActorContext {
    homeDir: string;
}
export interface CreateOacBrowserHostAdapterInput {
    homeDir: string;
    systemHomeDir: string;
    resolveActorWriteContext: (rawActor: unknown) => Promise<OacBrowserActorContext | {
        failure: MetabotCommandResult<never>;
    }>;
    metaAppPreviewSessions: MetaAppPreviewSessions;
    privateChat?: OacBrowserActionHandler;
    serviceCall?: OacBrowserActionHandler;
    fetch?: typeof fetch;
    env?: NodeJS.ProcessEnv;
}
export declare function createOacBrowserHostAdapter(input: CreateOacBrowserHostAdapterInput): BrowserHostAdapter;
export {};
