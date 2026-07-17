export type HostPersonaProjectionState = 'unbound' | 'current' | 'stale' | 'conflict';
export interface HostPersonaProjectionInput {
    systemHomeDir: string;
    host: 'codex';
    from?: string;
    env?: NodeJS.ProcessEnv;
}
export interface HostPersonaProjectionResult {
    host: 'codex';
    profile: {
        name: string;
        slug: string;
        homeDir: string;
    };
    agentName: string;
    agentFilePath: string;
    sourceFiles: string[];
    state: HostPersonaProjectionState;
}
export interface BindHostPersonaProjectionResult extends HostPersonaProjectionResult {
    action: 'created' | 'updated' | 'unchanged';
}
export interface UnbindHostPersonaProjectionResult extends HostPersonaProjectionResult {
    removed: boolean;
}
export declare class HostPersonaProjectionError extends Error {
    code: 'identity_profile_not_found' | 'identity_profile_ambiguous' | 'active_identity_missing' | 'host_persona_source_missing' | 'host_persona_conflict' | 'host_persona_projection_failed';
    data: Record<string, unknown>;
    constructor(code: HostPersonaProjectionError['code'], message: string, data?: Record<string, unknown>);
}
export declare function getHostPersonaProjectionStatus(input: HostPersonaProjectionInput): Promise<HostPersonaProjectionResult>;
export declare function bindHostPersonaProjection(input: HostPersonaProjectionInput): Promise<BindHostPersonaProjectionResult>;
export declare function unbindHostPersonaProjection(input: HostPersonaProjectionInput): Promise<UnbindHostPersonaProjectionResult>;
