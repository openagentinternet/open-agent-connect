import path from 'node:path';
import type { PublicStatus } from '../a2a/publicStatus';
import type { A2ASessionRole, A2ATaskRunState } from '../a2a/sessionTypes';

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
  serviceOrderPinId?: string | null;
  paymentCurrency?: string | null;
  paymentAmount?: string | null;
  paymentChain?: string | null;
  settlementKind?: string | null;
  mrc20Ticker?: string | null;
  mrc20Id?: string | null;
  providerSkill?: string | null;
  providerSkills?: string[] | null;
  outputType?: string | null;
  requestText?: string | null;
  status?: string | null;
  firstResponseDeadlineAt?: number | null;
  deliveryDeadlineAt?: number | null;
  firstResponseReceivedAt?: number | null;
  failedAt?: number | null;
  failureReason?: string | null;
  refundRequestPinId?: string | null;
  refundRequestTxid?: string | null;
  refundRequestedAt?: number | null;
  refundCompletedAt?: number | null;
  refundFinalizePinId?: string | null;
  refundBlockingReason?: string | null;
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
}

export interface SessionTraceProviderRuntimeInput {
  runtimeId?: string | null;
  runtimeProvider?: string | null;
  sessionId?: string | null;
  providerSkill?: string | null;
  providerSkills?: string[] | null;
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
  providerSkills: string[];
  fallbackSelected: boolean | null;
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
    serviceOrderPinId: string | null;
    paymentCurrency: string | null;
    paymentAmount: string | null;
    paymentChain: string | null;
    settlementKind: string | null;
    mrc20Ticker: string | null;
    mrc20Id: string | null;
    providerSkill?: string | null;
    providerSkills?: string[];
    outputType: string | null;
    requestText: string | null;
    status: string | null;
    firstResponseDeadlineAt: number | null;
    deliveryDeadlineAt: number | null;
    firstResponseReceivedAt: number | null;
    failedAt: number | null;
    failureReason: string | null;
    refundRequestPinId: string | null;
    refundRequestTxid: string | null;
    refundRequestedAt: number | null;
    refundCompletedAt: number | null;
    refundFinalizePinId: string | null;
    refundBlockingReason: string | null;
    refundApplyRetryCount: number | null;
    nextRetryAt: number | null;
    refundTxid: string | null;
    refundedAt: number | null;
    updatedAt: number | null;
  } | null;
  a2a: SessionTraceA2ARecord | null;
  providerRuntime: SessionTraceProviderRuntimeRecord | null;
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

function normalizeTextList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map((entry) => normalizeText(entry)).filter(Boolean))];
}

function normalizeOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || normalizeText(value) === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
}

// Timestamp variant that also accepts plain numbers (normalizeOptionalNumber
// only accepts numeric strings); used for the order deadline fields.
function normalizeOptionalTimestamp(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
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
    providerSkills: normalizeTextList(input.providerSkills),
    fallbackSelected: typeof input.fallbackSelected === 'boolean' ? input.fallbackSelected : null,
  };
  return Object.values(record).some((value) => (
    Array.isArray(value) ? value.length > 0 : value !== null && value !== ''
  )) ? record : null;
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
          serviceOrderPinId: normalizeText(input.order.serviceOrderPinId) || null,
          paymentCurrency: normalizeText(input.order.paymentCurrency) || null,
          paymentAmount: normalizeText(input.order.paymentAmount) || null,
          paymentChain: normalizeText(input.order.paymentChain) || null,
          settlementKind: normalizeText(input.order.settlementKind) || null,
          mrc20Ticker: normalizeText(input.order.mrc20Ticker) || null,
          mrc20Id: normalizeText(input.order.mrc20Id) || null,
          providerSkill: normalizeText(input.order.providerSkill) || null,
          providerSkills: normalizeTextList(input.order.providerSkills),
          outputType: normalizeText(input.order.outputType) || null,
          requestText: normalizeText(input.order.requestText) || null,
          status: normalizeText(input.order.status) || null,
          firstResponseDeadlineAt: normalizeOptionalTimestamp(input.order.firstResponseDeadlineAt),
          deliveryDeadlineAt: normalizeOptionalTimestamp(input.order.deliveryDeadlineAt),
          firstResponseReceivedAt: normalizeOptionalTimestamp(input.order.firstResponseReceivedAt),
          failedAt: normalizeOptionalNumber(input.order.failedAt),
          failureReason: normalizeText(input.order.failureReason) || null,
          refundRequestPinId: normalizeText(input.order.refundRequestPinId) || null,
          refundRequestTxid: normalizeText(input.order.refundRequestTxid) || null,
          refundRequestedAt: normalizeOptionalNumber(input.order.refundRequestedAt),
          refundCompletedAt: normalizeOptionalNumber(input.order.refundCompletedAt),
          refundFinalizePinId: normalizeText(input.order.refundFinalizePinId) || null,
          refundBlockingReason: normalizeText(input.order.refundBlockingReason) || null,
          refundApplyRetryCount: normalizeOptionalNumber(input.order.refundApplyRetryCount),
          nextRetryAt: normalizeOptionalNumber(input.order.nextRetryAt),
          refundTxid: normalizeText(input.order.refundTxid) || null,
          refundedAt: normalizeOptionalNumber(input.order.refundedAt),
          updatedAt: normalizeOptionalNumber(input.order.updatedAt),
        }
      : null,
    a2a: buildA2ATraceRecord(input.a2a),
    providerRuntime: buildProviderRuntimeTraceRecord(input.providerRuntime),
    artifacts: {
      transcriptMarkdownPath,
      traceMarkdownPath,
      traceJsonPath,
    },
  };
}
