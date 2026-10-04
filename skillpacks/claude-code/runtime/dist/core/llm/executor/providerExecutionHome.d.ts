export interface ProviderExecutionHomePreparation {
    /** Env overrides to apply to the provider process (`<envName>: <home>`). */
    env: Record<string, string>;
    /** Absolute path of the isolated execution home. */
    home: string;
    /** Non-fatal seeding problems, surfaced as log events by the caller. */
    warnings: string[];
}
/**
 * Managed executions (bot private-chat replies, surf, dream, scheduled tasks,
 * service orders, ...) run unattended, but CLIs like Kimi Code record every
 * thread in a user-visible session history. For platforms that declare an
 * `executionHome` policy, redirect the CLI's state home to a persistent
 * per-machine directory under the executor root so those sessions never show
 * up in the user's platform UI. The home is seeded with links to the real
 * home's auth/config entries, so the CLI keeps working with the user's
 * credentials and settings.
 *
 * Returns null (no redirection) when:
 * - the provider declares no `executionHome` policy;
 * - the request already sets the policy's env var (explicit caller override).
 *
 * `resumeStateHome` pins the redirection to the home a previous managed
 * session used (recorded on its session record as providerStateHome), so a
 * resumed thread is found where it was written instead of leaking into the
 * user's real platform session history — the exact pollution the redirection
 * exists to prevent.
 */
export declare function prepareProviderExecutionHome(input: {
    provider: string;
    homesRoot: string;
    baseEnv?: NodeJS.ProcessEnv;
    requestEnv?: Record<string, string>;
    resumeStateHome?: string;
}): Promise<ProviderExecutionHomePreparation | null>;
