import { type MetabotCommandResult } from '../../core/contracts/commandResult';
import type { CliRuntimeContext } from '../types';
/**
 * Traffic (流量 account-quota gas credit) verbs. All owner-scoped thin HTTP
 * clients over the daemon /api/traffic/* routes (no --from); the daemon
 * handlers own the soft/hard TrafficApiError mapping.
 */
export declare function runTrafficCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>>;
