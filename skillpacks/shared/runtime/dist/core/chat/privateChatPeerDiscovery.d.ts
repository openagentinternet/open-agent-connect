import type { IdentityProfileRecord } from '../identity/identityProfiles';
export declare function listLocalA2AProjectedPeerGlobalMetaIds(input: {
    profiles: IdentityProfileRecord[];
    selfGlobalMetaId: string;
}): Promise<string[]>;
export declare function buildLocalA2AProjectedPeerIndex(profiles: IdentityProfileRecord[]): Promise<Map<string, string[]>>;
