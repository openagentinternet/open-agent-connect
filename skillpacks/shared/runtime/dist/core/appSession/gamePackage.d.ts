/**
 * Game package loading: resolve `manifestUri` (metafile://<pinId>.zip) to
 * `game-manifest.json` + `adapter.js`, verify `adapterHash`, and cache the
 * extracted package under the daemon runtime root. The adapter hash is fixed
 * at session start and never changes during a match (docs/09 6.6).
 */
import { type LoadedGamePackage } from './types';
export declare function sha256Hex(value: string | Buffer): string;
/**
 * Normalize an adapter hash declaration: accepts `sha256:<hex>` or bare hex.
 * Returns the lowercase hex or null when malformed.
 */
export declare function normalizeAdapterHash(value: unknown): string | null;
export interface GamePackageLoader {
    load(input: {
        manifestUri: string;
    }): Promise<LoadedGamePackage>;
}
/**
 * Load a game package from a metafile:// zip URI, verify its manifest and
 * adapter hash, and return the frozen package. The extraction cache is keyed
 * by the manifest URI hash so restores re-use the downloaded package while the
 * hash verification still runs on every load.
 */
export declare function createGamePackageLoader(input: {
    fetchImpl: typeof fetch;
    cacheRoot: string;
}): GamePackageLoader;
