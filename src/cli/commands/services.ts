import { commandFailed, commandSuccess, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { commandMissingFlag, commandUnknownSubcommand, readChainWriteFlag, readFlagValue, readJsonFile } from './helpers';
import type { CliRuntimeContext } from '../types';

function readFromFlag(args: string[], options: { allowSlugAlias?: boolean } = {}): string | undefined {
  return readFlagValue(args, '--from')
    ?? (options.allowSlugAlias ? readFlagValue(args, '--slug') : null)
    ?? undefined;
}

function applyOptionalActor(
  input: Record<string, unknown>,
  from: string | undefined,
): Record<string, unknown> {
  return from ? { ...input, from } : input;
}

export async function runServicesCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>> {
  const shouldPollTrace = Boolean(
    context.stdout
    && typeof context.stdout === 'object'
    && 'isTTY' in (context.stdout as Record<string, unknown>)
    && (context.stdout as { isTTY?: boolean }).isTTY,
  );
  const subcommand = args[0];

  if (subcommand === 'publish') {
    const payloadFile = readFlagValue(args, '--payload-file');
    const from = readFromFlag(args);
    if (!payloadFile) {
      return commandMissingFlag('--payload-file');
    }

    const chainFlag = readChainWriteFlag(args);
    if (chainFlag.error) {
      return chainFlag.error;
    }

    const handler = context.dependencies.services?.publish;
    if (!handler) {
      return commandFailed('not_implemented', 'Services publish handler is not configured.');
    }

    const payload = await readJsonFile(context, payloadFile);
    return handler(applyOptionalActor(
      chainFlag.chain ? { ...payload, network: chainFlag.chain } : payload,
      from,
    ));
  }

  if (subcommand === 'skills' || subcommand === 'publish-skills') {
    const from = readFromFlag(args, { allowSlugAlias: subcommand === 'publish-skills' });
    const handler = context.dependencies.services?.listPublishSkills;
    if (!handler) {
      return commandFailed('not_implemented', 'Services publish skills handler is not configured.');
    }
    return handler(from ? { from } : undefined);
  }

  if (subcommand === 'call') {
    const requestFile = readFlagValue(args, '--request-file');
    const from = readFromFlag(args);
    if (!requestFile) {
      return commandMissingFlag('--request-file');
    }

    const handler = context.dependencies.services?.call;
    if (!handler) {
      return commandFailed('not_implemented', 'Services call handler is not configured.');
    }

    const request = await readJsonFile(context, requestFile);
    const result = await handler(applyOptionalActor(request, from));

    if (
      result.state === 'waiting' &&
      'data' in result &&
      result.data &&
      typeof result.data === 'object' &&
      'traceId' in result.data &&
      result.localUiUrl &&
      shouldPollTrace
    ) {
      const { pollTraceUntilComplete } = await import('./pollTraceHelper');
      const traceGet = context.dependencies.trace?.get;
      if (traceGet) {
        const poll = await pollTraceUntilComplete({
          traceId: String(result.data.traceId),
          localUiUrl: result.localUiUrl,
          requestFn: async (method, path) => {
            const traceId = path.split('/').pop() || '';
            return traceGet({ traceId: decodeURIComponent(traceId) });
          },
          stderr: context.stderr,
        });
        if (poll.completed && poll.trace) {
          const sessions = Array.isArray(poll.trace.sessions) ? poll.trace.sessions : [];
          const firstSession = sessions[0] as Record<string, unknown> | undefined;
          const sessionFromTrace = (
            typeof poll.trace.session === 'object' && poll.trace.session !== null
              ? poll.trace.session
              : firstSession
          ) as Record<string, unknown> | undefined;
          const responseTextFromTrace = typeof poll.trace.resultText === 'string'
            ? poll.trace.resultText
            : firstSession?.responseText;
          const deliveryPinIdFromTrace = typeof poll.trace.resultDeliveryPinId === 'string'
            ? poll.trace.resultDeliveryPinId
            : undefined;
          const ratingRequestTextFromTrace = typeof poll.trace.ratingRequestText === 'string'
            ? poll.trace.ratingRequestText
            : poll.trace.ratingRequestText === null
              ? null
              : undefined;
          return commandSuccess({
            ...result.data,
            ...(sessionFromTrace ? { session: sessionFromTrace } : {}),
            ...(responseTextFromTrace ? { responseText: responseTextFromTrace } : {}),
            ...(deliveryPinIdFromTrace ? { deliveryPinId: deliveryPinIdFromTrace } : {}),
            ...(ratingRequestTextFromTrace !== undefined ? { ratingRequestText: ratingRequestTextFromTrace } : {}),
            localUiUrl: result.localUiUrl,
          });
        }
      }
    }

    return result;
  }

  if (subcommand === 'rate') {
    const requestFile = readFlagValue(args, '--request-file');
    const from = readFromFlag(args);
    if (!requestFile) {
      return commandMissingFlag('--request-file');
    }

    const chainFlag = readChainWriteFlag(args);
    if (chainFlag.error) {
      return chainFlag.error;
    }

    const handler = context.dependencies.services?.rate;
    if (!handler) {
      return commandFailed('not_implemented', 'Services rate handler is not configured.');
    }

    const request = await readJsonFile(context, requestFile);
    return handler(applyOptionalActor(
      chainFlag.chain ? { ...request, network: chainFlag.chain } : request,
      from,
    ));
  }

  return commandUnknownSubcommand(`services ${args.join(' ')}`.trim());
}
