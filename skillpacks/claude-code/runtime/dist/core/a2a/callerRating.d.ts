import type { ChatPersona, ChatReplyRunner } from '../chat/privateChatTypes';
export interface BuyerRatingTranscriptItem {
    id?: string | null;
    timestamp?: number | null;
    type?: string | null;
    sender?: 'caller' | 'provider' | 'system' | string | null;
    content?: string | null;
    metadata?: Record<string, unknown> | null;
}
export interface BuyerServiceRatingResult {
    rate: number;
    comment: string;
}
export declare function extractBuyerRatingScore(value: string): number;
export declare function generateBuyerServiceRating(input: {
    replyRunner: ChatReplyRunner;
    persona: ChatPersona;
    traceId: string;
    providerGlobalMetaId: string;
    providerName?: string | null;
    originalRequest?: string | null;
    serviceResult?: string | null;
    expectedOutputType?: string | null;
    ratingRequestText?: string | null;
    transcriptItems: BuyerRatingTranscriptItem[];
    now?: number;
}): Promise<BuyerServiceRatingResult>;
