export declare function buildCliShimDoctorCheck(systemHomeDir: string, env: NodeJS.ProcessEnv, cwd: string): Promise<{
    code: string;
    ok: boolean;
    message: string;
    canonicalShimPath: string;
    legacyShimPath: string;
    legacyCompatibilityForwarder?: undefined;
} | {
    code: string;
    ok: boolean;
    canonicalShimPath: string | null;
    legacyShimPath: string | null;
    legacyCompatibilityForwarder: boolean;
    message?: undefined;
}>;
