export type PlatformId = 'claude-code' | 'codex' | 'copilot' | 'opencode' | 'openclaw' | 'hermes' | 'gemini' | 'pi' | 'cursor' | 'kimi' | 'kiro';
export type PlatformExecutorKind = 'claude-stream-json' | 'codex-app-server' | 'copilot-json' | 'opencode-json' | 'openclaw-json' | 'acp-hermes' | 'gemini-stream-json' | 'pi-json' | 'cursor-stream-json' | 'acp-kimi' | 'acp-kiro';
export interface PlatformDefinition {
    id: PlatformId;
    displayName: string;
    logoPath: string;
    runtime: {
        binaryNames: string[];
        versionArgs: string[];
        authEnv: string[];
        capabilities: string[];
    };
    skills: {
        roots: PlatformSkillRoot[];
    };
    executor: {
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
export declare function getPlatformDefinition(id: PlatformId): PlatformDefinition;
export declare function isPlatformId(value: unknown): value is PlatformId;
export declare function getRuntimePlatforms(): PlatformDefinition[];
export declare function getPlatformDisplayNames(): Record<string, string>;
export declare function getPlatformBinaryMap(): Record<string, string>;
export declare function getPlatformSearchOrder(): PlatformId[];
export declare function getPlatformSkillRoots(id: PlatformId): PlatformSkillRoot[];
export declare function getProjectSkillRoot(id: PlatformId): PlatformSkillRoot | null;
export declare function getInstallSkillRoots(): InstallSkillRoot[];
export declare function resolvePlatformSkillRootPath(root: PlatformSkillRoot, systemHomeDir: string, env?: NodeJS.ProcessEnv): string;
