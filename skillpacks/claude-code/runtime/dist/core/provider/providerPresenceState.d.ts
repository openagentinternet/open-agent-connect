import { type MetabotPaths } from '../state/paths';
export interface ProviderPresenceState {
    enabled: boolean;
    lastHeartbeatAt: number | null;
    lastHeartbeatPinId: string | null;
    lastHeartbeatTxid: string | null;
}
export interface ProviderPresenceStateStore {
    paths: MetabotPaths;
    read(): Promise<ProviderPresenceState>;
    write(nextState: ProviderPresenceState): Promise<ProviderPresenceState>;
    update(updater: (currentState: ProviderPresenceState) => ProviderPresenceState | Promise<ProviderPresenceState>): Promise<ProviderPresenceState>;
}
export declare function createProviderPresenceStateStore(homeDirOrPaths: string | MetabotPaths): ProviderPresenceStateStore;
