import type { PublicStatus } from '../a2a/publicStatus';
import type { SessionTraceRecord } from '../chat/sessionTrace';

export type MasterTraceCanonicalStatus =
  | 'discovered'
  | 'suggested'
  | 'awaiting_confirmation'
  | 'requesting_remote'
  | 'remote_received'
  | 'master_responded'
  | 'completed'
  | 'timed_out'
  | 'failed'
  | 'need_more_context';

export interface AskMasterTracePreviewSummary {
  userTask: string | null;
  question: string | null;
}

export interface AskMasterTraceResponseSummary {
  status: string | null;
  summary: string | null;
  followUpQuestion: string | null;
}

export interface AskMasterTraceFailureSummary {
  code: string | null;
  message: string | null;
}

export interface AskMasterTraceMetadata {
  flow: 'master';
  transport: 'simplemsg';
  canonicalStatus: MasterTraceCanonicalStatus | null;
  triggerMode: string | null;
  contextMode: string | null;
  confirmationMode: string | null;
  requestId: string | null;
  masterKind: string | null;
  servicePinId: string | null;
  providerGlobalMetaId: string | null;
  displayName: string | null;
  preview: AskMasterTracePreviewSummary | null;
  response: AskMasterTraceResponseSummary | null;
  failure: AskMasterTraceFailureSummary | null;
}

export interface BuildMasterTraceMetadataInput {
  role?: string | null;
  canonicalStatus?: MasterTraceCanonicalStatus | string | null;
  latestEvent?: string | null;
  publicStatus?: PublicStatus | string | null;
  transport?: string | null;
  triggerMode?: string | null;
  contextMode?: string | null;
  confirmationMode?: string | null;
  requestId?: string | null;
  masterKind?: string | null;
  servicePinId?: string | null;
  providerGlobalMetaId?: string | null;
  displayName?: string | null;
  preview?: {
    userTask?: string | null;
    question?: string | null;
  } | null;
  response?: {
    status?: string | null;
    summary?: string | null;
    followUpQuestion?: string | null;
  } | null;
  failure?: {
    code?: string | null;
    message?: string | null;
  } | null;
}

export interface MasterTraceView {
  traceId: string;
  flow: 'master';
  transport: 'simplemsg';
  role: string | null;
  displayName: string | null;
  masterKind: string | null;
  providerGlobalMetaId: string | null;
  servicePinId: string | null;
  requestId: string | null;
  canonicalStatus: MasterTraceCanonicalStatus | null;
  latestEvent: string | null;
  triggerMode: string | null;
  contextMode: string | null;
  confirmationMode: string | null;
  preview: AskMasterTracePreviewSummary | null;
  response: AskMasterTraceResponseSummary | null;
  failure: AskMasterTraceFailureSummary | null;
  display: {
    title: string;
    statusText: string;
  };
  artifacts: SessionTraceRecord['artifacts'];
  trace: SessionTraceRecord;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNullableText(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizePreview(
  value: BuildMasterTraceMetadataInput['preview'] | AskMasterTraceMetadata['preview']
): AskMasterTracePreviewSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const preview = {
    userTask: normalizeNullableText(value.userTask),
    question: normalizeNullableText(value.question),
  };

  return preview.userTask || preview.question ? preview : null;
}

function normalizeResponse(
  value: BuildMasterTraceMetadataInput['response'] | AskMasterTraceMetadata['response']
): AskMasterTraceResponseSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const response = {
    status: normalizeNullableText(value.status),
    summary: normalizeNullableText(value.summary),
    followUpQuestion: normalizeNullableText(value.followUpQuestion),
  };

  return response.status || response.summary || response.followUpQuestion ? response : null;
}

function normalizeFailure(
  value: BuildMasterTraceMetadataInput['failure'] | AskMasterTraceMetadata['failure']
): AskMasterTraceFailureSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const failure = {
    code: normalizeNullableText(value.code),
    message: normalizeNullableText(value.message),
  };

  return failure.code || failure.message ? failure : null;
}

function isCanonicalStatus(value: string): value is MasterTraceCanonicalStatus {
  return value === 'discovered'
    || value === 'suggested'
    || value === 'awaiting_confirmation'
    || value === 'requesting_remote'
    || value === 'remote_received'
    || value === 'master_responded'
    || value === 'completed'
    || value === 'timed_out'
    || value === 'failed'
    || value === 'need_more_context';
}

function mapLatestEventToCanonicalStatus(event: string): MasterTraceCanonicalStatus | null {
  if (event === 'master_preview_ready') return 'awaiting_confirmation';
  if (event === 'request_sent') return 'requesting_remote';
  if (event === 'provider_received') return 'remote_received';
  if (event === 'provider_completed') return 'completed';
  if (event === 'timeout') return 'timed_out';
  if (event === 'provider_failed' || event === 'provider_delivery_failed') return 'failed';
  if (event === 'clarification_needed') return 'need_more_context';
  return null;
}

function mapPublicStatusToCanonicalStatus(status: string): MasterTraceCanonicalStatus | null {
  if (status === 'discovered') return 'discovered';
  if (status === 'awaiting_confirmation') return 'awaiting_confirmation';
  if (status === 'requesting_remote' || status === 'remote_executing') return 'requesting_remote';
  if (status === 'remote_received') return 'remote_received';
  if (status === 'completed') return 'completed';
  if (status === 'timeout') return 'timed_out';
  if (status === 'remote_failed' || status === 'local_runtime_error' || status === 'network_unavailable') {
    return 'failed';
  }
  if (status === 'manual_action_required') return 'need_more_context';
  return null;
}

function resolveCanonicalStatus(input: BuildMasterTraceMetadataInput): MasterTraceCanonicalStatus | null {
  const explicit = normalizeText(input.canonicalStatus);
  if (explicit && isCanonicalStatus(explicit)) {
    return explicit;
  }

  const latestEvent = normalizeText(input.latestEvent);
  const eventStatus = latestEvent ? mapLatestEventToCanonicalStatus(latestEvent) : null;
  if (eventStatus) {
    return eventStatus;
  }

  const publicStatus = normalizeText(input.publicStatus);
  return publicStatus ? mapPublicStatusToCanonicalStatus(publicStatus) : null;
}

function inferMasterDisplayName(trace: SessionTraceRecord): string | null {
  const sessionTitle = normalizeText(trace.session.title);
  if (sessionTitle.endsWith(' Ask')) {
    return sessionTitle.slice(0, -' Ask'.length).trim() || null;
  }

  return normalizeNullableText(trace.askMaster?.displayName)
    || normalizeNullableText(trace.a2a?.providerName)
    || normalizeNullableText(trace.session.peerName);
}

function inferMasterTraceMetadata(trace: SessionTraceRecord): AskMasterTraceMetadata | null {
  const externalConversationId = normalizeText(trace.session.externalConversationId);
  if (normalizeText(trace.askMaster?.flow) === 'master') {
    return buildMasterTraceMetadata({
      role: trace.a2a?.role,
      canonicalStatus: trace.askMaster?.canonicalStatus,
      latestEvent: trace.a2a?.latestEvent,
      publicStatus: trace.a2a?.publicStatus,
      transport: trace.askMaster?.transport,
      triggerMode: trace.askMaster?.triggerMode,
      contextMode: trace.askMaster?.contextMode,
      confirmationMode: trace.askMaster?.confirmationMode,
      requestId: trace.askMaster?.requestId,
      masterKind: trace.askMaster?.masterKind,
      servicePinId: trace.askMaster?.servicePinId ?? trace.a2a?.servicePinId,
      providerGlobalMetaId: trace.askMaster?.providerGlobalMetaId ?? trace.a2a?.providerGlobalMetaId,
      displayName: trace.askMaster?.displayName ?? inferMasterDisplayName(trace),
      preview: trace.askMaster?.preview,
      response: trace.askMaster?.response,
      failure: trace.askMaster?.failure,
    });
  }

  if (!externalConversationId.startsWith('master:')) {
    return null;
  }

  return buildMasterTraceMetadata({
    role: trace.a2a?.role,
    latestEvent: trace.a2a?.latestEvent,
    publicStatus: trace.a2a?.publicStatus,
    servicePinId: trace.a2a?.servicePinId,
    providerGlobalMetaId: trace.a2a?.providerGlobalMetaId ?? trace.session.peerGlobalMetaId,
    displayName: inferMasterDisplayName(trace),
  });
}

export function buildMasterTraceMetadata(input: BuildMasterTraceMetadataInput): AskMasterTraceMetadata {
  return {
    flow: 'master',
    transport: 'simplemsg',
    canonicalStatus: resolveCanonicalStatus(input),
    triggerMode: normalizeNullableText(input.triggerMode),
    contextMode: normalizeNullableText(input.contextMode),
    confirmationMode: normalizeNullableText(input.confirmationMode),
    requestId: normalizeNullableText(input.requestId),
    masterKind: normalizeNullableText(input.masterKind),
    servicePinId: normalizeNullableText(input.servicePinId),
    providerGlobalMetaId: normalizeNullableText(input.providerGlobalMetaId),
    displayName: normalizeNullableText(input.displayName),
    preview: normalizePreview(input.preview),
    response: normalizeResponse(input.response),
    failure: normalizeFailure(input.failure),
  };
}

export function isAskMasterTrace(trace: SessionTraceRecord | null | undefined): boolean {
  return Boolean(trace && inferMasterTraceMetadata(trace));
}

function renderStatusText(status: MasterTraceCanonicalStatus | null): string {
  if (status === 'awaiting_confirmation') return 'Waiting for your confirmation';
  if (status === 'requesting_remote') return 'Request sent to Master';
  if (status === 'remote_received') return 'Master received the request';
  if (status === 'master_responded') return 'Master has responded';
  if (status === 'completed') return 'Completed';
  if (status === 'timed_out') return 'Stopped waiting locally';
  if (status === 'failed') return 'Failed';
  if (status === 'need_more_context') return 'Need more context';
  if (status === 'suggested') return 'Suggested';
  if (status === 'discovered') return 'Discovered';
  return 'Unknown status';
}

export function buildMasterTraceView(trace: SessionTraceRecord): MasterTraceView | null {
  const askMaster = inferMasterTraceMetadata(trace);
  if (!askMaster) {
    return null;
  }

  const displayName = askMaster.displayName || inferMasterDisplayName(trace);
  const title = normalizeNullableText(trace.session.title)
    || (displayName ? `${displayName} Ask` : `Ask Master ${trace.traceId}`);

  return {
    traceId: trace.traceId,
    flow: 'master',
    transport: 'simplemsg',
    role: normalizeNullableText(trace.a2a?.role),
    displayName,
    masterKind: askMaster.masterKind,
    providerGlobalMetaId: askMaster.providerGlobalMetaId,
    servicePinId: askMaster.servicePinId,
    requestId: askMaster.requestId,
    canonicalStatus: askMaster.canonicalStatus,
    latestEvent: normalizeNullableText(trace.a2a?.latestEvent),
    triggerMode: askMaster.triggerMode,
    contextMode: askMaster.contextMode,
    confirmationMode: askMaster.confirmationMode,
    preview: askMaster.preview,
    response: askMaster.response,
    failure: askMaster.failure,
    display: {
      title,
      statusText: renderStatusText(askMaster.canonicalStatus),
    },
    artifacts: trace.artifacts,
    trace: {
      ...trace,
      askMaster,
    },
  };
}
