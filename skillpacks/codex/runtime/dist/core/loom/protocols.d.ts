export type LoomProtocolName = 'task' | 'claim' | 'status' | 'delivery' | 'acceptance' | 'claim-reject';
export interface LoomProtocolSpec {
    name: LoomProtocolName;
    path: string;
    version: '1.0.0';
    contentType: 'application/json';
}
export declare const LOOM_PROTOCOLS: Record<LoomProtocolName, LoomProtocolSpec>;
export declare const LOOM_PROTOCOL_NAMES: readonly LoomProtocolName[];
export declare const LOOM_PROTOCOL_PATHS: readonly string[];
export declare function isLoomProtocolName(value: unknown): value is LoomProtocolName;
export declare function resolveLoomProtocol(value: unknown): LoomProtocolSpec;
