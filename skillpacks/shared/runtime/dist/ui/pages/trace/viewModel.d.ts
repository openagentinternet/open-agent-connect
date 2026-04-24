export interface TraceInspectorDefinitionRow {
    label: string;
    value: string;
}
export interface TraceInspectorTimelineItem {
    key: string;
    title: string;
    content: string;
    tone: 'active' | 'timeout' | 'manual' | 'clarification' | 'failure' | 'completed' | 'neutral';
    status?: string | null;
    timestamp?: number | null;
}
export interface TraceInspectorResultPanel {
    hasResult: boolean;
    summary: string;
    text: string;
    metaRows: TraceInspectorDefinitionRow[];
}
export interface TraceInspectorRatingPanel {
    status: 'not_requested' | 'requested' | 'sent' | 'publish_only' | 'delivery_failed';
    summary: string;
    requestText: string;
    commentText: string;
    metaRows: TraceInspectorDefinitionRow[];
}
export interface TraceInspectorViewModel {
    transcriptItems: TraceInspectorTimelineItem[];
    statusItems: TraceInspectorTimelineItem[];
    resultPanel: TraceInspectorResultPanel;
    ratingPanel: TraceInspectorRatingPanel;
}
export declare function buildTraceInspectorViewModel(input: {
    trace?: Record<string, unknown> | null;
    inspector?: Record<string, unknown> | null;
}): TraceInspectorViewModel;
