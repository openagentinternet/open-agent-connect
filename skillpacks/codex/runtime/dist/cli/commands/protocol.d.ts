/**
 * `metabot protocol …` — the MetaID protocol registry (/protocols/metaprotocol,
 * docs/metaid_protocols/metaprotocol-registry-agent-tools.md): read verbs
 * (list / read / versions / check) run in-process against the metaso-p2p
 * registry projection, and the publish / update writers go through the
 * daemon's /api/protocol/* routes with --request-file + --from. OAC port of
 * the IDBots feat/metaprotocol-registry-tools CLI surface.
 */
import { type MetabotCommandResult } from '../../core/contracts/commandResult';
import type { CliRuntimeContext } from '../types';
export declare function runProtocolCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>>;
