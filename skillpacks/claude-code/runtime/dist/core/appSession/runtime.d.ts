/**
 * Resident App/Game Runtime (docs/06, docs/09). The daemon owns session
 * state, task-level grants, leases/fencing, message catch-up, the adapter
 * action loop, LLM calls and chain writes. MetaApps only control sessions via
 * `browser.app.session.*`; closing the page does not stop the runtime.
 */
import { type AppSessionError, type AppSessionPersistedState, type AppSessionPublic, type AppSessionRuntimeStartReport, type AppSessionStartParams, type AppSessionStatus, type GroupChatMessage, type LoadedGamePackage } from './types';
export interface SandboxedAdapterHandle {
    call<T = unknown>(method: string, args?: unknown[]): Promise<T>;
    hasExport(name: string): Promise<boolean>;
    dispose(): void;
}
export type AdapterSandboxFactory = (input: {
    adapterCode: string;
    adapterHash: string;
}) => SandboxedAdapterHandle;
export interface AgentGameRuntimeInput {
    store: {
        load(): Promise<AppSessionPersistedState | null>;
        save(state: AppSessionPersistedState): Promise<void>;
    };
    fetchGroupMessages(input: {
        groupId: string;
        startIndex: number;
        size?: number;
    }): Promise<GroupChatMessage[]>;
    loadGamePackage(input: {
        manifestUri: string;
    }): Promise<LoadedGamePackage>;
    createAdapterSandbox?: AdapterSandboxFactory;
    llmComplete(input: {
        actorId: string;
        messages: Array<{
            role: 'system' | 'user' | 'assistant';
            content: string;
        }>;
    }): Promise<{
        text: string;
        model?: string;
    }>;
    writeGroupChat(input: {
        actorId: string;
        groupId: string;
        payload: Record<string, unknown>;
    }): Promise<{
        ok: true;
        pinId?: string;
    } | {
        ok: false;
        code?: string;
        message?: string;
    }>;
    audit?(event: Record<string, unknown>): Promise<void> | void;
    now?(): number;
    logger?(...args: unknown[]): void;
    leaseTtlMs?: number;
    heartbeatIntervalMs?: number;
    llmRetryBaseMs?: number;
    llmRetryMaxMs?: number;
    maxLlmAttempts?: number;
    writeRetryBaseMs?: number;
    writeRetryMaxMs?: number;
    maxWriteAttempts?: number;
}
export interface AppSessionActorBinding {
    actorId: string;
    actorGlobalMetaId: string;
    resourceUri: string;
}
export interface AppSessionListFilter {
    appId?: string;
    status?: AppSessionStatus;
    groupId?: string;
}
export interface AgentGameRuntime {
    validateStart(input: AppSessionStartParams & AppSessionActorBinding): Promise<{
        ok: true;
        adapterHash: string;
    } | {
        ok: false;
        error: AppSessionError;
    }>;
    start(input: AppSessionStartParams & AppSessionActorBinding): Promise<AppSessionPublic>;
    list(input: AppSessionActorBinding & AppSessionListFilter): Promise<AppSessionPublic[]>;
    status(sessionId: string, actor: AppSessionActorBinding): Promise<AppSessionPublic>;
    pause(sessionId: string, actor: AppSessionActorBinding): Promise<AppSessionPublic>;
    resume(sessionId: string, actor: AppSessionActorBinding): Promise<AppSessionPublic>;
    stop(sessionId: string, actor: AppSessionActorBinding, options?: {
        releaseSeat?: boolean;
    }): Promise<AppSessionPublic>;
    notifyGroupActivity(groupId: string): void;
    startRuntime(): Promise<AppSessionRuntimeStartReport>;
    dispose(): Promise<void>;
}
export declare function createAgentGameRuntime(input: AgentGameRuntimeInput): AgentGameRuntime;
