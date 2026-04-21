import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import {
  commandMissingFlag,
  commandUnknownSubcommand,
  hasFlag,
  readChainFlag,
  readFlagValue,
  readJsonFile,
} from './helpers';
import type { CliRuntimeContext } from '../types';

export async function runMasterCommand(
  args: string[],
  context: CliRuntimeContext
): Promise<MetabotCommandResult<unknown>> {
  const subcommand = args[0];

  if (subcommand === 'publish') {
    const payloadFile = readFlagValue(args, '--payload-file');
    if (!payloadFile) {
      return commandMissingFlag('--payload-file');
    }

    const chainFlag = readChainFlag(args);
    if (chainFlag.error) {
      return chainFlag.error;
    }

    const handler = context.dependencies.master?.publish;
    if (!handler) {
      return commandFailed('not_implemented', 'Master publish handler is not configured.');
    }

    const payload = await readJsonFile(context, payloadFile);
    return handler(chainFlag.chain ? { ...payload, network: chainFlag.chain } : payload);
  }

  if (subcommand === 'list') {
    const handler = context.dependencies.master?.list;
    if (!handler) {
      return commandFailed('not_implemented', 'Master list handler is not configured.');
    }

    return handler({
      online: hasFlag(args, '--online') ? true : undefined,
      masterKind: readFlagValue(args, '--kind') ?? undefined,
    });
  }

  if (subcommand === 'ask') {
    const handler = context.dependencies.master?.ask;
    if (!handler) {
      return commandFailed('not_implemented', 'Master ask handler is not configured.');
    }

    const confirm = hasFlag(args, '--confirm');
    const traceId = readFlagValue(args, '--trace-id');
    if (traceId) {
      return handler({
        traceId,
        confirm,
      });
    }

    const requestFile = readFlagValue(args, '--request-file');
    if (!requestFile) {
      return commandMissingFlag('--request-file');
    }
    if (confirm) {
      return commandFailed(
        'invalid_argument',
        '`metabot master ask --confirm` requires `--trace-id <trace-id>` and cannot be combined with `--request-file`.',
      );
    }

    const payload = await readJsonFile(context, requestFile);
    return handler({
      ...payload,
      confirm,
    });
  }

  if (subcommand === 'suggest') {
    const handler = context.dependencies.master?.suggest;
    if (!handler) {
      return commandFailed('not_implemented', 'Master suggest handler is not configured.');
    }

    const requestFile = readFlagValue(args, '--request-file');
    if (!requestFile) {
      return commandMissingFlag('--request-file');
    }

    const payload = await readJsonFile(context, requestFile);
    return handler(payload);
  }

  if (subcommand === 'host-action') {
    const handler = context.dependencies.master?.hostAction;
    if (!handler) {
      return commandFailed('not_implemented', 'Master host-action handler is not configured.');
    }

    const requestFile = readFlagValue(args, '--request-file');
    if (!requestFile) {
      return commandMissingFlag('--request-file');
    }

    const payload = await readJsonFile(context, requestFile);
    return handler(payload);
  }

  if (subcommand === 'trace') {
    const traceId = readFlagValue(args, '--id');
    if (!traceId) {
      return commandMissingFlag('--id');
    }

    const handler = context.dependencies.master?.trace;
    if (!handler) {
      return commandFailed('not_implemented', 'Master trace handler is not configured.');
    }

    return handler({ traceId });
  }

  return commandUnknownSubcommand(`master ${args.join(' ')}`.trim());
}
