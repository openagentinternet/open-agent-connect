export declare function buildCliShimDoctorCheck(systemHomeDir: string, env: NodeJS.ProcessEnv, cwd: string): Promise<{
    code: string;
    ok: boolean;
    canonicalShimPath: string | null;
}>;
