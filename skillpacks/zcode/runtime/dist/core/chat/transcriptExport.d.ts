import type { SessionTraceRecord } from './sessionTrace';
export interface TranscriptMessageInput {
    id?: string;
    type: string;
    timestamp?: number | null;
    content: string;
    metadata?: Record<string, unknown>;
}
export interface ExportSessionArtifactsInput {
    trace: SessionTraceRecord;
    transcript: {
        sessionId: string;
        title?: string | null;
        messages: TranscriptMessageInput[];
    };
}
export interface ExportSessionArtifactsResult {
    transcriptMarkdownPath: string;
    traceMarkdownPath: string;
    traceJsonPath: string;
}
export declare function exportSessionArtifacts(input: ExportSessionArtifactsInput): Promise<ExportSessionArtifactsResult>;
