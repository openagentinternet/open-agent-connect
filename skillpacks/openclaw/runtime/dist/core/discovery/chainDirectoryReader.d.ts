export type SocketPresenceFailureMode = 'throw' | 'assume_service_providers_online';
export interface ReadChainDirectoryResult {
    services: Array<Record<string, unknown>>;
    source: 'chain' | 'seeded';
    fallbackUsed: boolean;
}
export interface ReadChainDirectoryOptions {
    chainApiBaseUrl?: string;
    fetchImpl?: typeof fetch;
    onlineOnly?: boolean;
    servicePageSize?: number;
    serviceMaxPages?: number;
    socketPresenceApiBaseUrl?: string;
    socketPresenceLimit?: number;
    socketPresenceFailureMode?: SocketPresenceFailureMode;
    fetchSeededDirectoryServices: () => Promise<Array<Record<string, unknown>>>;
}
export declare function readChainDirectoryWithFallback(options: ReadChainDirectoryOptions): Promise<ReadChainDirectoryResult>;
