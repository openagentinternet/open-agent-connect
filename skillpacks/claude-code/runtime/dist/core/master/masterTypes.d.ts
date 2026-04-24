export declare const MASTER_SERVICE_PROTOCOL_PATH = "/protocols/master-service";
export declare const PENDING_MASTER_PIN_ID = "pending-master-service-pin";
export declare const MASTER_KIND_DEBUG = "debug";
export declare const MASTER_KIND_REVIEW = "review";
export declare const OFFICIAL_DEBUG_MASTER_SERVICE_NAME = "official-debug-master";
export declare const OFFICIAL_REVIEW_MASTER_SERVICE_NAME = "official-review-master";
export interface PublishedMasterDraft {
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
}
export interface PublishedMasterRecord {
    id: string;
    sourceMasterPinId: string;
    currentPinId: string;
    creatorMetabotId: number;
    providerGlobalMetaId: string;
    providerAddress: string;
    serviceName: string;
    displayName: string;
    description: string;
    masterKind: string;
    specialties: string[];
    hostModes: string[];
    modelInfoJson: string | null;
    style: string | null;
    pricingMode: string | null;
    price: string;
    currency: string;
    responseMode: string | null;
    contextPolicy: string | null;
    official: 0 | 1;
    trustedTier: string | null;
    payloadJson: string;
    available: 0 | 1;
    revokedAt: number | null;
    updatedAt: number;
}
export interface MasterDirectoryItem {
    masterPinId: string;
    sourceMasterPinId: string;
    chainPinIds: string[];
    providerGlobalMetaId: string;
    providerMetaId: string;
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
    available: boolean;
    online: boolean;
    updatedAt: number;
    lastSeenSec?: number | null;
    providerDaemonBaseUrl?: string | null;
    directorySeedLabel?: string | null;
}
export interface MasterServiceValidationSuccess {
    ok: true;
    value: PublishedMasterDraft;
}
export interface MasterServiceValidationFailure {
    ok: false;
    code: 'invalid_master_service_payload';
    message: string;
    issues: string[];
}
export type MasterServiceValidationResult = MasterServiceValidationSuccess | MasterServiceValidationFailure;
