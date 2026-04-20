import {
  createA2ASessionEngine,
  type A2ASessionEngine,
  type ClarificationMutation,
  type SessionEngineMutation,
} from '../a2a/sessionEngine';
import type { ProviderServiceRunnerResult } from '../a2a/provider/serviceRunnerContracts';
import {
  buildMasterResponseJson,
  parseMasterRequest,
  parseMasterResponse,
  type MasterRequestMessage,
  type MasterResponseMessage,
  type MasterResponseStatus,
} from './masterMessageSchema';
import { runOfficialDebugMaster } from './debugMasterFixture';
import { runOfficialReviewMaster } from './reviewMasterFixture';
import {
  MASTER_KIND_DEBUG,
  MASTER_KIND_REVIEW,
  OFFICIAL_DEBUG_MASTER_SERVICE_NAME,
  OFFICIAL_REVIEW_MASTER_SERVICE_NAME,
  type PublishedMasterRecord,
} from './masterTypes';

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

export type MasterRunnerResult =
  | MasterRunnerCompletedResult
  | MasterRunnerNeedMoreContextResult
  | MasterRunnerDeclinedResult
  | MasterRunnerFailedResult;

export type MasterRunner = (
  input: MasterRunnerInput
) => MasterRunnerResult | Promise<MasterRunnerResult>;

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

export type HandleMasterProviderRequestResult =
  | HandleMasterProviderRequestSuccess
  | HandleMasterProviderRequestFailure;

export interface HandleMasterProviderRequestInput {
  rawRequest: unknown;
  providerIdentity: MasterProviderIdentity;
  publishedMasters: PublishedMasterRecord[];
  sessionEngine?: A2ASessionEngine;
  resolveRunner?: (input: MasterRunnerInput) => MasterRunner | null;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized: string[] = [];
  for (const entry of value) {
    const text = normalizeText(entry);
    if (!text) {
      continue;
    }
    normalized.push(text);
  }
  return normalized;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function buildInvalidRunnerResult(message: string): MasterRunnerFailedResult {
  return {
    state: 'failed',
    code: 'invalid_master_runner_result',
    message,
  };
}

function normalizeRunnerResult(value: unknown): MasterRunnerResult {
  if (!isObject(value)) {
    return buildInvalidRunnerResult('Master runner returned a non-object result.');
  }

  const state = normalizeText(value.state);
  if (state === 'completed') {
    const summary = normalizeText(value.summary);
    if (
      !summary
      || !Array.isArray(value.findings)
      || !Array.isArray(value.recommendations)
      || !Array.isArray(value.risks)
    ) {
      return buildInvalidRunnerResult('Invalid master runner result for completed state.');
    }
    return {
      state: 'completed',
      summary,
      findings: normalizeStringArray(value.findings),
      recommendations: normalizeStringArray(value.recommendations),
      risks: normalizeStringArray(value.risks),
      confidence: typeof value.confidence === 'number' && Number.isFinite(value.confidence)
        ? Number(value.confidence)
        : null,
      followUpQuestion: normalizeText(value.followUpQuestion) || null,
      responseText: normalizeText(value.responseText) || null,
      metadata: isObject(value.metadata) ? value.metadata : null,
    };
  }

  if (state === 'need_more_context') {
    const summary = normalizeText(value.summary);
    const followUpQuestion = normalizeText(value.followUpQuestion);
    if (!summary || !Array.isArray(value.missing) || !followUpQuestion) {
      return buildInvalidRunnerResult('Invalid master runner result for need_more_context state.');
    }
    return {
      state: 'need_more_context',
      summary,
      missing: normalizeStringArray(value.missing),
      followUpQuestion,
      risks: normalizeStringArray(value.risks),
      metadata: isObject(value.metadata) ? value.metadata : null,
    };
  }

  if (state === 'declined') {
    const reason = normalizeText(value.reason);
    if (!reason) {
      return buildInvalidRunnerResult('Invalid master runner result for declined state.');
    }
    return {
      state: 'declined',
      reason,
      risks: normalizeStringArray(value.risks),
      followUpQuestion: normalizeText(value.followUpQuestion) || null,
      metadata: isObject(value.metadata) ? value.metadata : null,
    };
  }

  if (state === 'failed') {
    const code = normalizeText(value.code);
    const message = normalizeText(value.message);
    if (!code || !message) {
      return buildInvalidRunnerResult('Invalid master runner result for failed state.');
    }
    return {
      state: 'failed',
      code,
      message,
      metadata: isObject(value.metadata) ? value.metadata : null,
    };
  }

  return buildInvalidRunnerResult('Master runner returned an unknown state.');
}

function buildTaskContext(request: MasterRequestMessage): string {
  const extensions = request.extensions ?? {};
  const lines = [
    request.context.workspaceSummary ? `workspace: ${request.context.workspaceSummary}` : '',
    normalizeText(extensions.goal) ? `goal: ${normalizeText(extensions.goal)}` : '',
    normalizeText(extensions.errorSummary) ? `errorSummary: ${normalizeText(extensions.errorSummary)}` : '',
    normalizeText(extensions.diffSummary) ? `diffSummary: ${normalizeText(extensions.diffSummary)}` : '',
    ...normalizeStringArray(extensions.constraints).map((entry) => `constraint: ${entry}`),
    ...request.context.relevantFiles.map((entry) => `file: ${entry}`),
    ...request.context.artifacts.map((artifact) => `artifact ${artifact.label}: ${artifact.content}`),
  ].filter(Boolean);
  return lines.join('\n');
}

function resolvePublishedMaster(
  publishedMasters: PublishedMasterRecord[],
  request: MasterRequestMessage,
): PublishedMasterRecord | null {
  const servicePinId = normalizeText(request.target.masterServicePinId);
  const providerGlobalMetaId = normalizeText(request.target.providerGlobalMetaId);
  const masterKind = normalizeText(request.target.masterKind);

  return publishedMasters.find((entry) => (
    entry.available === 1
    && normalizeText(entry.currentPinId) === servicePinId
    && normalizeText(entry.providerGlobalMetaId) === providerGlobalMetaId
    && normalizeText(entry.masterKind) === masterKind
  )) ?? null;
}

function resolveDefaultRunner(input: MasterRunnerInput): MasterRunner | null {
  if (
    normalizeText(input.publishedMaster.masterKind) === MASTER_KIND_DEBUG
    && normalizeText(input.publishedMaster.serviceName) === OFFICIAL_DEBUG_MASTER_SERVICE_NAME
  ) {
    return ({ request }) => runOfficialDebugMaster({ request });
  }
  if (
    normalizeText(input.publishedMaster.masterKind) === MASTER_KIND_REVIEW
    && normalizeText(input.publishedMaster.serviceName) === OFFICIAL_REVIEW_MASTER_SERVICE_NAME
  ) {
    return ({ request }) => runOfficialReviewMaster({ request });
  }
  return null;
}

function mapRunnerResultToSessionResult(result: MasterRunnerResult): ProviderServiceRunnerResult {
  if (result.state === 'completed') {
    return {
      state: 'completed',
      responseText: normalizeText(result.responseText) || result.summary,
      metadata: result.metadata ?? null,
    };
  }

  if (result.state === 'need_more_context') {
    return {
      state: 'needs_clarification',
      question: result.followUpQuestion,
      metadata: result.metadata ?? null,
    };
  }

  if (result.state === 'declined') {
    return {
      state: 'failed',
      code: 'master_declined',
      message: result.reason,
      metadata: result.metadata ?? null,
    };
  }

  return {
    state: 'failed',
    code: normalizeText(result.code) || 'master_runner_failed',
    message: normalizeText(result.message) || 'Master runner failed.',
    metadata: result.metadata ?? null,
  };
}

function mapRunnerResultToResponseStatus(result: MasterRunnerResult): MasterResponseStatus {
  if (result.state === 'completed') return 'completed';
  if (result.state === 'need_more_context') return 'need_more_context';
  if (result.state === 'declined') return 'declined';
  return 'failed';
}

function buildStructuredData(result: MasterRunnerResult): Record<string, unknown> {
  if (result.state === 'completed') {
    return {
      findings: [...result.findings],
      recommendations: [...result.recommendations],
      risks: [...result.risks],
      confidence: result.confidence,
    };
  }

  if (result.state === 'need_more_context') {
    return {
      missing: [...result.missing],
      risks: [...(result.risks ?? [])],
    };
  }

  if (result.state === 'declined') {
    return {
      risks: [...(result.risks ?? [])],
    };
  }

  return {};
}

function buildResponsePayload(input: {
  request: MasterRequestMessage;
  publishedMaster: PublishedMasterRecord;
  runnerResult: MasterRunnerResult;
}): MasterResponseMessage {
  const runnerResult = input.runnerResult;
  const responseJson = buildMasterResponseJson({
    type: 'master_response',
    version: '1.0.0',
    requestId: input.request.requestId,
    traceId: input.request.traceId,
    responder: {
      providerGlobalMetaId: input.request.target.providerGlobalMetaId,
      masterServicePinId: input.publishedMaster.currentPinId,
      masterKind: input.publishedMaster.masterKind,
    },
    status: mapRunnerResultToResponseStatus(runnerResult),
    summary: runnerResult.state === 'declined'
      ? normalizeText(runnerResult.reason)
      : runnerResult.state === 'failed'
        ? normalizeText(runnerResult.message)
        : normalizeText(runnerResult.summary),
    responseText: runnerResult.state === 'completed'
      ? normalizeText(runnerResult.responseText) || null
      : null,
    structuredData: buildStructuredData(runnerResult),
    followUpQuestion: runnerResult.state === 'completed'
      ? normalizeText(runnerResult.followUpQuestion) || null
      : runnerResult.state === 'need_more_context'
        ? normalizeText(runnerResult.followUpQuestion)
        : runnerResult.state === 'declined'
          ? normalizeText(runnerResult.followUpQuestion) || null
          : null,
    errorCode: runnerResult.state === 'failed'
      ? normalizeText(runnerResult.code) || 'master_runner_failed'
      : runnerResult.state === 'declined'
        ? 'master_declined'
        : null,
    extensions: runnerResult.metadata ?? null,
  });
  const parsed = parseMasterResponse(responseJson);
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }
  return parsed.value;
}

export async function handleMasterProviderRequest(
  input: HandleMasterProviderRequestInput,
): Promise<HandleMasterProviderRequestResult> {
  const parsedRequest = parseMasterRequest(input.rawRequest);
  if (!parsedRequest.ok) {
    return {
      ok: false,
      code: parsedRequest.code,
      message: parsedRequest.message,
    };
  }

  const providerGlobalMetaId = normalizeText(input.providerIdentity.globalMetaId);
  if (!providerGlobalMetaId) {
    return {
      ok: false,
      code: 'provider_identity_missing',
      message: 'Local provider identity is required.',
    };
  }

  if (normalizeText(parsedRequest.value.target.providerGlobalMetaId) !== providerGlobalMetaId) {
    return {
      ok: false,
      code: 'provider_identity_mismatch',
      message: 'master_request.target.providerGlobalMetaId does not match the local provider identity.',
    };
  }

  const publishedMaster = resolvePublishedMaster(input.publishedMasters, parsedRequest.value);
  if (!publishedMaster) {
    return {
      ok: false,
      code: 'master_service_not_found',
      message: `Published master-service was not found: ${parsedRequest.value.target.masterServicePinId}`,
    };
  }

  const sessionEngine = input.sessionEngine ?? createA2ASessionEngine();
  const received = sessionEngine.receiveProviderTask({
    traceId: parsedRequest.value.traceId,
    servicePinId: publishedMaster.currentPinId,
    callerGlobalMetaId: parsedRequest.value.caller.globalMetaId,
    providerGlobalMetaId: providerGlobalMetaId,
    userTask: parsedRequest.value.task.userTask,
    taskContext: buildTaskContext(parsedRequest.value),
  });

  const runnerInput: MasterRunnerInput = {
    request: parsedRequest.value,
    publishedMaster,
    providerIdentity: input.providerIdentity,
  };
  const resolvedRunner = input.resolveRunner?.(runnerInput) ?? resolveDefaultRunner(runnerInput);
  let runnerResult: MasterRunnerResult;

  if (!resolvedRunner) {
    runnerResult = {
      state: 'failed',
      code: 'master_runner_not_found',
      message: `No master runner is configured for ${publishedMaster.currentPinId}.`,
    };
  } else {
    try {
      runnerResult = normalizeRunnerResult(await resolvedRunner(runnerInput));
    } catch (error) {
      runnerResult = {
        state: 'failed',
        code: 'master_runner_exception',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const applied = sessionEngine.applyProviderRunnerResult({
    session: received.session,
    taskRun: received.taskRun,
    result: mapRunnerResultToSessionResult(runnerResult),
  });
  const response = buildResponsePayload({
    request: parsedRequest.value,
    publishedMaster,
    runnerResult,
  });

  return {
    ok: true,
    request: parsedRequest.value,
    publishedMaster,
    received,
    applied,
    runnerResult,
    response,
    responseJson: buildMasterResponseJson(response),
    traceSummary: {
      flow: 'master',
      servicePinId: publishedMaster.currentPinId,
      masterKind: publishedMaster.masterKind,
      requestId: parsedRequest.value.requestId,
      requestStatus: response.status,
    },
  };
}
