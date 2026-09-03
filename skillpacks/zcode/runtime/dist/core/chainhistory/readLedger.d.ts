import type { MetawebPin } from '../metaweb/pinRead';
import type { MetabotPaths } from '../state/paths';
import type { RecordChainReadInput } from './types';
/** Map one MetaWeb pin to a recordRead input. Returns null when the pin has
 * no usable pinId (nothing to key the record on). Tolerates missing nested
 * fields (`meta`, `creator`) on partial pin shapes. */
export declare function readInputFromMetawebPin(pin: MetawebPin, source: string): RecordChainReadInput | null;
export interface RecordMetawebPinReadDeps {
    warn?: (message: string) => void;
}
/** Record one MetaWeb pin read into the chain history store. Best-effort:
 * never throws; store failures go to `warn` (default console.warn). */
export declare function recordMetawebPinRead(paths: MetabotPaths, pin: MetawebPin, source: string, deps?: RecordMetawebPinReadDeps): Promise<void>;
