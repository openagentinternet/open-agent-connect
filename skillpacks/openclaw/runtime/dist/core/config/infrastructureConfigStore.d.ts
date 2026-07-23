import { type MetabotDaemonPaths } from '../state/paths';
export interface InfrastructureConfig {
    metasoP2PBaseUrl: string;
    metafileContentBaseUrl: string;
    manApiBaseUrl: string;
}
export interface InfrastructureConfigStore {
    paths: MetabotDaemonPaths;
    ensureLayout(): Promise<MetabotDaemonPaths>;
    read(): Promise<InfrastructureConfig>;
    set(value: InfrastructureConfig): Promise<void>;
}
export declare function createDefaultInfrastructureConfig(): InfrastructureConfig;
export declare function createInfrastructureConfigStore(systemHomeDirOrPaths: string | MetabotDaemonPaths): InfrastructureConfigStore;
