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

export function buildTraceInspectorViewModel(input: {
  trace?: Record<string, unknown> | null;
  inspector?: Record<string, unknown> | null;
}): TraceInspectorViewModel {
  const normalizeText = (value: unknown): string =>
    typeof value === 'string' ? value.trim() : '';
  const normalizeTimestamp = (value: unknown): number | null => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }
    if (value >= 1_000_000_000 && value < 1_000_000_000_000) {
      return value * 1000;
    }
    return value;
  };
  const coerceObject = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  const coerceArray = (value: unknown): Array<Record<string, unknown>> =>
    Array.isArray(value)
      ? value.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry)) as Array<Record<string, unknown>>
      : [];
  const pushRow = (
    rows: TraceInspectorDefinitionRow[],
    label: string,
    value: unknown,
  ) => {
    const normalized = typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : normalizeText(value);
    if (!normalized) {
      return;
    }
    rows.push({ label, value: normalized });
  };

  const trace = coerceObject(input.trace) ?? {};
  const inspector = coerceObject(input.inspector) ?? {};
  const transcriptItemsRaw = coerceArray(inspector.transcriptItems)
    .slice()
    .sort((left, right) => {
      const leftTime = normalizeTimestamp(left.timestamp) ?? 0;
      const rightTime = normalizeTimestamp(right.timestamp) ?? 0;
      return leftTime - rightTime;
    });
  const transcriptSeen = new Set<string>();
  const transcriptItems: TraceInspectorTimelineItem[] = [];

  for (const item of transcriptItemsRaw) {
    const key = [
      normalizeText(item.id),
      normalizeTimestamp(item.timestamp) ?? '',
      normalizeText(item.content),
    ].join('|');
    if (!key || transcriptSeen.has(key)) {
      continue;
    }
    transcriptSeen.add(key);
    const type = normalizeText(item.type);
    const sender = normalizeText(item.sender);
    const tone = type === 'clarification_request'
      ? 'clarification'
      : type === 'failure'
        ? 'failure'
        : sender === 'system'
          ? 'manual'
          : sender === 'provider'
            ? 'completed'
            : 'active';
    transcriptItems.push({
      key,
      title: `[${sender || 'system'}] ${type || 'message'}`,
      content: normalizeText(item.content),
      tone,
      timestamp: normalizeTimestamp(item.timestamp),
    });
  }

  const snapshotsRaw = coerceArray(inspector.publicStatusSnapshots)
    .slice()
    .sort((left, right) => {
      const leftTime = normalizeTimestamp(left.resolvedAt) ?? 0;
      const rightTime = normalizeTimestamp(right.resolvedAt) ?? 0;
      return leftTime - rightTime;
    });
  const snapshotSeen = new Set<string>();
  const statusItems: TraceInspectorTimelineItem[] = [];

  for (const snapshot of snapshotsRaw) {
    const status = normalizeText(snapshot.status) || 'pending';
    const resolvedAt = normalizeTimestamp(snapshot.resolvedAt);
    const key = [
      normalizeText(snapshot.sessionId),
      normalizeText(snapshot.taskRunId),
      status,
      resolvedAt ?? '',
    ].join('|');
    if (!key || snapshotSeen.has(key)) {
      continue;
    }
    snapshotSeen.add(key);
    const tone = status === 'timeout'
      ? 'timeout'
      : status === 'manual_action_required'
        ? 'manual'
        : status === 'remote_failed'
          ? 'failure'
          : status === 'completed'
            ? 'completed'
            : status === 'remote_received' || status === 'remote_executing' || status === 'requesting_remote'
              ? 'active'
              : 'neutral';
    statusItems.push({
      key,
      title: status,
      content: normalizeText(snapshot.rawEvent)
        ? `Mapped from ${normalizeText(snapshot.rawEvent)}`
        : 'Derived from daemon session state.',
      tone,
      status,
      timestamp: resolvedAt,
    });
  }

  let derivedResultText = normalizeText(trace.resultText);
  let derivedResultObservedAt = normalizeTimestamp(trace.resultObservedAt);
  let derivedResultDeliveryPinId = normalizeText(trace.resultDeliveryPinId);
  let ratingCommentText = normalizeText(trace.ratingComment);
  let ratingRate = typeof trace.ratingValue === 'number' && Number.isFinite(trace.ratingValue)
    ? String(trace.ratingValue)
    : normalizeText(trace.ratingValue);
  let ratingPinId = normalizeText(trace.ratingPinId);
  let ratingMessagePinId = normalizeText(trace.ratingMessagePinId);
  let ratingMessageError = normalizeText(trace.ratingMessageError);
  let ratingMessageSent: boolean | null = typeof trace.ratingMessageSent === 'boolean'
    ? trace.ratingMessageSent
    : null;
  const ratingRequested = trace.ratingRequested === true || Boolean(normalizeText(trace.ratingRequestText));
  let ratingPublished = trace.ratingPublished === true || Boolean(ratingPinId || ratingCommentText);

  for (let index = transcriptItemsRaw.length - 1; index >= 0; index -= 1) {
    const item = transcriptItemsRaw[index];
    const metadata = coerceObject(item.metadata) ?? {};
    const sender = normalizeText(item.sender);
    const type = normalizeText(item.type);
    const content = normalizeText(item.content);
    if (!derivedResultText && sender === 'provider' && type === 'assistant' && content) {
      derivedResultText = content;
      derivedResultObservedAt = normalizeTimestamp(item.timestamp);
      derivedResultDeliveryPinId = normalizeText(metadata.deliveryPinId);
    }
    const metadataEvent = normalizeText(metadata.event);
    if (!ratingCommentText && (
      type === 'rating'
      || metadataEvent === 'service_rating_message_sent'
      || metadataEvent === 'service_rating_message_failed'
    )) {
      ratingCommentText = content;
      ratingRate = normalizeText(metadata.rate);
      ratingPinId = normalizeText(metadata.ratingPinId);
      ratingMessagePinId = normalizeText(metadata.ratingMessagePinId);
      ratingMessageError = normalizeText(metadata.ratingMessageError);
      if (typeof metadata.ratingMessageSent === 'boolean') {
        ratingMessageSent = metadata.ratingMessageSent;
      }
    }
    if (!ratingPublished && (type === 'rating' || metadataEvent === 'service_rating_published')) {
      ratingPublished = Boolean(
        content
        || normalizeText(metadata.ratingPinId)
      );
    }
  }

  const resultMetaRows: TraceInspectorDefinitionRow[] = [];
  pushRow(resultMetaRows, 'Observed At', derivedResultObservedAt);
  pushRow(resultMetaRows, 'Delivery Pin', derivedResultDeliveryPinId);
  const order = coerceObject(trace.order) ?? {};
  pushRow(resultMetaRows, 'Payment TXID', order.paymentTxid);
  const paidAmount = normalizeText(order.paymentAmount);
  const paidCurrency = normalizeText(order.paymentCurrency);
  if (paidAmount || paidCurrency) {
    pushRow(resultMetaRows, 'Paid', [paidAmount, paidCurrency].filter(Boolean).join(' '));
  }
  pushRow(resultMetaRows, 'Service', order.serviceName);

  const ratingRequestText = normalizeText(trace.ratingRequestText);
  const ratingRequestedAt = normalizeTimestamp(trace.ratingRequestedAt);
  const tStageCompleted = trace.tStageCompleted === true || ratingPublished;
  const ratingMetaRows: TraceInspectorDefinitionRow[] = [];
  if (tStageCompleted) {
    pushRow(ratingMetaRows, 'T-Stage', 'Complete');
  }
  pushRow(ratingMetaRows, 'Requested At', ratingRequestedAt);
  pushRow(ratingMetaRows, 'Rating', ratingRate);
  pushRow(ratingMetaRows, 'Rating Pin', ratingPinId);
  if (ratingMessageSent) {
    pushRow(ratingMetaRows, 'Provider Message', ratingMessagePinId);
  } else if (ratingMessageError) {
    pushRow(ratingMetaRows, 'Provider Delivery Error', ratingMessageError);
  }

  const ratingStatus: TraceInspectorRatingPanel['status'] = tStageCompleted && ratingMessageSent
    ? 'sent'
    : tStageCompleted
      ? 'publish_only'
      : ratingRequested || ratingRequestText
          ? 'requested'
          : 'not_requested';
  const ratingSummary = ratingStatus === 'sent'
    ? 'DACT T-stage is complete. Buyer-side rating was published and the provider follow-up message was delivered.'
    : ratingStatus === 'publish_only'
      ? 'DACT T-stage is complete. Buyer-side rating was published on-chain, but provider follow-up delivery was not confirmed.'
        : ratingStatus === 'requested'
          ? 'The remote MetaBot requested a DACT T-stage rating, but no buyer follow-up is stored yet.'
          : 'No rating follow-up is stored for this trace.';

  return {
    transcriptItems,
    statusItems,
    resultPanel: {
      hasResult: Boolean(derivedResultText),
      summary: derivedResultText
        ? 'Showing the verbatim result returned by the remote MetaBot.'
        : 'No remote result has been captured yet for this trace.',
      text: derivedResultText || 'Waiting for the remote MetaBot to return a result.',
      metaRows: resultMetaRows,
    },
    ratingPanel: {
      status: ratingStatus,
      summary: ratingSummary,
      requestText: ratingRequestText,
      commentText: ratingCommentText,
      metaRows: ratingMetaRows,
    },
  };
}
