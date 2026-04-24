import { type MetabotPaths } from '../state/paths';
export interface RatingDetailItem {
    pinId: string;
    serviceId: string;
    servicePaidTx: string | null;
    rate: number;
    comment: string | null;
    raterGlobalMetaId: string | null;
    raterMetaId: string | null;
    createdAt: number | null;
}
export interface RatingDetailState {
    items: RatingDetailItem[];
    latestPinId: string | null;
    backfillCursor: string | null;
    lastSyncedAt: number | null;
}
export interface RatingDetailStateStore {
    paths: MetabotPaths;
    ensureLayout(): Promise<MetabotPaths>;
    read(): Promise<RatingDetailState>;
    write(nextState: RatingDetailState): Promise<RatingDetailState>;
    update(updater: (currentState: RatingDetailState) => RatingDetailState | Promise<RatingDetailState>): Promise<RatingDetailState>;
}
export declare function createRatingDetailStateStore(homeDirOrPaths: string | MetabotPaths): RatingDetailStateStore;
