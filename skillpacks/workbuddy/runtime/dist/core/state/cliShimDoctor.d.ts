export declare function buildCliShimDoctorCheck(systemHomeDir: string, env: NodeJS.ProcessEnv, cwd: string): Promise<{
    code: string;
    ok: boolean;
    canonicalShimPath: string | null;
}>;
export declare function buildCliRuntimeDoctorCheck(systemHomeDir: string, env: NodeJS.ProcessEnv, cwd: string, currentEntryPath?: string | null): Promise<{
    code: string;
    ok: boolean;
    canonicalShimPath: string;
    canonicalTargetPath: string;
    currentEntryPath: string;
} | null>;
