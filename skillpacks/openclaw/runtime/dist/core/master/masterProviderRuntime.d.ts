import { type A2ASessionEngine, type ClarificationMutation, type SessionEngineMutation } from '../a2a/sessionEngine';
import { type MasterRequestMessage, type MasterResponseMessage, type MasterResponseStatus } from './masterMessageSchema';
import { type PublishedMasterRecord } from './masterTypes';
export interface MasterProviderIdentity {
    globalMetaId: string;
    name?: string | null;
}
export interface MasterRunnerInput {
    request: MasterRequestMessage;
    publishedMaster: PublishedMasterRecord;
    providerIdentity: MasterProviderIdentity;
}
export interface MasterRunnerCompletedResult {
    state: 'completed';
    summary: string;
    findings: string[];
    recommendations: string[];
    risks: string[];
    confidence: number | null;
    followUpQuestion?: string | null;
    responseText?: string | null;
    metadata?: Record<string, unknown> | null;
}
export interface MasterRunnerNeedMoreContextResult {
    state: 'need_more_context';
    summary: string;
    missing: string[];
    followUpQuestion: string;
    risks?: string[];
    metadata?: Record<string, unknown> | null;
}
export interface MasterRunnerDeclinedResult {
    state: 'declined';
    reason: string;
    risks?: string[];
    followUpQuestion?: string | null;
    metadata?: Record<string, unknown> | null;
}
export interface MasterRunnerFailedResult {
    state: 'failed';
    code: string;
    message: string;
    metadata?: Record<string, unknown> | null;
}
export type MasterRunnerResult = MasterRunnerCompletedResult | MasterRunnerNeedMoreContextResult | MasterRunnerDeclinedResult | MasterRunnerFailedResult;
export type MasterRunner = (input: MasterRunnerInput) => MasterRunnerResult | Promise<MasterRunnerResult>;
export interface MasterProviderTraceSummary {
    flow: 'master';
    servicePinId: string;
    masterKind: string;
    requestId: string;
    requestStatus: MasterResponseStatus;
}
export interface HandleMasterProviderRequestSuccess {
    ok: true;
    request: MasterRequestMessage;
    publishedMaster: PublishedMasterRecord;
    received: SessionEngineMutation;
    applied: SessionEngineMutation | ClarificationMutation;
    runnerResult: MasterRunnerResult;
    response: MasterResponseMessage;
    responseJson: string;
    traceSummary: MasterProviderTraceSummary;
}
export interface HandleMasterProviderRequestFailure {
    ok: false;
    code: string;
    message: string;
}
export type HandleMasterProviderRequestResult = HandleMasterProviderRequestSuccess | HandleMasterProviderRequestFailure;
export interface HandleMasterProviderRequestInput {
    rawRequest: unknown;
    providerIdentity: MasterProviderIdentity;
    publishedMasters: PublishedMasterRecord[];
    sessionEngine?: A2ASessionEngine;
    resolveRunner?: (input: MasterRunnerInput) => MasterRunner | null;
}
export declare function handleMasterProviderRequest(input: HandleMasterProviderRequestInput): Promise<HandleMasterProviderRequestResult>;
