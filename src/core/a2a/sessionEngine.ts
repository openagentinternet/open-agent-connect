import type {
  A2ASessionRecord,
  A2ATaskRunRecord,
} from './sessionTypes';
import type { ProviderServiceRunnerResult } from './provider/serviceRunnerContracts';

export interface A2ASessionLinkage {
  coworkSessionId: string | null;
  externalConversationId: string;
}

export interface StartCallerSessionInput {
  traceId: string;
  servicePinId: string;
  callerGlobalMetaId: string;
  providerGlobalMetaId: string;
  userTask: string;
  taskContext: string;
}

export interface ReceiveProviderTaskInput {
  traceId: string;
  servicePinId: string;
  callerGlobalMetaId: string;
  providerGlobalMetaId: string;
  userTask: string;
  taskContext: string;
}

export interface ApplyProviderRunnerResultInput {
  session: A2ASessionRecord;
  taskRun: A2ATaskRunRecord;
  result: ProviderServiceRunnerResult;
}

export type A2ASessionEngineEvent =
  | 'request_sent'
  | 'provider_received'
  | 'provider_executing'
  | 'provider_completed'
  | 'timeout'
  | 'provider_failed';

export interface SessionEngineMutation {
  session: A2ASessionRecord;
  taskRun: A2ATaskRunRecord;
  event: A2ASessionEngineEvent;
  runnerResult: ProviderServiceRunnerResult | null;
}

export interface CallerSessionStarted extends SessionEngineMutation {
  linkage: A2ASessionLinkage;
}

export interface A2ASessionEngineOptions {
  now?: () => number;
  createSessionId?: () => string;
  createTaskRunId?: () => string;
}

export interface A2ASessionEngine {
  buildSessionLinkage(input: {
    providerGlobalMetaId: string;
    traceId: string;
    sessionId?: string | null;
  }): A2ASessionLinkage;
  startCallerSession(input: StartCallerSessionInput): CallerSessionStarted;
  markForegroundTimeout(input: {
    session: A2ASessionRecord;
    taskRun: A2ATaskRunRecord;
  }): SessionEngineMutation;
  receiveProviderTask(input: ReceiveProviderTaskInput): SessionEngineMutation;
  applyProviderRunnerResult(input: ApplyProviderRunnerResultInput): SessionEngineMutation;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function truncateTraceSegment(value: string): string {
  return value.replace(/[^a-z0-9-]+/gi, '-').replace(/-+/g, '-').slice(0, 16) || 'trace';
}

function buildMutation(
  session: A2ASessionRecord,
  taskRun: A2ATaskRunRecord,
  event: A2ASessionEngineEvent,
  runnerResult: ProviderServiceRunnerResult | null = null,
): SessionEngineMutation {
  return {
    session,
    taskRun,
    event,
    runnerResult,
  };
}

export function createA2ASessionEngine(options: A2ASessionEngineOptions = {}): A2ASessionEngine {
  let fallbackIdSequence = 0;
  const now = options.now ?? (() => Date.now());
  const createSessionId = options.createSessionId
    ?? (() => `session-${now().toString(36)}-${(++fallbackIdSequence).toString(36)}`);
  const createTaskRunId = options.createTaskRunId
    ?? (() => `run-${now().toString(36)}-${(++fallbackIdSequence).toString(36)}`);

  const buildSessionLinkage = (input: {
    providerGlobalMetaId: string;
    traceId: string;
    sessionId?: string | null;
  }): A2ASessionLinkage => ({
    coworkSessionId: normalizeText(input.sessionId) || null,
    externalConversationId: `a2a-session:${normalizeText(input.providerGlobalMetaId)}:${truncateTraceSegment(normalizeText(input.traceId))}`,
  });

  const startCallerSession = (input: StartCallerSessionInput): CallerSessionStarted => {
    const timestamp = now();
    const sessionId = createSessionId();
    const taskRunId = createTaskRunId();
    const session: A2ASessionRecord = {
      sessionId,
      traceId: normalizeText(input.traceId),
      role: 'caller',
      state: 'requesting_remote',
      createdAt: timestamp,
      updatedAt: timestamp,
      callerGlobalMetaId: normalizeText(input.callerGlobalMetaId),
      providerGlobalMetaId: normalizeText(input.providerGlobalMetaId),
      servicePinId: normalizeText(input.servicePinId),
      currentTaskRunId: taskRunId,
      latestTaskRunState: 'queued',
    };
    const taskRun: A2ATaskRunRecord = {
      runId: taskRunId,
      sessionId,
      state: 'queued',
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: null,
      completedAt: null,
      failureCode: null,
      failureReason: null,
      clarificationRounds: [],
    };
    return {
      ...buildMutation(session, taskRun, 'request_sent'),
      linkage: buildSessionLinkage({
        providerGlobalMetaId: input.providerGlobalMetaId,
        traceId: input.traceId,
        sessionId,
      }),
    };
  };

  const markForegroundTimeout = (input: {
    session: A2ASessionRecord;
    taskRun: A2ATaskRunRecord;
  }): SessionEngineMutation => {
    const timestamp = now();
    const session: A2ASessionRecord = {
      ...input.session,
      state: 'timeout',
      updatedAt: timestamp,
      latestTaskRunState: 'timeout',
    };
    const taskRun: A2ATaskRunRecord = {
      ...input.taskRun,
      state: 'timeout',
      updatedAt: timestamp,
    };
    return buildMutation(session, taskRun, 'timeout');
  };

  const receiveProviderTask = (input: ReceiveProviderTaskInput): SessionEngineMutation => {
    const timestamp = now();
    const sessionId = createSessionId();
    const taskRunId = createTaskRunId();
    const session: A2ASessionRecord = {
      sessionId,
      traceId: normalizeText(input.traceId),
      role: 'provider',
      state: 'remote_received',
      createdAt: timestamp,
      updatedAt: timestamp,
      callerGlobalMetaId: normalizeText(input.callerGlobalMetaId),
      providerGlobalMetaId: normalizeText(input.providerGlobalMetaId),
      servicePinId: normalizeText(input.servicePinId),
      currentTaskRunId: taskRunId,
      latestTaskRunState: 'running',
    };
    const taskRun: A2ATaskRunRecord = {
      runId: taskRunId,
      sessionId,
      state: 'running',
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: timestamp,
      completedAt: null,
      failureCode: null,
      failureReason: null,
      clarificationRounds: [],
    };
    return buildMutation(session, taskRun, 'provider_received');
  };

  const applyProviderRunnerResult = (
    input: ApplyProviderRunnerResultInput,
  ): SessionEngineMutation => {
    const timestamp = now();

    if (input.result.state === 'completed') {
      const session: A2ASessionRecord = {
        ...input.session,
        state: 'completed',
        updatedAt: timestamp,
        latestTaskRunState: 'completed',
      };
      const taskRun: A2ATaskRunRecord = {
        ...input.taskRun,
        state: 'completed',
        updatedAt: timestamp,
        completedAt: timestamp,
        failureCode: null,
        failureReason: null,
      };
      return buildMutation(session, taskRun, 'provider_completed', input.result);
    }

    if (input.result.state === 'failed') {
      const session: A2ASessionRecord = {
        ...input.session,
        state: 'remote_failed',
        updatedAt: timestamp,
        latestTaskRunState: 'failed',
      };
      const taskRun: A2ATaskRunRecord = {
        ...input.taskRun,
        state: 'failed',
        updatedAt: timestamp,
        completedAt: timestamp,
        failureCode: normalizeText(input.result.code) || 'provider_runner_failed',
        failureReason: normalizeText(input.result.message) || 'Provider runner failed.',
      };
      return buildMutation(session, taskRun, 'provider_failed', input.result);
    }

    // A needs_clarification outcome has no answer channel: finalize it as a
    // terminal failure instead of leaving the task run stuck.
    const session: A2ASessionRecord = {
      ...input.session,
      state: 'remote_failed',
      updatedAt: timestamp,
      latestTaskRunState: 'failed',
    };
    const taskRun: A2ATaskRunRecord = {
      ...input.taskRun,
      state: 'failed',
      updatedAt: timestamp,
      completedAt: timestamp,
      failureCode: 'clarification_not_supported',
      failureReason: normalizeText(input.result.question)
        || 'Provider runner requested clarification, which is not supported.',
    };
    return buildMutation(session, taskRun, 'provider_failed', input.result);
  };

  return {
    buildSessionLinkage,
    startCallerSession,
    markForegroundTimeout,
    receiveProviderTask,
    applyProviderRunnerResult,
  };
}
