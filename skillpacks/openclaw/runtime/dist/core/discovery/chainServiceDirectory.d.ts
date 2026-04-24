export declare const CHAIN_SERVICE_PROTOCOL_PATH = "/protocols/skill-service";
export declare const DEFAULT_CHAIN_SERVICE_PAGE_SIZE = 200;
export declare const DEFAULT_CHAIN_SERVICE_MAX_PAGES = 20;
export interface ChainServiceDirectoryItem {
    servicePinId: string;
    sourceServicePinId: string;
    chainPinIds: string[];
    providerGlobalMetaId: string;
    providerMetaId: string;
    providerAddress: string;
    serviceName: string;
    displayName: string;
    description: string;
    price: string;
    currency: string;
    serviceIcon: string | null;
    providerSkill: string | null;
    skillDocument: string | null;
    inputType: string | null;
    outputType: string | null;
    endpoint: string | null;
    paymentAddress: string | null;
    available: boolean;
    updatedAt: number;
}
export interface ParsedChainServiceRow {
    pinId: string;
    providerMetaId: string;
    providerGlobalMetaId: string;
    providerAddress: string;
    serviceName: string;
    displayName: string;
    description: string;
    price: string;
    currency: string;
    serviceIcon: string | null;
    providerSkill: string | null;
    skillDocument: string | null;
    inputType: string | null;
    outputType: string | null;
    endpoint: string | null;
    paymentAddress: string | null;
    status: number;
    operation: string;
    path: string | null;
    originalId: string | null;
    sourceServicePinId: string;
    available: number;
    updatedAt: number;
}
export interface ChainServiceListPage {
    list: Record<string, unknown>[];
    nextCursor: string | null;
}
export declare function getChainServiceListPage(payload: unknown): ChainServiceListPage;
export declare function isChainServiceListSemanticMiss(payload: unknown): boolean;
export declare function parseChainServiceItem(item: Record<string, unknown>): ParsedChainServiceRow | null;
export declare function resolveCurrentChainServices(rows: Array<ParsedChainServiceRow | null | undefined>): ChainServiceDirectoryItem[];
