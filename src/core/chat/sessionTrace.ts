import path from 'node:path';
import type { PublicStatus } from '../a2a/publicStatus';
import type { A2ASessionRole, A2ATaskRunState } from '../a2a/sessionTypes';
import type { AskMasterTraceMetadata } from '../master/masterTrace';

export interface SessionTraceSessionInput {
  id: string;
  title?: string | null;
  type?: string | null;
  metabotId?: number | null;
  peerGlobalMetaId?: string | null;
  peerName?: string | null;
  externalConversationId?: string | null;
}

export interface SessionTraceOrderInput {
  id?: string | null;
  role?: string | null;
  serviceId?: string | null;
  serviceName?: string | null;
  orderPinId?: string | null;
  orderTxid?: string | null;
  orderTxids?: string[] | null;
  paymentTxid?: string | null;
  paymentCommitTxid?: string | null;
  orderReference?: string | null;
  paymentCurrency?: string | null;
  paymentAmount?: string | null;
  paymentChain?: string | null;
  settlementKind?: string | null;
  mrc20Ticker?: string | null;
  mrc20Id?: string | null;
  providerSkill?: string | null;
  outputType?: string | null;
  requestText?: string | null;
  status?: string | null;
  failedAt?: number | null;
  failureReason?: string | null;
  refundRequestPinId?: string | null;
  refundRequestTxid?: string | null;
  refundRequestedAt?: number | null;
  refundCompletedAt?: number | null;
  refundApplyRetryCount?: number | null;
  nextRetryAt?: number | null;
  refundTxid?: string | null;
  refundedAt?: number | null;
  updatedAt?: number | null;
}

export interface BuildSessionTraceInput {
  traceId: string;
  channel: string;
  exportRoot: string;
  createdAt?: number;
  session: SessionTraceSessionInput;
  order?: SessionTraceOrderInput | null;
  a2a?: SessionTraceA2AInput | null;
  providerRuntime?: SessionTraceProviderRuntimeInput | null;
  askMaster?: SessionTraceAskMasterInput | null;
}

export interface SessionTraceProviderRuntimeInput {
  runtimeId?: string | null;
  runtimeProvider?: string | null;
  sessionId?: string | null;
  providerSkill?: string | null;
  fallbackSelected?: boolean | null;
}

export interface SessionTraceArtifacts {
  transcriptMarkdownPath: string;
  traceMarkdownPath: string;
  traceJsonPath: string;
}

export interface SessionTraceA2AInput {
  sessionId?: string | null;
  taskRunId?: string | null;
  role?: A2ASessionRole | string | null;
  publicStatus?: PublicStatus | string | null;
  latestEvent?: string | null;
  taskRunState?: A2ATaskRunState | string | null;
  callerGlobalMetaId?: string | null;
  callerName?: string | null;
  providerGlobalMetaId?: string | null;
  providerName?: string | null;
  servicePinId?: string | null;
}

export interface SessionTraceA2ARecord {
  sessionId: string | null;
  taskRunId: string | null;
  role: string | null;
  publicStatus: string | null;
  latestEvent: string | null;
  taskRunState: string | null;
  callerGlobalMetaId: string | null;
  callerName: string | null;
  providerGlobalMetaId: string | null;
  providerName: string | null;
  servicePinId: string | null;
}

export interface SessionTraceProviderRuntimeRecord {
  runtimeId: string | null;
  runtimeProvider: string | null;
  sessionId: string | null;
  providerSkill: string | null;
  fallbackSelected: boolean | null;
}

export interface SessionTraceAskMasterInput extends AskMasterTraceMetadata {}

export interface SessionTraceAskMasterRecord {
  flow: 'master';
  transport: string | null;
  canonicalStatus: string | null;
  triggerMode: string | null;
  contextMode: string | null;
  confirmationMode: string | null;
  requestId: string | null;
  masterKind: string | null;
  servicePinId: string | null;
  providerGlobalMetaId: string | null;
  displayName: string | null;
  preview: {
    userTask: string | null;
    question: string | null;
  } | null;
  response: {
    status: string | null;
    summary: string | null;
    followUpQuestion: string | null;
    errorCode: string | null;
  } | null;
  failure: {
    code: string | null;
    message: string | null;
  } | null;
  auto: {
    reason: string | null;
    confidence: number | null;
    frictionMode: 'preview_confirm' | 'direct_send' | null;
    detectorVersion: string | null;
    selectedMasterTrusted: boolean | null;
    sensitivity: {
      isSensitive: boolean;
      reasons: string[];
    } | null;
  } | null;
}

export interface SessionTraceRecord {
  traceId: string;
  channel: string;
  createdAt: number;
  session: {
    id: string;
    title: string | null;
    type: string | null;
    metabotId: number | null;
    peerGlobalMetaId: string | null;
    peerName: string | null;
    externalConversationId: string | null;
  };
  order: {
    id: string | null;
    role: string | null;
    serviceId: string | null;
    serviceName: string | null;
    orderPinId: string | null;
    orderTxid: string | null;
    orderTxids: string[];
    paymentTxid: string | null;
    paymentCommitTxid: string | null;
    orderReference: string | null;
    paymentCurrency: string | null;
    paymentAmount: string | null;
    paymentChain: string | null;
    settlementKind: string | null;
    mrc20Ticker: string | null;
    mrc20Id: string | null;
    providerSkill?: string | null;
    outputType: string | null;
    requestText: string | null;
    status: string | null;
    failedAt: number | null;
    failureReason: string | null;
    refundRequestPinId: string | null;
    refundRequestTxid: string | null;
    refundRequestedAt: number | null;
    refundCompletedAt: number | null;
    refundApplyRetryCount: number | null;
    nextRetryAt: number | null;
    refundTxid: string | null;
    refundedAt: number | null;
    updatedAt: number | null;
  } | null;
  a2a: SessionTraceA2ARecord | null;
  providerRuntime: SessionTraceProviderRuntimeRecord | null;
  askMaster: SessionTraceAskMasterRecord | null;
  artifacts: SessionTraceArtifacts;
}

export type ServiceOrderObserverRole = 'buyer' | 'seller';

export interface BuildServiceOrderObserverConversationIdInput {
  role: ServiceOrderObserverRole;
  metabotId: number;
  peerGlobalMetaId: string;
  paymentTxid?: string | null;
}

export interface BuildServiceOrderFallbackPayloadInput {
  servicePaidTx?: string | null;
  servicePrice?: string | null;
  serviceCurrency?: string | null;
  serviceId?: string | null;
  serviceSkill?: string | null;
  peerGlobalMetaId?: string | null;
}

export interface ServiceOrderEventMessageInput {
  role: ServiceOrderObserverRole;
  refundRequestPinId?: string | null;
  refundTxid?: string | null;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || normalizeText(value) === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
}

function sanitizePathSegment(value: string, fallback: string): string {
  const normalized = normalizeText(value).replace(/[^a-zA-Z0-9._-]+/g, '-');
  return normalized || fallback;
}

function buildA2ATraceRecord(input?: SessionTraceA2AInput | null): SessionTraceA2ARecord | null {
  if (!input) {
    return null;
  }

  const record: SessionTraceA2ARecord = {
    sessionId: normalizeText(input.sessionId) || null,
    taskRunId: normalizeText(input.taskRunId) || null,
    role: normalizeText(input.role) || null,
    publicStatus: normalizeText(input.publicStatus) || null,
    latestEvent: normalizeText(input.latestEvent) || null,
    taskRunState: normalizeText(input.taskRunState) || null,
    callerGlobalMetaId: normalizeText(input.callerGlobalMetaId) || null,
    callerName: normalizeText(input.callerName) || null,
    providerGlobalMetaId: normalizeText(input.providerGlobalMetaId) || null,
    providerName: normalizeText(input.providerName) || null,
    servicePinId: normalizeText(input.servicePinId) || null,
  };

  return Object.values(record).some(Boolean) ? record : null;
}

function buildProviderRuntimeTraceRecord(input?: SessionTraceProviderRuntimeInput | null): SessionTraceProviderRuntimeRecord | null {
  if (!input) {
    return null;
  }
  const record: SessionTraceProviderRuntimeRecord = {
    runtimeId: normalizeText(input.runtimeId) || null,
    runtimeProvider: normalizeText(input.runtimeProvider) || null,
    sessionId: normalizeText(input.sessionId) || null,
    providerSkill: normalizeText(input.providerSkill) || null,
    fallbackSelected: typeof input.fallbackSelected === 'boolean' ? input.fallbackSelected : null,
  };
  return Object.values(record).some((value) => value !== null && value !== '') ? record : null;
}

function buildAskMasterTraceRecord(input?: SessionTraceAskMasterInput | null): SessionTraceAskMasterRecord | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const preview = input.preview && typeof input.preview === 'object'
    ? {
        userTask: normalizeText(input.preview.userTask) || null,
        question: normalizeText(input.preview.question) || null,
      }
    : null;
  const response = input.response && typeof input.response === 'object'
    ? {
        status: normalizeText(input.response.status) || null,
        summary: normalizeText(input.response.summary) || null,
        followUpQuestion: normalizeText(input.response.followUpQuestion) || null,
        errorCode: normalizeText(input.response.errorCode) || null,
      }
    : null;
  const failure = input.failure && typeof input.failure === 'object'
    ? {
        code: normalizeText(input.failure.code) || null,
        message: normalizeText(input.failure.message) || null,
      }
    : null;
  const auto = input.auto && typeof input.auto === 'object'
    ? {
        reason: normalizeText(input.auto.reason) || null,
        confidence: typeof input.auto.confidence === 'number' && Number.isFinite(input.auto.confidence)
          ? input.auto.confidence
          : Number.isFinite(Number(input.auto.confidence))
            ? Number(input.auto.confidence)
            : null,
        frictionMode: normalizeText(input.auto.frictionMode) === 'preview_confirm'
          || normalizeText(input.auto.frictionMode) === 'direct_send'
          ? normalizeText(input.auto.frictionMode) as 'preview_confirm' | 'direct_send'
          : null,
        detectorVersion: normalizeText(input.auto.detectorVersion) || null,
        selectedMasterTrusted: typeof input.auto.selectedMasterTrusted === 'boolean'
          ? input.auto.selectedMasterTrusted
          : null,
        sensitivity: input.auto.sensitivity && typeof input.auto.sensitivity === 'object'
          ? {
              isSensitive: input.auto.sensitivity.isSensitive === true,
              reasons: Array.isArray(input.auto.sensitivity.reasons)
                ? input.auto.sensitivity.reasons
                  .filter((entry): entry is string => typeof entry === 'string')
                  .map((entry) => normalizeText(entry))
                  .filter(Boolean)
                : [],
            }
          : null,
      }
    : null;

  const record: SessionTraceAskMasterRecord = {
    flow: 'master',
    transport: normalizeText(input.transport) || null,
    canonicalStatus: normalizeText(input.canonicalStatus) || null,
    triggerMode: normalizeText(input.triggerMode) || null,
    contextMode: normalizeText(input.contextMode) || null,
    confirmationMode: normalizeText(input.confirmationMode) || null,
    requestId: normalizeText(input.requestId) || null,
    masterKind: normalizeText(input.masterKind) || null,
    servicePinId: normalizeText(input.servicePinId) || null,
    providerGlobalMetaId: normalizeText(input.providerGlobalMetaId) || null,
    displayName: normalizeText(input.displayName) || null,
    preview: preview && (preview.userTask || preview.question) ? preview : null,
    response: response && (response.status || response.summary || response.followUpQuestion || response.errorCode) ? response : null,
    failure: failure && (failure.code || failure.message) ? failure : null,
    auto: auto && (
      auto.reason
      || auto.confidence !== null
      || auto.frictionMode
      || auto.detectorVersion
      || auto.selectedMasterTrusted !== null
      || auto.sensitivity
    ) ? auto : null,
  };

  return record.canonicalStatus || record.requestId || record.masterKind || record.servicePinId || record.displayName
    || record.preview || record.response || record.failure || record.auto
    ? record
    : null;
}

export function buildServiceOrderObserverConversationId(
  input: BuildServiceOrderObserverConversationIdInput
): string {
  const txidPart = normalizeText(input.paymentTxid).slice(0, 16) || 'pending';
  return `metaweb_order:${input.role}:${input.metabotId}:${normalizeText(input.peerGlobalMetaId)}:${txidPart}`;
}

export function buildServiceOrderFallbackPayload(
  input: BuildServiceOrderFallbackPayloadInput
): string {
  const txid = normalizeText(input.servicePaidTx);
  const lines = [
    '[ORDER] Restored service order context.',
    input.servicePrice || input.serviceCurrency
      ? `支付金额 ${normalizeText(input.servicePrice) || '0'} ${normalizeText(input.serviceCurrency) || 'SPACE'}`
      : '',
    txid ? `txid: ${txid}` : 'txid: pending',
    normalizeText(input.serviceId) ? `service id: ${normalizeText(input.serviceId)}` : '',
    normalizeText(input.serviceSkill) ? `skill name: ${normalizeText(input.serviceSkill)}` : '',
    normalizeText(input.peerGlobalMetaId)
      ? `peer globalmetaid: ${normalizeText(input.peerGlobalMetaId)}`
      : '',
  ].filter(Boolean);
  return lines.join('\n');
}

export function buildServiceOrderEventMessage(
  type: 'refund_requested' | 'refunded',
  order: ServiceOrderEventMessageInput
): string {
  if (type === 'refund_requested') {
    if (order.role === 'seller') {
      const pinId = order.refundRequestPinId ? ` 申请凭证：${order.refundRequestPinId}` : '';
      return `系统提示：买家已发起全额退款申请，请人工处理。${pinId}`.trim();
    }
    const pinId = order.refundRequestPinId ? ` 申请凭证：${order.refundRequestPinId}` : '';
    return `系统提示：服务订单已超时，已自动发起全额退款申请。${pinId}`.trim();
  }

  const refundTxid = order.refundTxid ? ` 退款 txid：${order.refundTxid}` : '';
  return `系统提示：退款已处理完成。${refundTxid}`.trim();
}

export function buildSessionTrace(input: BuildSessionTraceInput): SessionTraceRecord {
  const traceId = normalizeText(input.traceId);
  const exportRoot = normalizeText(input.exportRoot);
  const sessionId = normalizeText(input.session.id);
  if (!traceId) {
    throw new Error('Trace ID is required');
  }
  if (!exportRoot) {
    throw new Error('Export root is required');
  }
  if (!sessionId) {
    throw new Error('Session ID is required');
  }

  const safeTraceId = sanitizePathSegment(traceId, 'trace');
  const safeSessionId = sanitizePathSegment(sessionId, 'session');
  const transcriptMarkdownPath = path.join(exportRoot, 'chats', `${safeSessionId}.md`);
  const traceMarkdownPath = path.join(exportRoot, 'traces', `${safeTraceId}.md`);
  const traceJsonPath = path.join(exportRoot, 'traces', `${safeTraceId}.json`);

  return {
    traceId,
    channel: normalizeText(input.channel),
    createdAt: Number.isFinite(input.createdAt) ? Number(input.createdAt) : Date.now(),
    session: {
      id: sessionId,
      title: normalizeText(input.session.title) || null,
      type: normalizeText(input.session.type) || null,
      metabotId: Number.isFinite(input.session.metabotId)
        ? Number(input.session.metabotId)
        : null,
      peerGlobalMetaId: normalizeText(input.session.peerGlobalMetaId) || null,
      peerName: normalizeText(input.session.peerName) || null,
      externalConversationId: normalizeText(input.session.externalConversationId) || null,
    },
    order: input.order
      ? {
          id: normalizeText(input.order.id) || null,
          role: normalizeText(input.order.role) || null,
          serviceId: normalizeText(input.order.serviceId) || null,
          serviceName: normalizeText(input.order.serviceName) || null,
          orderPinId: normalizeText(input.order.orderPinId) || null,
          orderTxid: normalizeText(input.order.orderTxid) || null,
          orderTxids: Array.isArray(input.order.orderTxids)
            ? input.order.orderTxids.map((entry) => normalizeText(entry)).filter(Boolean)
            : [],
          paymentTxid: normalizeText(input.order.paymentTxid) || null,
          paymentCommitTxid: normalizeText(input.order.paymentCommitTxid) || null,
          orderReference: normalizeText(input.order.orderReference) || null,
          paymentCurrency: normalizeText(input.order.paymentCurrency) || null,
          paymentAmount: normalizeText(input.order.paymentAmount) || null,
          paymentChain: normalizeText(input.order.paymentChain) || null,
          settlementKind: normalizeText(input.order.settlementKind) || null,
          mrc20Ticker: normalizeText(input.order.mrc20Ticker) || null,
          mrc20Id: normalizeText(input.order.mrc20Id) || null,
          providerSkill: normalizeText(input.order.providerSkill) || null,
          outputType: normalizeText(input.order.outputType) || null,
          requestText: normalizeText(input.order.requestText) || null,
          status: normalizeText(input.order.status) || null,
          failedAt: normalizeOptionalNumber(input.order.failedAt),
          failureReason: normalizeText(input.order.failureReason) || null,
          refundRequestPinId: normalizeText(input.order.refundRequestPinId) || null,
          refundRequestTxid: normalizeText(input.order.refundRequestTxid) || null,
          refundRequestedAt: normalizeOptionalNumber(input.order.refundRequestedAt),
          refundCompletedAt: normalizeOptionalNumber(input.order.refundCompletedAt),
          refundApplyRetryCount: normalizeOptionalNumber(input.order.refundApplyRetryCount),
          nextRetryAt: normalizeOptionalNumber(input.order.nextRetryAt),
          refundTxid: normalizeText(input.order.refundTxid) || null,
          refundedAt: normalizeOptionalNumber(input.order.refundedAt),
          updatedAt: normalizeOptionalNumber(input.order.updatedAt),
        }
      : null,
    a2a: buildA2ATraceRecord(input.a2a),
    providerRuntime: buildProviderRuntimeTraceRecord(input.providerRuntime),
    askMaster: buildAskMasterTraceRecord(input.askMaster),
    artifacts: {
      transcriptMarkdownPath,
      traceMarkdownPath,
      traceJsonPath,
    },
  };
}
