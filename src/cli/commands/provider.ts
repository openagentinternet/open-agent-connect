import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { commandUnknownSubcommand, readFlagValue } from './helpers';
import type { CliRuntimeContext } from '../types';

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
        'Provide --order-id <id> or --payment-txid <txid>.'
      ),
    };
  }
  if (orderId && paymentTxid) {
    return {
      ok: false,
      result: commandFailed(
        'ambiguous_seller_order_selector',
        'Use only one seller order selector: --order-id or --payment-txid.'
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

export async function runProviderCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>> {
  const [group, subcommand] = args;

  if (group === 'order' && subcommand === 'inspect') {
    const selector = readSellerOrderSelector(args.slice(2));
    if (!selector.ok) {
      return selector.result;
    }
    const handler = context.dependencies.provider?.inspectOrder;
    if (!handler) {
      return commandFailed('not_implemented', 'Provider order inspection handler is not configured.');
    }
    return handler(selector.selector);
  }

  if (group === 'refund' && subcommand === 'settle') {
    const selector = readSellerOrderSelector(args.slice(2));
    if (!selector.ok) {
      return selector.result;
    }
    const handler = context.dependencies.provider?.settleRefund;
    if (!handler) {
      return commandFailed('not_implemented', 'Provider refund settlement handler is not configured.');
    }
    return handler(selector.selector);
  }

  return commandUnknownSubcommand(`provider ${args.join(' ')}`.trim());
}
