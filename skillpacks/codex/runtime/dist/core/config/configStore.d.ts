import { type MetabotPaths } from '../state/paths';
import { type MetabotConfig } from './configTypes';
export interface ConfigStore {
    paths: MetabotPaths;
    ensureLayout(): Promise<MetabotPaths>;
    read(): Promise<MetabotConfig>;
    set(value: MetabotConfig): Promise<void>;
}
export declare function createConfigStore(homeDirOrPaths?: string | MetabotPaths): ConfigStore;
