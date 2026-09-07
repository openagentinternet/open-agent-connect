/**
 * `metabot qanda …` — on-chain Q&A (docs/metaid_protocols/08-qanda.md):
 * simplequestion / simpleanswer / paylike writes through the daemon, and the
 * read-only Q&A recall verbs (search / latest / detail / answers) over the
 * metaso-p2p Q&A APIs. OAC port of the IDBots feat/metaweb-qa tools.
 */
import { type MetabotCommandResult } from '../../core/contracts/commandResult';
import type { CliRuntimeContext } from '../types';
export declare function runQandaCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>>;
