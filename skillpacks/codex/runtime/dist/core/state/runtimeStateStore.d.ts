import type { PublishedServiceRecord } from '../services/publishService';
import type { SessionTraceRecord } from '../chat/sessionTrace';
import { type SellerOrderRecord } from '../orders/sellerOrderState';
import { type MetabotPaths } from './paths';
export type RuntimeIdentitySubsidyState = 'pending' | 'claimed' | 'failed';
export type RuntimeIdentitySyncState = 'pending' | 'synced' | 'partial' | 'failed';
export interface RuntimeIdentityRecord {
    metabotId: number;
    name: string;
    createdAt: number;
    path: string;
    publicKey: string;
    chatPublicKey: string;
    /** Chain addresses keyed by network name. E.g. { mvc: "1...", btc: "1...", doge: "D...", opcat: "1..." } */
    addresses: Record<string, string>;
    /** Convenience: same as addresses['mvc']. Preserved for backward compatibility. */
    mvcAddress: string;
    metaId: string;
    globalMetaId: string;
    subsidyState?: RuntimeIdentitySubsidyState;
    subsidyError?: string | null;
    syncState?: RuntimeIdentitySyncState;
    syncError?: string | null;
    namePinId?: string | null;
    chatPublicKeyPinId?: string | null;
}
export interface RuntimeDaemonRecord {
    ownerId: string;
    pid: number;
    host: string;
    port: number;
    baseUrl: string;
    startedAt: number;
    configHash?: string | null;
}
export interface RuntimeState {
    identity: RuntimeIdentityRecord | null;
    services: PublishedServiceRecord[];
    traces: SessionTraceRecord[];
    sellerOrders: SellerOrderRecord[];
}
export interface RuntimeStateStore {
    paths: MetabotPaths;
    ensureLayout(): Promise<MetabotPaths>;
    readState(): Promise<RuntimeState>;
    writeState(nextState: RuntimeState): Promise<RuntimeState>;
    updateState(updater: (currentState: RuntimeState) => RuntimeState | Promise<RuntimeState>): Promise<RuntimeState>;
    readDaemon(): Promise<RuntimeDaemonRecord | null>;
    writeDaemon(record: RuntimeDaemonRecord): Promise<RuntimeDaemonRecord>;
    clearDaemon(pid?: number): Promise<void>;
}
export declare function ensureRuntimeLayout(paths: MetabotPaths): Promise<void>;
export declare function createRuntimeStateStore(homeDirOrPaths: string | MetabotPaths): RuntimeStateStore;
