import type { Signer } from '../signing/signer';
import type { ProviderPresenceStateStore } from './providerPresenceState';
export declare const DEFAULT_PROVIDER_HEARTBEAT_INTERVAL_MS = 60000;
export interface ProviderHeartbeatIdentity {
    globalMetaId: string;
    mvcAddress: string;
}
export interface ProviderHeartbeatLoop {
    start(): Promise<void>;
    stop(): void;
    runOnce(): Promise<boolean>;
    isRunning(): boolean;
}
export declare function createProviderHeartbeatLoop(input: {
    signer: Pick<Signer, 'writePin'>;
    presenceStore: ProviderPresenceStateStore;
    getIdentity: () => Promise<ProviderHeartbeatIdentity | null>;
    now?: () => number;
    intervalMs?: number;
}): ProviderHeartbeatLoop;
