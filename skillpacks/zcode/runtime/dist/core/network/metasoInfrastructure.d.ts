export declare const DEFAULT_METASO_P2P_BASE_URL = "https://so.metaid.io";
export interface MetasoSocketEndpoint {
    url: string;
    path: string;
}
export interface MetasoInfrastructureEndpoints {
    metasoP2PBaseUrl: string;
    chatApiBaseUrl: string;
    socketPresenceApiBaseUrl: string;
    socket: MetasoSocketEndpoint;
}
export declare function resolveMetasoInfrastructureEndpoints(metasoP2PBaseUrl?: string): MetasoInfrastructureEndpoints;
