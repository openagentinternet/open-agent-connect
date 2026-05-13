export type PlatformId = 'claude-code' | 'codex' | 'copilot' | 'opencode' | 'openclaw' | 'hermes' | 'gemini' | 'pi' | 'cursor' | 'kimi' | 'kiro' | 'trae' | 'codebuddy';
export type RuntimePlatformId = Exclude<PlatformId, 'trae' | 'codebuddy'>;
export type PlatformExecutorKind = 'claude-stream-json' | 'codex-app-server' | 'copilot-json' | 'opencode-json' | 'openclaw-json' | 'acp-hermes' | 'gemini-stream-json' | 'pi-json' | 'cursor-stream-json' | 'acp-kimi' | 'acp-kiro';
export interface PlatformDefinition {
    id: PlatformId;
    displayName: string;
    logoPath: string;
    runtime?: {
        binaryNames: string[];
        versionArgs: string[];
        authEnv: string[];
        capabilities: string[];
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
    autoBind: 'always' | 'when-parent-exists' | 'manual';
    sharedStandard?: boolean;
}
export type InstallSkillRoot = PlatformSkillRoot & {
    platformId: PlatformId | 'shared-agents';
};
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
export declare function resolvePlatformSkillRootPath(root: PlatformSkillRoot, systemHomeDir: string, env?: NodeJS.ProcessEnv): string;
