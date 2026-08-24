/**
 * `metabot metaweb …` — MetaWeb knowledge access (OAC port of the IDBots M1
 * tools as CLI verbs). Read-only aggregation calls run in-process against
 * the metaso-p2p node (same pattern as `metaid search`).
 */
import type { MetabotCommandResult } from '../../core/contracts/commandResult';
import type { CliRuntimeContext } from '../types';
export declare function runMetawebCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>>;
