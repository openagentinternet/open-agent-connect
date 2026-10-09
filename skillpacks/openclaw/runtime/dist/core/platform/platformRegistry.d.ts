export type PlatformId = 'claude-code' | 'codex' | 'copilot' | 'opencode' | 'openclaw' | 'hermes' | 'gemini' | 'pi' | 'cursor' | 'kimi' | 'kiro' | 'codebuddy' | 'zcode' | 'workbuddy' | 'dsh' | 'grok-bot';
export type RuntimePlatformId = PlatformId;
export type PlatformExecutorKind = 'claude-stream-json' | 'codex-app-server' | 'copilot-json' | 'opencode-json' | 'openclaw-json' | 'acp-hermes' | 'gemini-stream-json' | 'pi-json' | 'cursor-stream-json' | 'acp-kimi' | 'acp-kiro' | 'codebuddy-stream-json' | 'zcode-json';
export interface PlatformDefinition {
    id: PlatformId;
    displayName: string;
    logoPath: string;
    runtime?: {
        binaryNames: string[];
        versionArgs: string[];
        authEnv: string[];
        capabilities: string[];
        envAliases?: string[];
        pathSearchBinaryNames?: string[];
        defaultExecutablePaths?: string[];
        /**
         * Minimum CLI version a discovered binary must report. A parsed version
         * below this floor marks the runtime unavailable with an upgrade hint
         * (readiness is not attempted); an unparsable or missing version fails
         * open and the runtime is treated exactly as before.
         */
        minimumCliVersion?: string;
        /** Minimum Node.js version for CLIs launched through a Node shebang. */
        nodeRuntime?: {
            minimumVersion: string;
        };
        /**
         * Optional probe timing policy. App-embedded CLIs start slowly, so they
         * get wider windows. Missing fields fall back to the discovery defaults
         * (readiness 30s, version probe 5s, semantic inactivity min(readiness, 15s)).
         */
        probeHints?: {
            readinessTimeoutMs?: number;
            versionProbeTimeoutMs?: number;
            semanticInactivityTimeoutMs?: number;
            /**
             * Readiness probes run a real one-shot CLI turn. CLIs that record every
             * thread in a user-visible session history get their state home
             * redirected to an ephemeral directory during the probe (the paths in
             * `seedPaths` are copied in from the real home), so synthetic probe
             * turns never surface in the user's conversation history.
             */
            probeHome?: {
                /** Env var the CLI honors as its state-home directory override. */
                envName: string;
                /** State-home source when the env var is unset; relative to the user's home. */
                defaultSourceHome?: string;
                /** Files or directories copied from the source home into the ephemeral home before the probe. */
                seedPaths?: string[];
            };
        };
        /**
         * State-home policy for managed (bot-driven) executions. Bot turns run
         * unattended, and CLIs that record every thread in a user-visible session
         * history (the Kimi Code desktop sidebar, `claude --resume`, Codex
         * session list, ...) would otherwise flood the user's local conversation
         * list with one session per bot turn. When declared, the LLM executor
         * points `envName` at a persistent per-machine home under the executor
         * root (`LLM/executor/provider-homes/<provider>`) and seeds it with
         * links/copies of the auth and config entries in `seedPaths`, so managed
         * sessions stay out of the user's platform UI while credentials and
         * settings keep tracking the real home. Skipped when the request resumes
         * a caller-owned session or already sets the env var itself.
         */
        executionHome?: {
            /** Env var the CLI honors as its state-home directory override. */
            envName: string;
            /** State-home source when the env var is unset; relative to the user's home. */
            defaultSourceHome?: string;
            /** Files or directories linked (or copied) from the source home into the execution home. */
            seedPaths?: string[];
        };
    };
    skills: {
        roots: PlatformSkillRoot[];
    };
    executor?: {
        kind: PlatformExecutorKind;
        backendFactoryExport: string;
        launchCommand: string;
        multicaReferencePath: string;
    };
}
export interface PlatformSkillRoot {
    id: string;
    kind: 'global' | 'project';
    homeEnv?: string;
    path: string;
    /**
     * Optional Windows-specific skill root path, used only on win32. POSIX-style
     * (forward slashes, `~/`-prefixed) so it can be resolved against %APPDATA% or
     * %LOCALAPPDATA%. When omitted, `path` is used on all platforms.
     */
    windowsPath?: string;
    autoBind: 'always' | 'when-parent-exists' | 'manual';
    sharedStandard?: boolean;
}
export type InstallSkillRoot = PlatformSkillRoot & {
    platformId: PlatformId | 'shared-agents';
};
/** The ~/.agents/skills shared standard root (DSH sessions load it natively). */
export declare function getSharedAgentsSkillRoot(): PlatformSkillRoot;
export declare const PLATFORM_DEFINITIONS: PlatformDefinition[];
export declare const SUPPORTED_PLATFORM_IDS: PlatformId[];
export declare const RUNTIME_PLATFORM_IDS: RuntimePlatformId[];
export declare function getPlatformDefinition(id: PlatformId): PlatformDefinition;
export declare function getRuntimePlatformDefinition(id: RuntimePlatformId): RuntimePlatformDefinition;
export declare function isPlatformId(value: unknown): value is PlatformId;
export declare function isRuntimePlatformId(value: unknown): value is RuntimePlatformId;
export type RuntimePlatformDefinition = PlatformDefinition & {
    id: RuntimePlatformId;
    runtime: NonNullable<PlatformDefinition['runtime']>;
    executor: NonNullable<PlatformDefinition['executor']>;
};
export declare function getRuntimePlatforms(): RuntimePlatformDefinition[];
export declare function getPlatformDisplayNames(): Record<string, string>;
export declare function getPlatformBinaryMap(): Record<string, string>;
export declare function getPlatformSearchOrder(): RuntimePlatformId[];
export declare function getPlatformSkillRoots(id: PlatformId): PlatformSkillRoot[];
export declare function getProjectSkillRoot(id: PlatformId): PlatformSkillRoot | null;
export declare function getInstallSkillRoots(): InstallSkillRoot[];
export declare function getMetabotSharedSkillRoot(): InstallSkillRoot;
export declare function getRuntimePortableSkillRoots(): InstallSkillRoot[];
export declare function resolvePlatformSkillRootPath(root: PlatformSkillRoot, systemHomeDir: string, env?: NodeJS.ProcessEnv): string;
