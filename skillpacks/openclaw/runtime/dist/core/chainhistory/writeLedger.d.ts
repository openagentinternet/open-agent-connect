import type { Signer } from '../signing/signer';
import type { MetabotPaths } from '../state/paths';
import { type ChainHistoryStore } from './store';
/** Whether a chain write to `path` belongs in the chain history store. */
export declare function shouldRecordChainWrite(path: string | null | undefined): boolean;
export interface WrapSignerWithChainHistoryDeps {
    store?: ChainHistoryStore;
    warn?: (message: string) => void;
}
/** Wrap `signer` so every successful writePin is recorded under
 * `paths.chainHistoryRoot`. Identity reads delegate unchanged; a failed
 * writePin propagates unchanged and is never recorded. */
export declare function wrapSignerWithChainHistory(signer: Signer, paths: MetabotPaths, deps?: WrapSignerWithChainHistoryDeps): Signer;
