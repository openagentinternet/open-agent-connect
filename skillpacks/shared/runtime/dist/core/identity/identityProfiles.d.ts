export interface IdentityManagerPaths {
    managerRoot: string;
    profilesPath: string;
    activeHomePath: string;
}
export interface IdentityProfileRecord {
    name: string;
    slug: string;
    aliases: string[];
    homeDir: string;
    globalMetaId: string;
    mvcAddress: string;
    createdAt: number;
    updatedAt: number;
}
export interface IdentityProfilesState {
    profiles: IdentityProfileRecord[];
}
export declare function resolveIdentityManagerPaths(systemHomeDir: string): IdentityManagerPaths;
export declare function readIdentityProfilesState(systemHomeDir: string): Promise<IdentityProfilesState>;
export declare function listIdentityProfiles(systemHomeDir: string): Promise<IdentityProfileRecord[]>;
export declare function upsertIdentityProfile(input: {
    systemHomeDir: string;
    name: string;
    homeDir: string;
    globalMetaId?: string;
    mvcAddress?: string;
    now?: () => number;
}): Promise<IdentityProfileRecord>;
export declare function readActiveMetabotHomeSync(systemHomeDir: string): string | null;
export declare function readActiveMetabotHome(systemHomeDir: string): Promise<string | null>;
export declare function setActiveMetabotHome(input: {
    systemHomeDir: string;
    homeDir: string;
    now?: () => number;
}): Promise<string>;
