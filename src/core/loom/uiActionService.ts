import {
  commandAwaitingConfirmation,
  commandFailed,
  type MetabotCommandResult,
} from '../contracts/commandResult';

export interface LoomUiActionRequest {
  action: string;
  from?: string;
  confirm?: boolean;
  [key: string]: unknown;
}

export interface LoomUiActionService {
  run(input: LoomUiActionRequest): Promise<MetabotCommandResult<unknown>>;
}

type LoomUiWorkflowDependency = (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;

export interface LoomUiActionServiceDependencies {
  postTask: LoomUiWorkflowDependency;
  claimAndStart: LoomUiWorkflowDependency;
  runDevRound: LoomUiWorkflowDependency;
  deliver: LoomUiWorkflowDependency;
  acceptAndPay: LoomUiWorkflowDependency;
  reviewDelivery: LoomUiWorkflowDependency;
  dashboardAfterAction?: (input: {
    action: string;
    request: LoomUiActionRequest;
    result: MetabotCommandResult<unknown>;
  }) => Promise<unknown> | unknown;
}

type ReviewVerdict = 'revision_needed' | 'rejected';

const confirmedRefreshActions = new Set([
  'postTask',
  'claimAndStart',
  'runDevRound',
  'deliver',
  'acceptAndPay',
  'requestRevision',
  'reject',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function shellQuote(value: string): string {
  if (value.length === 0) {
    return "''";
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function commandLine(command: string[], args: Array<{ flag: string; value?: string } | { value: string }>): string {
  const renderedArgs = args.flatMap((arg) => (
    'flag' in arg
      ? [arg.flag, ...(arg.value === undefined ? [] : [shellQuote(arg.value)])]
      : [shellQuote(arg.value)]
  ));
  return [...command, ...renderedArgs].join(' ');
}

function actorValue(input: LoomUiActionRequest): string {
  return stringValue(input.from) ?? '<actor>';
}

function taskPinId(input: LoomUiActionRequest): string | undefined {
  return stringValue(input.taskPinId);
}

function claimPinId(input: LoomUiActionRequest): string | undefined {
  return stringValue(input.claimPinId);
}

function deliveryPinId(input: LoomUiActionRequest): string | undefined {
  return stringValue(input.deliveryPinId);
}

function cliFallbackFor(input: LoomUiActionRequest, mappedAction = input.action): string | undefined {
  const actor = actorValue(input);
  const task = taskPinId(input) ?? '<task-pin-id>';
  const claim = claimPinId(input) ?? '<claim-pin-id>';
  const delivery = deliveryPinId(input) ?? '<delivery-pin-id>';

  switch (mappedAction) {
    case 'postTask':
      if (stringValue(input.payloadFile)) {
        return commandLine(['metabot', 'loom', 'post-task'], [
          { flag: '--from', value: actor },
          { flag: '--payload-file', value: stringValue(input.payloadFile) },
        ]);
      }
      if (stringValue(input.wish)) {
        return commandLine(['metabot', 'loom', 'post-task'], [
          { flag: '--from', value: actor },
          { flag: '--wish', value: stringValue(input.wish) },
        ]);
      }
      return commandLine(['metabot', 'loom', 'post-task'], [
        { flag: '--from', value: actor },
        { flag: '--payload-file', value: '<task-payload.json>' },
      ]);
    case 'claimAndStart':
      return commandLine(['metabot', 'loom', 'claim-and-start'], [
        { flag: '--from', value: actor },
        { flag: '--task-pin-id', value: task },
        { flag: '--payout-address', value: stringValue(input.payoutAddress) ?? '<payout-address>' },
      ]);
    case 'runDevRound':
      return commandLine(['metabot', 'loom', 'run-dev-round'], [
        { flag: '--from', value: actor },
        { flag: '--task-pin-id', value: task },
        { flag: '--claim-pin-id', value: claim },
      ]);
    case 'deliver':
      return commandLine(['metabot', 'loom', 'deliver'], [
        { flag: '--from', value: actor },
        { flag: '--task-pin-id', value: task },
        { flag: '--claim-pin-id', value: claim },
      ]);
    case 'acceptAndPay':
      const acceptArgs: Array<{ flag: string; value?: string } | { value: string }> = [
        { flag: '--from', value: actor },
        { flag: '--task-pin-id', value: task },
        { flag: '--delivery-pin-id', value: delivery },
        { flag: '--score', value: String(input.score ?? 5) },
        { flag: '--comment', value: stringValue(input.comment) ?? 'Accepted.' },
      ];
      if (input.confirm) {
        acceptArgs.push({ flag: '--confirm-payment' });
      }
      return commandLine(['metabot', 'loom', 'accept-and-pay'], acceptArgs);
    case 'requestRevision':
      return reviewCliFallback(input, 'revision_needed');
    case 'reject':
      return reviewCliFallback(input, 'rejected');
    default:
      return undefined;
  }
}

function reviewCliFallback(input: LoomUiActionRequest, verdict: ReviewVerdict): string {
  return commandLine(['metabot', 'loom', 'review-delivery'], [
    { flag: '--from', value: actorValue(input) },
    { flag: '--task-pin-id', value: taskPinId(input) ?? '<task-pin-id>' },
    { flag: '--delivery-pin-id', value: deliveryPinId(input) ?? '<delivery-pin-id>' },
    { flag: '--verdict', value: verdict },
    { flag: '--score', value: String(input.score ?? (verdict === 'revision_needed' ? 2 : 1)) },
    { flag: '--comment', value: stringValue(input.comment) ?? (verdict === 'revision_needed' ? 'Please revise this delivery.' : 'Rejected.') },
  ]);
}

function withCliFallback(
  result: MetabotCommandResult<unknown>,
  cliFallback: string | undefined,
  action: string,
): MetabotCommandResult<unknown> {
  if (result.ok || !cliFallback) {
    return result;
  }
  const originalData = isRecord(result.data) ? result.data : {};
  if (typeof originalData.cliFallback === 'string') {
    return result;
  }
  if (!safeToAddCliFallback(action, result, originalData)) {
    return result;
  }
  return {
    ...result,
    data: {
      ...originalData,
      cliFallback,
    },
  };
}

function hasPostPaymentRecoveryData(data: Record<string, unknown>): boolean {
  return data.paymentTxId !== undefined
    || data.retryGuidance !== undefined
    || data.acceptancePayload !== undefined;
}

function safeToAddCliFallback(
  action: string,
  result: MetabotCommandResult<unknown>,
  data: Record<string, unknown>,
): boolean {
  if (action !== 'acceptAndPay') {
    return true;
  }
  if (result.code === 'acceptance_write_failed_after_payment') {
    return false;
  }
  return !hasPostPaymentRecoveryData(data);
}

function withConfirmedRefresh(
  result: MetabotCommandResult<unknown>,
  action: string,
  dashboardAfterAction?: unknown,
  dashboardRefreshWarning?: Record<string, unknown>,
): MetabotCommandResult<unknown> {
  if (!result.ok || result.state !== 'success' || !confirmedRefreshActions.has(action)) {
    return result;
  }
  const data = isRecord(result.data) ? result.data : { value: result.data };
  return {
    ...result,
    data: {
      ...data,
      dashboardRefreshRecommended: true,
      ...(dashboardAfterAction === undefined ? {} : { dashboardAfterAction }),
      ...(dashboardRefreshWarning ? { dashboardRefreshWarning } : {}),
    },
  };
}

function previewEnvelope(
  input: LoomUiActionRequest,
  options: {
    action?: string;
    preview?: unknown;
    verdict?: ReviewVerdict;
  } = {},
): MetabotCommandResult<Record<string, unknown>> {
  const action = options.action ?? input.action;
  return commandAwaitingConfirmation({
    action,
    confirmed: false,
    requiresConfirmation: true,
    dashboardRefreshRecommended: false,
    ...(taskPinId(input) ? { taskPinId: taskPinId(input) } : {}),
    ...(claimPinId(input) ? { claimPinId: claimPinId(input) } : {}),
    ...(deliveryPinId(input) ? { deliveryPinId: deliveryPinId(input) } : {}),
    ...(input.from ? { from: input.from } : {}),
    ...(options.verdict ? { verdict: options.verdict } : {}),
    ...(options.preview !== undefined ? { preview: options.preview } : {}),
    ...(cliFallbackFor(input, action) ? { cliFallback: cliFallbackFor(input, action) } : {}),
  });
}

function missingIdFailure(
  input: LoomUiActionRequest,
  field: 'taskPinId' | 'claimPinId' | 'deliveryPinId',
): MetabotCommandResult<never> {
  const code = field === 'taskPinId'
    ? 'loom_task_pin_id_required'
    : field === 'claimPinId'
      ? 'loom_claim_pin_id_required'
      : 'loom_delivery_pin_id_required';
  return commandFailed(code, `Loom ${field} is required for ${input.action}.`, {
    data: {
      field,
      ...(cliFallbackFor(input) ? { cliFallback: cliFallbackFor(input) } : {}),
    },
  });
}

function validateRequiredIds(input: LoomUiActionRequest): MetabotCommandResult<never> | undefined {
  switch (input.action) {
    case 'claimAndStart':
      return taskPinId(input) ? undefined : missingIdFailure(input, 'taskPinId');
    case 'runDevRound':
    case 'deliver':
      if (!taskPinId(input)) {
        return missingIdFailure(input, 'taskPinId');
      }
      return claimPinId(input) ? undefined : missingIdFailure(input, 'claimPinId');
    case 'acceptAndPay':
    case 'requestRevision':
    case 'reject':
      if (!taskPinId(input)) {
        return missingIdFailure(input, 'taskPinId');
      }
      return deliveryPinId(input) ? undefined : missingIdFailure(input, 'deliveryPinId');
    default:
      return undefined;
  }
}

function validateConfirmingActor(input: LoomUiActionRequest): MetabotCommandResult<never> | undefined {
  if (!input.confirm || stringValue(input.from)) {
    return undefined;
  }
  return commandFailed('loom_actor_required', `Loom action ${input.action} requires an actor when confirmed.`, {
    data: {
      field: 'from',
      ...(cliFallbackFor(input) ? { cliFallback: cliFallbackFor(input) } : {}),
    },
  });
}

async function finishConfirmedAction(
  dependencies: LoomUiActionServiceDependencies,
  input: LoomUiActionRequest,
  action: string,
  result: MetabotCommandResult<unknown>,
): Promise<MetabotCommandResult<unknown>> {
  const withFallback = withCliFallback(result, cliFallbackFor(input, action), action);
  if (!withFallback.ok || withFallback.state !== 'success') {
    return withFallback;
  }
  let dashboardAfterAction: unknown;
  let dashboardRefreshWarning: Record<string, unknown> | undefined;
  if (dependencies.dashboardAfterAction) {
    try {
      dashboardAfterAction = await dependencies.dashboardAfterAction({ action, request: input, result: withFallback });
    } catch (error) {
      dashboardRefreshWarning = {
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return withConfirmedRefresh(withFallback, action, dashboardAfterAction, dashboardRefreshWarning);
}

export function createLoomUiActionService(dependencies: LoomUiActionServiceDependencies): LoomUiActionService {
  return {
    async run(input: LoomUiActionRequest): Promise<MetabotCommandResult<unknown>> {
      if (![
        'postTask',
        'claimAndStart',
        'runDevRound',
        'deliver',
        'acceptAndPay',
        'requestRevision',
        'reject',
      ].includes(input.action)) {
        return commandFailed('loom_action_invalid', `Unsupported Loom UI action: ${input.action}.`);
      }

      const missingId = validateRequiredIds(input);
      if (missingId) {
        return missingId;
      }

      const missingActor = validateConfirmingActor(input);
      if (missingActor) {
        return missingActor;
      }

      switch (input.action) {
        case 'postTask': {
          const result = await dependencies.postTask({ ...input, dryRun: input.confirm ? false : true });
          if (!input.confirm && result.ok) {
            return previewEnvelope(input, { preview: result.data });
          }
          return finishConfirmedAction(dependencies, input, input.action, result);
        }
        case 'claimAndStart': {
          const result = await dependencies.claimAndStart({ ...input, dryRun: input.confirm ? false : true });
          if (!input.confirm && result.ok) {
            return previewEnvelope(input, { preview: result.data });
          }
          return finishConfirmedAction(dependencies, input, input.action, result);
        }
        case 'runDevRound':
          if (!input.confirm) {
            return previewEnvelope(input);
          }
          return finishConfirmedAction(dependencies, input, input.action, await dependencies.runDevRound(input));
        case 'deliver': {
          const result = await dependencies.deliver({ ...input, dryRun: input.confirm ? false : true });
          if (!input.confirm && result.ok) {
            return previewEnvelope(input, { preview: result.data });
          }
          return finishConfirmedAction(dependencies, input, input.action, result);
        }
        case 'acceptAndPay': {
          const result = await dependencies.acceptAndPay({ ...input, confirmPayment: input.confirm ? true : false });
          if (!input.confirm && result.ok) {
            return previewEnvelope(input, { preview: result.data });
          }
          return finishConfirmedAction(dependencies, input, input.action, result);
        }
        case 'requestRevision':
          if (!input.confirm) {
            return previewEnvelope(input, { verdict: 'revision_needed' });
          }
          return finishConfirmedAction(
            dependencies,
            input,
            input.action,
            await dependencies.reviewDelivery({ ...input, verdict: 'revision_needed' }),
          );
        case 'reject':
          if (!input.confirm) {
            return previewEnvelope(input, { verdict: 'rejected' });
          }
          return finishConfirmedAction(
            dependencies,
            input,
            input.action,
            await dependencies.reviewDelivery({ ...input, verdict: 'rejected' }),
          );
        default:
          return commandFailed('loom_action_invalid', `Unsupported Loom UI action: ${input.action}.`);
      }
    },
  };
}
