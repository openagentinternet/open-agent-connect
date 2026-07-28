import { type MetabotCommandResult } from '../contracts/commandResult';
import { type MetaAppArtifactCacheStore } from './artifactCache';
/**
 * `metabot metaapp source` backend: resolve a MetaApp pin, download its zip
 * package through the shared metafile/artifact-cache path (the same one the
 * daemon uses for `/browser/metaapp/<pinId>`), and either point the caller at
 * the extracted cache directory or copy it into a workspace directory with a
 * `.metaapp-fork.json` provenance marker for later publishing.
 */
export interface MetaAppSourceInput {
    /** Bare MetaApp pinId (64-hex + i0); the CLI layer normalizes metaapp:// URIs. */
    pinId: string;
    /** Optional workspace directory to copy the extracted source into. */
    outDir?: string;
}
export interface MetaAppSourceDependencies {
    /** Actor home directory whose artifact cache is shared with the Browser. */
    homeDir: string;
    fetch?: typeof fetch;
    manApiBaseUrl?: string;
    metafileContentBaseUrl?: string;
    /** Test seam; production uses createMetaAppArtifactCacheStore(homeDir). */
    artifactCache?: MetaAppArtifactCacheStore;
    now?: () => number;
}
export declare function materializeMetaAppSource(input: MetaAppSourceInput, deps: MetaAppSourceDependencies): Promise<MetabotCommandResult<Record<string, unknown>>>;
