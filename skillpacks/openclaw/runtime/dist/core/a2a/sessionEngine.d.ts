import type { A2ASessionRecord, A2ATaskRunRecord } from './sessionTypes';
import type { ProviderServiceRunnerResult } from './provider/serviceRunnerContracts';
export interface A2ASessionLinkage {
    coworkSessionId: string | null;
    externalConversationId: string;
}
export interface StartCallerSessionInput {
    traceId: string;
    servicePinId: string;
    callerGlobalMetaId: string;
    providerGlobalMetaId: string;
    userTask: string;
    taskContext: string;
}
export interface ReceiveProviderTaskInput {
    traceId: string;
    servicePinId: string;
    callerGlobalMetaId: string;
    providerGlobalMetaId: string;
    userTask: string;
    taskContext: string;
}
export interface ApplyProviderRunnerResultInput {
    session: A2ASessionRecord;
    taskRun: A2ATaskRunRecord;
    result: ProviderServiceRunnerResult;
}
export interface AnswerClarificationInput {
    session: A2ASessionRecord;
    taskRun: A2ATaskRunRecord;
    answer: string;
}
export type A2ASessionEngineEvent = 'request_sent' | 'provider_received' | 'provider_executing' | 'provider_completed' | 'timeout' | 'provider_failed' | 'clarification_needed';
export interface SessionEngineMutation {
    session: A2ASessionRecord;
    taskRun: A2ATaskRunRecord;
    event: A2ASessionEngineEvent;
    runnerResult: ProviderServiceRunnerResult | null;
}
export interface CallerSessionStarted extends SessionEngineMutation {
    linkage: A2ASessionLinkage;
}
export interface ClarificationMutation extends SessionEngineMutation {
    accepted: boolean;
    guardCode: string | null;
}
export interface A2ASessionEngineOptions {
    now?: () => number;
    createSessionId?: () => string;
    createTaskRunId?: () => string;
}
export interface A2ASessionEngine {
    buildSessionLinkage(input: {
        providerGlobalMetaId: string;
        traceId: string;
        sessionId?: string | null;
    }): A2ASessionLinkage;
    startCallerSession(input: StartCallerSessionInput): CallerSessionStarted;
    markForegroundTimeout(input: {
        session: A2ASessionRecord;
        taskRun: A2ATaskRunRecord;
    }): SessionEngineMutation;
    receiveProviderTask(input: ReceiveProviderTaskInput): SessionEngineMutation;
    applyProviderRunnerResult(input: ApplyProviderRunnerResultInput): ClarificationMutation | SessionEngineMutation;
    answerClarification(input: AnswerClarificationInput): ClarificationMutation;
}
export declare function createA2ASessionEngine(options?: A2ASessionEngineOptions): A2ASessionEngine;
