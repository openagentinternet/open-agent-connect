import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import {
  commandMissingFlag,
  commandUnknownSubcommand,
  hasFlag,
  readChainWriteFlag,
  readFlagValue,
  readFromFlag,
  readJsonFile,
} from './helpers';
import type { CliRuntimeContext } from '../types';

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
  const from = readFromFlag(args);
  return {
    ...(from ? { from } : {}),
    all: hasFlag(args, '--all'),
    page: readPositiveIntegerFlag(args, '--page', 1),
    pageSize: readPositiveIntegerFlag(args, '--page-size', 20),
    refresh: hasFlag(args, '--refresh'),
  };
}

function readProductOrderRole(args: string[]): 'buyer' | 'seller' | 'all' {
  const role = readFlagValue(args, '--role')?.trim().toLowerCase();
  return role === 'seller' || role === 'all' ? role : 'buyer';
}

function readProductOrderListInput(args: string[]): {
  from?: string;
  all: boolean;
  role: 'buyer' | 'seller' | 'all';
  state?: string;
  page: number;
  pageSize: number;
} {
  const from = readFromFlag(args);
  const state = readFlagValue(args, '--state')?.trim();
  return {
    ...(from ? { from } : {}),
    all: hasFlag(args, '--all'),
    role: readProductOrderRole(args),
    ...(state ? { state } : {}),
    page: readPositiveIntegerFlag(args, '--page', 1),
    pageSize: readPositiveIntegerFlag(args, '--page-size', 20),
  };
}

function readProductOrderSelector(args: string[]): {
  ok: true;
  selector: {
    orderId?: string;
    productOrderPinId?: string;
    paymentTxid?: string;
    orderTxid?: string;
  };
} | {
  ok: false;
  result: MetabotCommandResult<unknown>;
} {
  const selectors = [
    ['orderId', readFlagValue(args, '--order-id')],
    ['productOrderPinId', readFlagValue(args, '--product-order-pin-id')],
    ['paymentTxid', readFlagValue(args, '--payment-txid')],
    ['orderTxid', readFlagValue(args, '--order-txid')],
  ] as const;
  const selected = selectors.filter(([, value]) => typeof value === 'string' && value.trim() && !value.startsWith('--'));
  if (selected.length === 0) {
    return {
      ok: false,
      result: commandFailed(
        'missing_product_order_selector',
        'Provide exactly one product order selector: --order-id, --product-order-pin-id, --payment-txid, or --order-txid.',
      ),
    };
  }
  if (selected.length > 1) {
    return {
      ok: false,
      result: commandFailed(
        'ambiguous_product_order_selector',
        'Use only one product order selector: --order-id, --product-order-pin-id, --payment-txid, or --order-txid.',
      ),
    };
  }
  const [key, value] = selected[0];
  return {
    ok: true,
    selector: { [key]: value!.trim() },
  };
}

export async function runProductsCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>> {
  const subcommand = args[0];

  if (subcommand === 'skills') {
    const handler = context.dependencies.products?.listPublishSkills;
    if (!handler) {
      return commandFailed('not_implemented', 'Product publish skills handler is not configured.');
    }
    const from = readFromFlag(args);
    return handler(from ? { from } : undefined);
  }

  if (subcommand === 'publish') {
    const payloadFile = readFlagValue(args, '--payload-file');
    if (!payloadFile) {
      return commandMissingFlag('--payload-file');
    }

    const chainFlag = readChainWriteFlag(args);
    if (chainFlag.error) {
      return chainFlag.error;
    }

    const handler = context.dependencies.products?.publish;
    if (!handler) {
      return commandFailed('not_implemented', 'Product publish handler is not configured.');
    }

    const payload = await readJsonFile(context, payloadFile);
    const from = readFromFlag(args);
    return handler(applyOptionalActor(
      chainFlag.chain ? { ...payload, network: chainFlag.chain } : payload,
      from,
    ));
  }

  if (subcommand === 'buy') {
    const requestFile = readFlagValue(args, '--request-file');
    if (!requestFile) {
      return commandMissingFlag('--request-file');
    }

    const handler = context.dependencies.products?.buy;
    if (!handler) {
      return commandFailed('not_implemented', 'Product buy handler is not configured.');
    }

    const request = await readJsonFile(context, requestFile);
    const from = readFromFlag(args);
    return handler(applyOptionalActor(request, from));
  }

  if (subcommand === 'owned') {
    const ownedSubcommand = args[1];
    const ownedArgs = args.slice(2);

    if (ownedSubcommand === 'list') {
      const handler = context.dependencies.products?.listOwned;
      if (!handler) {
        return commandFailed('not_implemented', 'Owned products list handler is not configured.');
      }
      return handler(readOwnedListInput(ownedArgs));
    }

    return commandUnknownSubcommand(`products owned ${ownedArgs.join(' ')}`.trim());
  }

  if (subcommand === 'orders') {
    const ordersSubcommand = args[1];
    const ordersArgs = args.slice(2);

    if (ordersSubcommand === 'list') {
      const handler = context.dependencies.products?.listOrders;
      if (!handler) {
        return commandFailed('not_implemented', 'Product orders list handler is not configured.');
      }
      return handler(readProductOrderListInput(ordersArgs));
    }

    if (ordersSubcommand === 'inspect') {
      const selector = readProductOrderSelector(ordersArgs);
      if (!selector.ok) {
        return selector.result;
      }
      const handler = context.dependencies.products?.inspectOrder;
      if (!handler) {
        return commandFailed('not_implemented', 'Product order inspection handler is not configured.');
      }
      const from = readFromFlag(ordersArgs);
      return handler({
        ...(from ? { from } : {}),
        ...selector.selector,
      });
    }

    return commandUnknownSubcommand(`products orders ${ordersArgs.join(' ')}`.trim());
  }

  return commandUnknownSubcommand(`products ${args.join(' ')}`.trim());
}
