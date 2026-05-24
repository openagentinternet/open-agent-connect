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

  return commandUnknownSubcommand(`products ${args.join(' ')}`.trim());
}
