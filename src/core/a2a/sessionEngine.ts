import { resolvePublicStatus, type PublicStatus, type TraceDerivedEventName } from './publicStatus';
import type {
  A2AClarificationRoundRecord,
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

export interface AnswerClarificationInput {
  session: A2ASessionRecord;
  taskRun: A2ATaskRunRecord;
  answer: string;
}

export interface SessionEngineMutation {
  session: A2ASessionRecord;
  taskRun: A2ATaskRunRecord;
  event: TraceDerivedEventName;
  publicStatus: PublicStatus | null;
}

export interface CallerSessionStarted extends SessionEngineMutation {
  linkage: A2ASessionLinkage;
}

export interface ClarificationMutation extends SessionEngineMutation {
  accepted: boolean;
  guardCode: string | null;
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
  applyProviderRunnerResult(input: ApplyProviderRunnerResultInput): ClarificationMutation | SessionEngineMutation;
  answerClarification(input: AnswerClarificationInput): ClarificationMutation;
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
  event: TraceDerivedEventName,
): SessionEngineMutation {
  return {
    session,
    taskRun,
    event,
    publicStatus: resolvePublicStatus({ event }).status,
  };
}

function cloneClarificationRounds(rounds: A2AClarificationRoundRecord[]): A2AClarificationRoundRecord[] {
  return rounds.map((round) => ({ ...round }));
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
    externalConversationId: `metaweb_order:buyer:${normalizeText(input.providerGlobalMetaId)}:${truncateTraceSegment(normalizeText(input.traceId))}`,
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

  const answerClarification = (input: AnswerClarificationInput): ClarificationMutation => {
    const timestamp = now();
    const clarificationRounds = cloneClarificationRounds(input.taskRun.clarificationRounds);
    const pendingRound = clarificationRounds.find((round) => round.status === 'pending') || null;
    if (!pendingRound) {
      const session: A2ASessionRecord = {
        ...input.session,
        state: 'manual_action_required',
        updatedAt: timestamp,
      };
      const taskRun: A2ATaskRunRecord = {
        ...input.taskRun,
        updatedAt: timestamp,
        failureCode: 'clarification_not_pending',
        failureReason: 'No pending clarification round was available to answer.',
        clarificationRounds,
      };
      return {
        ...buildMutation(session, taskRun, 'clarification_needed'),
        accepted: false,
        guardCode: 'clarification_not_pending',
      };
    }

    pendingRound.answeredAt = timestamp;
    pendingRound.answer = normalizeText(input.answer);
    pendingRound.status = 'answered';

    const session: A2ASessionRecord = {
      ...input.session,
      state: 'remote_received',
      updatedAt: timestamp,
      latestTaskRunState: 'running',
    };
    const taskRun: A2ATaskRunRecord = {
      ...input.taskRun,
      state: 'running',
      updatedAt: timestamp,
      failureCode: null,
      failureReason: null,
      clarificationRounds,
    };
    return {
      ...buildMutation(session, taskRun, 'provider_received'),
      accepted: true,
      guardCode: null,
    };
  };

  const applyProviderRunnerResult = (
    input: ApplyProviderRunnerResultInput,
  ): ClarificationMutation | SessionEngineMutation => {
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
      return buildMutation(session, taskRun, 'provider_completed');
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
      return buildMutation(session, taskRun, 'provider_failed');
    }

    const clarificationRounds = cloneClarificationRounds(input.taskRun.clarificationRounds);
    if (clarificationRounds.length >= 1) {
      const session: A2ASessionRecord = {
        ...input.session,
        state: 'manual_action_required',
        updatedAt: timestamp,
      };
      const taskRun: A2ATaskRunRecord = {
        ...input.taskRun,
        updatedAt: timestamp,
        failureCode: 'clarification_round_limit_exceeded',
        failureReason: 'The provider runner requested more than one clarification round.',
        clarificationRounds,
      };
      return {
        ...buildMutation(session, taskRun, 'clarification_needed'),
        accepted: false,
        guardCode: 'clarification_round_limit_exceeded',
      };
    }

    const clarificationRound: A2AClarificationRoundRecord = {
      round: 1,
      askedAt: timestamp,
      answeredAt: null,
      question: normalizeText(input.result.question),
      answer: null,
      status: 'pending',
    };
    clarificationRounds.push(clarificationRound);

    const session: A2ASessionRecord = {
      ...input.session,
      state: 'manual_action_required',
      updatedAt: timestamp,
      latestTaskRunState: 'needs_clarification',
    };
    const taskRun: A2ATaskRunRecord = {
      ...input.taskRun,
      state: 'needs_clarification',
      updatedAt: timestamp,
      failureCode: null,
      failureReason: null,
      clarificationRounds,
    };
    return {
      ...buildMutation(session, taskRun, 'clarification_needed'),
      accepted: true,
      guardCode: null,
    };
  };

  return {
    buildSessionLinkage,
    startCallerSession,
    markForegroundTimeout,
    receiveProviderTask,
    applyProviderRunnerResult,
    answerClarification,
  };
}
