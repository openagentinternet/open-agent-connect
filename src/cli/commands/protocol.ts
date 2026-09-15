/**
 * `metabot protocol …` — the MetaID protocol registry (/protocols/metaprotocol,
 * docs/metaid_protocols/metaprotocol-registry-agent-tools.md): read verbs
 * (list / read / versions / check) run in-process against the metaso-p2p
 * registry projection, and the publish / update writers go through the
 * daemon's /api/protocol/* routes with --request-file + --from. OAC port of
 * the IDBots feat/metaprotocol-registry-tools CLI surface.
 */

import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import {
  commandMissingFlag,
  commandUnknownSubcommand,
  readChainWriteFlag,
  readFlagValue,
  readFromFlag,
  readJsonFile,
} from './helpers';
import type { CliRuntimeContext } from '../types';

function commandNotImplemented(command: string): MetabotCommandResult<never> {
  return {
    ok: false,
    state: 'failed',
    code: 'not_implemented',
    message: `The "${command}" protocol command is not configured in this runtime.`,
  };
}

function readNumberFlag(args: string[], flag: string): number | undefined {
  const raw = readFlagValue(args, flag);
  if (raw == null) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readLocator(args: string[]): { protocolPath?: string; protocolName?: string; pinId?: string } {
  return {
    ...(readFlagValue(args, '--path') ? { protocolPath: readFlagValue(args, '--path')! } : {}),
    ...(readFlagValue(args, '--name') ? { protocolName: readFlagValue(args, '--name')! } : {}),
    ...(readFlagValue(args, '--pin') ? { pinId: readFlagValue(args, '--pin')! } : {}),
  };
}

export async function runProtocolCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>> {
  const subcommand = args[0];

  if (subcommand === 'list') {
    const handler = context.dependencies.protocol?.list;
    if (!handler) return commandNotImplemented('list');
    return handler({
      ...(readFlagValue(args, '--query') ? { query: readFlagValue(args, '--query') } : {}),
      ...(readFlagValue(args, '--publisher') ? { publisher: readFlagValue(args, '--publisher') } : {}),
      ...(readNumberFlag(args, '--size') != null ? { size: readNumberFlag(args, '--size') } : {}),
      ...(readFlagValue(args, '--cursor') ? { cursor: readFlagValue(args, '--cursor') } : {}),
    });
  }

  if (subcommand === 'read' || subcommand === 'versions') {
    const handler = subcommand === 'read' ? context.dependencies.protocol?.read : context.dependencies.protocol?.versions;
    if (!handler) return commandNotImplemented(subcommand);
    const locator = readLocator(args);
    if (!locator.protocolPath && !locator.protocolName && !locator.pinId) {
      return commandMissingFlag('--path');
    }
    return handler(locator);
  }

  if (subcommand === 'check') {
    const protocolPath = readFlagValue(args, '--path');
    if (!protocolPath) return commandMissingFlag('--path');
    const handler = context.dependencies.protocol?.check;
    if (!handler) return commandNotImplemented('check');
    return handler({ protocolPath });
  }

  if (subcommand === 'publish' || subcommand === 'update') {
    const requestFile = readFlagValue(args, '--request-file');
    if (!requestFile) {
      return commandMissingFlag('--request-file');
    }
    const from = readFromFlag(args);
    const chainFlag = readChainWriteFlag(args);
    if (chainFlag.error) {
      return chainFlag.error;
    }
    const handler = subcommand === 'publish' ? context.dependencies.protocol?.publish : context.dependencies.protocol?.update;
    if (!handler) return commandNotImplemented(subcommand);
    const request = await readJsonFile(context, requestFile);
    const resolvedRequest = {
      ...request,
      // snake_case mirrors of the tool-facing field names (qanda pattern).
      ...(request.protocol_name != null && request.protocolName == null
        ? { protocolName: request.protocol_name }
        : {}),
      ...(request.protocol_content_type != null && request.protocolContentType == null
        ? { protocolContentType: request.protocol_content_type }
        : {}),
      ...(request.protocol_content != null && request.protocolContent == null
        ? { protocolContent: request.protocol_content }
        : {}),
      ...(chainFlag.chain ? { network: chainFlag.chain } : {}),
      ...(from ? { from } : {}),
    };
    return handler(resolvedRequest);
  }

  if (subcommand === undefined) {
    return commandFailed('missing_subcommand', 'Usage: metabot protocol <list|read|versions|check|publish|update> …');
  }
  return commandUnknownSubcommand(`protocol ${args.join(' ')}`.trim());
}
