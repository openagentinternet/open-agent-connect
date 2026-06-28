import { type ChainWriteEncoding, type ChainWriteNetwork, type ChainWritePayload, type ChainWriteResult } from '../chain/writePin';
import { type MetabotPaths } from '../state/paths';
export interface ProfilePublishRecord {
    payloadHash: string;
    contentType: string;
    encoding: ChainWriteEncoding;
    network: ChainWriteNetwork;
    pinId: string;
    txids: string[];
    publishedAt: string;
}
export interface ProfilePublishState {
    version: 1;
    records: Record<string, ProfilePublishRecord>;
}
export interface ProfilePublishPayloadInput {
    path: string;
    contentType: string;
    encoding?: ChainWriteEncoding;
    payload: ChainWritePayload;
}
export interface ProfilePublishStateStore {
    paths: MetabotPaths;
    read(): Promise<ProfilePublishState>;
    write(nextState: ProfilePublishState): Promise<ProfilePublishState>;
    update(updater: (currentState: ProfilePublishState) => ProfilePublishState | Promise<ProfilePublishState>): Promise<ProfilePublishState>;
}
export declare function hashProfilePublishPayload(input: ProfilePublishPayloadInput): string;
export declare function buildProfilePublishRecord(input: {
    target: ProfilePublishPayloadInput;
    result: ChainWriteResult;
    publishedAt?: string;
}): ProfilePublishRecord;
export declare function createProfilePublishStateStore(homeDirOrPaths: string | MetabotPaths): ProfilePublishStateStore;
