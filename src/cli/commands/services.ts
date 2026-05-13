import { commandFailed, commandSuccess, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { commandMissingFlag, commandUnknownSubcommand, hasFlag, readChainWriteFlag, readFlagValue, readJsonFile } from './helpers';
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

function readPositiveIntegerFlag(args: string[], flag: string, fallback: number): number {
  const raw = readFlagValue(args, flag);
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readOwnedListInput(args: string[]): {
  from?: string;
  all: boolean;
  page: number;
  pageSize: number;
  refresh: boolean;
} {
  return {
    ...(readFromFlag(args) ? { from: readFromFlag(args) } : {}),
    all: hasFlag(args, '--all'),
    page: readPositiveIntegerFlag(args, '--page', 1),
    pageSize: readPositiveIntegerFlag(args, '--page-size', 20),
    refresh: hasFlag(args, '--refresh'),
  };
}

function readSellerOrderSelector(args: string[]): {
  ok: true;
  selector: { orderId?: string; paymentTxid?: string };
} | {
  ok: false;
  result: MetabotCommandResult<unknown>;
} {
  const orderId = readFlagValue(args, '--order-id');
  const paymentTxid = readFlagValue(args, '--payment-txid');
  if (!orderId && !paymentTxid) {
    return {
      ok: false,
      result: commandFailed(
        'missing_seller_order_selector',
        'Provide --order-id <id> or --payment-txid <txid>.',
      ),
    };
  }
  if (orderId && paymentTxid) {
    return {
      ok: false,
      result: commandFailed(
        'ambiguous_seller_order_selector',
        'Use only one seller order selector: --order-id or --payment-txid.',
      ),
    };
  }
  return {
    ok: true,
    selector: {
      ...(orderId ? { orderId } : {}),
      ...(paymentTxid ? { paymentTxid } : {}),
    },
  };
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

  if (subcommand === 'owned') {
    const ownedSubcommand = args[1];
    const ownedArgs = args.slice(2);

    if (ownedSubcommand === 'list') {
      const handler = context.dependencies.services?.listOwned;
      if (!handler) {
        return commandFailed('not_implemented', 'Owned services list handler is not configured.');
      }
      return handler(readOwnedListInput(ownedArgs));
    }

    if (ownedSubcommand === 'orders') {
      const serviceId = readFlagValue(ownedArgs, '--service-id');
      if (!serviceId) {
        return commandMissingFlag('--service-id');
      }
      const handler = context.dependencies.services?.listOwnedOrders;
      if (!handler) {
        return commandFailed('not_implemented', 'Owned service orders handler is not configured.');
      }
      return handler({
        serviceId,
        ...readOwnedListInput(ownedArgs),
      });
    }

    if (ownedSubcommand === 'modify') {
      if (hasFlag(ownedArgs, '--all')) {
        return commandFailed('invalid_flag', '--all is only valid for owned service read commands.');
      }
      const payloadFile = readFlagValue(ownedArgs, '--payload-file');
      if (!payloadFile) {
        return commandMissingFlag('--payload-file');
      }
      const chainFlag = readChainWriteFlag(ownedArgs);
      if (chainFlag.error) {
        return chainFlag.error;
      }
      const handler = context.dependencies.services?.modifyOwned;
      if (!handler) {
        return commandFailed('not_implemented', 'Owned service modify handler is not configured.');
      }
      const payload = await readJsonFile(context, payloadFile);
      return handler(applyOptionalActor(
        chainFlag.chain ? { ...payload, network: chainFlag.chain } : payload,
        readFromFlag(ownedArgs),
      ));
    }

    if (ownedSubcommand === 'revoke') {
      if (hasFlag(ownedArgs, '--all')) {
        return commandFailed('invalid_flag', '--all is only valid for owned service read commands.');
      }
      const serviceId = readFlagValue(ownedArgs, '--service-id');
      if (!serviceId) {
        return commandMissingFlag('--service-id');
      }
      const chainFlag = readChainWriteFlag(ownedArgs);
      if (chainFlag.error) {
        return chainFlag.error;
      }
      const handler = context.dependencies.services?.revokeOwned;
      if (!handler) {
        return commandFailed('not_implemented', 'Owned service revoke handler is not configured.');
      }
      const from = readFromFlag(ownedArgs);
      return handler({
        serviceId,
        ...(from ? { from } : {}),
        ...(chainFlag.chain ? { network: chainFlag.chain } : {}),
      });
    }

    return commandUnknownSubcommand(`services owned ${ownedArgs.join(' ')}`.trim());
  }

  if (subcommand === 'refunds') {
    const refundsSubcommand = args[1];
    const refundsArgs = args.slice(2);

    if (refundsSubcommand === 'list') {
      const handler = context.dependencies.services?.listRefunds;
      if (!handler) {
        return commandFailed('not_implemented', 'Services refund list handler is not configured.');
      }
      const from = readFromFlag(refundsArgs);
      const kind = hasFlag(refundsArgs, '--initiated')
        ? 'initiated'
        : hasFlag(refundsArgs, '--received')
          ? 'received'
          : 'all';
      return handler({
        ...(from ? { from } : {}),
        all: hasFlag(refundsArgs, '--all'),
        kind,
      });
    }

    if (refundsSubcommand === 'settle') {
      const selector = readSellerOrderSelector(refundsArgs);
      if (!selector.ok) {
        return selector.result;
      }
      const handler = context.dependencies.services?.settleRefund;
      if (!handler) {
        return commandFailed('not_implemented', 'Services refund settlement handler is not configured.');
      }
      const from = readFromFlag(refundsArgs);
      return handler({
        ...(from ? { from } : {}),
        ...selector.selector,
      });
    }

    return commandUnknownSubcommand(`services refunds ${refundsArgs.join(' ')}`.trim());
  }

  if (subcommand === 'orders') {
    const ordersSubcommand = args[1];
    const ordersArgs = args.slice(2);

    if (ordersSubcommand === 'inspect') {
      const selector = readSellerOrderSelector(ordersArgs);
      if (!selector.ok) {
        return selector.result;
      }
      const handler = context.dependencies.services?.inspectOrder;
      if (!handler) {
        return commandFailed('not_implemented', 'Services order inspection handler is not configured.');
      }
      const from = readFromFlag(ordersArgs);
      return handler({
        ...(from ? { from } : {}),
        ...selector.selector,
      });
    }

    return commandUnknownSubcommand(`services orders ${ordersArgs.join(' ')}`.trim());
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
