import { type MetabotPaths } from '../state/paths';
import type { PublishedMasterRecord } from './masterTypes';
export interface PublishedMasterState {
    masters: PublishedMasterRecord[];
}
export interface PublishedMasterStateStore {
    paths: MetabotPaths;
    statePath: string;
    read(): Promise<PublishedMasterState>;
    write(nextState: PublishedMasterState): Promise<PublishedMasterState>;
    update(updater: (currentState: PublishedMasterState) => PublishedMasterState | Promise<PublishedMasterState>): Promise<PublishedMasterState>;
}
export declare function createPublishedMasterStateStore(homeDirOrPaths: string | MetabotPaths): PublishedMasterStateStore;
