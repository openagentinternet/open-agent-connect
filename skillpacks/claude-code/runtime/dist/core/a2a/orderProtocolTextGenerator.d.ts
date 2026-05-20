import type { ChatPersona } from '../chat/privateChatTypes';
import type { LlmExecutionRequest, LlmSessionRecord } from '../llm/executor';
import type { PublishedServiceRecord } from '../services/publishService';
import type { MetabotPaths } from '../state/paths';
export type ProviderOrderProtocolTextStage = 'acknowledgement' | 'rating_request';
export interface CallerOrderProtocolTextGeneratorInput {
    paths: MetabotPaths;
    persona: ChatPersona;
    callerName?: string | null;
    callerGlobalMetaId?: string | null;
    providerName?: string | null;
    providerGlobalMetaId?: string | null;
    serviceName?: string | null;
    providerSkill?: string | null;
    servicePinId?: string | null;
    rawRequest?: string | null;
    userTask?: string | null;
    taskContext?: string | null;
    paymentAmount?: string | null;
    paymentCurrency?: string | null;
    paymentTxid?: string | null;
    orderReference?: string | null;
    outputType?: string | null;
}
export interface ProviderOrderProtocolTextGeneratorInput {
    paths: MetabotPaths;
    persona: ChatPersona;
    providerName?: string | null;
    providerGlobalMetaId?: string | null;
    buyerGlobalMetaId?: string | null;
    service: PublishedServiceRecord;
    stage: ProviderOrderProtocolTextStage;
    orderTxid: string;
    paymentTxid?: string | null;
    orderReference?: string | null;
    paymentAmount?: string | null;
    paymentCurrency?: string | null;
    userTask?: string | null;
    taskContext?: string | null;
    responseText?: string | null;
}
export interface BuyerRatingProtocolTextGeneratorInput {
    paths: MetabotPaths;
    persona: ChatPersona;
    traceId: string;
    providerGlobalMetaId: string;
    providerName?: string | null;
    originalRequest?: string | null;
    serviceResult?: string | null;
    expectedOutputType?: string | null;
    ratingRequestText?: string | null;
}
export type CallerOrderProtocolTextGenerator = (input: CallerOrderProtocolTextGeneratorInput) => Promise<string | null | undefined>;
export type ProviderOrderProtocolTextGenerator = (input: ProviderOrderProtocolTextGeneratorInput) => Promise<string | null | undefined>;
export type BuyerRatingProtocolTextGenerator = (input: BuyerRatingProtocolTextGeneratorInput) => Promise<string | null | undefined>;
type LlmExecutorLike = {
    execute(request: LlmExecutionRequest): Promise<string>;
    getSession(sessionId: string): Promise<LlmSessionRecord | null>;
};
export declare function normalizeGeneratedOrderProtocolText(value: unknown, options?: {
    maxChars?: number;
    allowUrls?: boolean;
    allowTables?: boolean;
}): string;
export declare function createLlmOrderProtocolTextGenerator(options: {
    llmExecutor: LlmExecutorLike;
    timeoutMs?: number;
    pollIntervalMs?: number;
}): {
    generateCallerOrderText(input: CallerOrderProtocolTextGeneratorInput): Promise<string | null>;
    generateProviderOrderText(input: ProviderOrderProtocolTextGeneratorInput): Promise<string | null>;
    generateBuyerRatingText(input: BuyerRatingProtocolTextGeneratorInput): Promise<string | null>;
};
export declare function compactProtocolTextForFallback(value: unknown, maxChars?: number): string;
export {};
