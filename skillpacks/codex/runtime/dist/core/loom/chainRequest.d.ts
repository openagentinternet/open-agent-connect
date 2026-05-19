import { type LoomProtocolName } from './protocols';
import { type LoomValidationResult } from './validation';
export interface LoomChainWriteRequest {
    operation: 'create';
    path: string;
    encryption: '0';
    version: '1.0.0';
    contentType: 'application/json';
    payload: string;
}
export type LoomChainWriteRequestBuildResult = {
    request: LoomChainWriteRequest;
    validation: LoomValidationResult;
} | {
    request: null;
    code: 'invalid_payload';
    validation: LoomValidationResult;
};
export declare function buildLoomChainWriteRequest(protocol: LoomProtocolName, payload: Record<string, unknown>): LoomChainWriteRequestBuildResult;
