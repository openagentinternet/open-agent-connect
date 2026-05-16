import { type MetabotCommandResult } from '../contracts/commandResult';
import { type LoomChainWriteRequest } from './chainRequest';
import type { LoomProtocolName } from './protocols';
export interface LoomProtocolRecordWriteInput {
    protocol: LoomProtocolName;
    payload: Record<string, unknown>;
    from?: string;
    chain?: string;
    writeChain: (request: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
}
export interface LoomProtocolRecordWriteResult {
    pinId: string;
    txids?: string[];
    request: LoomChainWriteRequest;
    network?: string;
    globalMetaId?: string;
    mvcAddress?: string;
}
export declare function writeLoomProtocolRecord(input: LoomProtocolRecordWriteInput): Promise<MetabotCommandResult<LoomProtocolRecordWriteResult>>;
