import { type MetabotPaths } from './paths';
export interface MetabotManagerLayout {
    systemHomeDir: string;
    metabotRoot: string;
    managerRoot: string;
    skillsRoot: string;
    profilesRoot: string;
    identityProfilesPath: string;
    activeHomePath: string;
}
export interface MetabotHomeSelection {
    systemHomeDir: string;
    homeDir: string;
    paths: MetabotPaths;
    source: 'explicit' | 'active';
}
interface ResolveMetabotHomeSelectionInput {
    env: NodeJS.ProcessEnv;
    cwd: string;
    allowUnindexedExplicitHome?: boolean;
}
export declare function normalizeSystemHomeDir(env: NodeJS.ProcessEnv, cwd: string): string;
export declare function resolveMetabotManagerLayout(systemHomeDir: string): MetabotManagerLayout;
export declare function hasLegacyOnlyMetabotLayout(systemHomeDir: string): boolean;
export declare function readIndexedActiveMetabotHomeSync(systemHomeDir: string): string | null;
export declare function resolveMetabotHomeSelection(input: ResolveMetabotHomeSelectionInput): MetabotHomeSelection;
export declare function resolveMetabotHomeSelectionSync(input: ResolveMetabotHomeSelectionInput): MetabotHomeSelection;
export {};
