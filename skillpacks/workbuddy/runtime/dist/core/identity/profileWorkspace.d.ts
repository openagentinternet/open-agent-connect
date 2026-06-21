import type { IdentityProfileRecord } from './identityProfiles';
export declare function ensureProfileWorkspace(input: {
    homeDir: string;
    name: string;
}): Promise<void>;
export declare function resolveIdentityCreateProfileHome(input: {
    systemHomeDir: string;
    requestedName: string;
    profiles: IdentityProfileRecord[];
}): ({
    status: 'resolved';
    slug: string;
    homeDir: string;
} | {
    status: 'duplicate';
    message: string;
});
