import type { PublishedMasterRecord, MasterDirectoryItem } from './masterTypes';
export interface ParsedChainMasterRow {
    pinId: string;
    providerMetaId: string;
    providerGlobalMetaId: string;
    providerAddress: string;
    serviceName: string;
    displayName: string;
    description: string;
    masterKind: string;
    specialties: string[];
    hostModes: string[];
    modelInfo: Record<string, unknown> | null;
    style: string | null;
    pricingMode: string | null;
    price: string;
    currency: string;
    responseMode: string | null;
    contextPolicy: string | null;
    official: boolean;
    trustedTier: string | null;
    status: number;
    operation: string;
    path: string | null;
    originalId: string | null;
    sourceMasterPinId: string;
    available: number;
    updatedAt: number;
}
export interface ReadChainMasterDirectoryResult {
    masters: MasterDirectoryItem[];
    source: 'chain' | 'seeded';
    fallbackUsed: boolean;
}
export interface ReadChainMasterDirectoryOptions {
    chainApiBaseUrl?: string;
    fetchImpl?: typeof fetch;
    now?: () => number;
    onlineOnly?: boolean;
    fetchSeededDirectoryMasters: () => Promise<MasterDirectoryItem[]>;
}
export declare function parseChainMasterItem(item: Record<string, unknown>): ParsedChainMasterRow | null;
export declare function resolveCurrentChainMasters(rows: Array<ParsedChainMasterRow | null | undefined>): MasterDirectoryItem[];
export declare function summarizePublishedMaster(record: PublishedMasterRecord): MasterDirectoryItem;
export declare function listMasters(input: {
    entries: Array<Record<string, unknown> | MasterDirectoryItem>;
    onlineOnly?: boolean;
    host?: string;
    masterKind?: string;
    official?: boolean;
}): MasterDirectoryItem[];
export declare function readChainMasterDirectoryWithFallback(options: ReadChainMasterDirectoryOptions): Promise<ReadChainMasterDirectoryResult>;
