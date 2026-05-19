import { type LoomProtocolName } from './protocols';
export interface LoomValidationError {
    path: string;
    code: string;
    message: string;
}
export interface LoomValidationResult {
    valid: boolean;
    protocol: LoomProtocolName;
    path: string;
    errors: LoomValidationError[];
}
export declare function validateLoomPayload(protocol: LoomProtocolName, payload: unknown): LoomValidationResult;
