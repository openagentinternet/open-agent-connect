import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import {
  commandMissingFlag,
  commandUnknownSubcommand,
  hasFlag,
  readChainWriteFlag,
  readFileUploadChainFlag,
  readFlagValue,
  readFromFlag,
} from './helpers';
import type { CliRuntimeContext } from '../types';

function readRequiredFlag(args: string[], flag: string): {
  ok: true;
  value: string;
} | { ok: false; result: MetabotCommandResult<never> } {
  const value = readFlagValue(args, flag);
  if (!value || value.startsWith('--')) {
    return { ok: false, result: commandMissingFlag(flag) };
  }
  return { ok: true, value };
}

function readOptionalFlag(args: string[], flag: string): string | undefined {
  const value = readFlagValue(args, flag);
  return value && !value.startsWith('--') ? value : undefined;
}

function commandNotImplemented(command: string): MetabotCommandResult<never> {
  return commandFailed('not_implemented', `MetaApp ${command} handler is not configured.`);
}

function commandInvalidFlag(message: string): MetabotCommandResult<never> {
  return commandFailed('invalid_flag', message);
}

export async function runMetaAppCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>> {
  const subcommand = args[0];

  if (subcommand === 'preview') {
    const projectDir = readRequiredFlag(args, '--project-dir');
    if (!projectDir.ok) {
      return projectDir.result;
    }

    const handler = context.dependencies.metaapp?.preview;
    if (!handler) {
      return commandNotImplemented('preview');
    }

    const manifestFile = readOptionalFlag(args, '--manifest-file');
    return handler({
      projectDir: projectDir.value,
      ...(manifestFile ? { manifestFile } : {}),
      open: hasFlag(args, '--open'),
    });
  }

  if (subcommand === 'publish') {
    const projectDir = readRequiredFlag(args, '--project-dir');
    if (!projectDir.ok) {
      return projectDir.result;
    }

    const chainFlag = readFileUploadChainFlag(args);
    if (chainFlag.error) {
      return chainFlag.error;
    }

    const handler = context.dependencies.metaapp?.publish;
    if (!handler) {
      return commandNotImplemented('publish');
    }

    const from = readFromFlag(args);
    const manifestFile = readOptionalFlag(args, '--manifest-file');
    return handler({
      projectDir: projectDir.value,
      ...(manifestFile ? { manifestFile } : {}),
      ...(from ? { from } : {}),
      ...(chainFlag.chain ? { network: chainFlag.chain } : {}),
      confirm: hasFlag(args, '--confirm'),
    });
  }

  if (subcommand === 'update') {
    const projectDir = readRequiredFlag(args, '--project-dir');
    if (!projectDir.ok) {
      return projectDir.result;
    }

    const targetPinId = readRequiredFlag(args, '--target-pin-id');
    if (!targetPinId.ok) {
      return targetPinId.result;
    }

    const chainFlag = readFileUploadChainFlag(args);
    if (chainFlag.error) {
      return chainFlag.error;
    }

    const handler = context.dependencies.metaapp?.update;
    if (!handler) {
      return commandNotImplemented('update');
    }

    const from = readFromFlag(args);
    const manifestFile = readOptionalFlag(args, '--manifest-file');
    return handler({
      projectDir: projectDir.value,
      targetPinId: targetPinId.value,
      ...(manifestFile ? { manifestFile } : {}),
      ...(from ? { from } : {}),
      ...(chainFlag.chain ? { network: chainFlag.chain } : {}),
      confirm: hasFlag(args, '--confirm'),
    });
  }

  if (subcommand === 'share') {
    const pinId = readRequiredFlag(args, '--pin-id');
    if (!pinId.ok) {
      return pinId.result;
    }

    const announce = hasFlag(args, '--announce');
    const chainFlag = announce ? readChainWriteFlag(args) : { chain: null, error: null };
    if (chainFlag.error) {
      return chainFlag.error;
    }

    const handler = context.dependencies.metaapp?.share;
    if (!handler) {
      return commandNotImplemented('share');
    }

    const from = readFromFlag(args);
    return handler({
      pinId: pinId.value,
      ...(from ? { from } : {}),
      ...(chainFlag.chain ? { network: chainFlag.chain } : {}),
      announce,
    });
  }

  if (subcommand === 'view') {
    const pinId = readOptionalFlag(args, '--pin-id');
    const firstPinId = readOptionalFlag(args, '--first-pin-id');
    const mine = hasFlag(args, '--mine');

    if (pinId && firstPinId) {
      return commandInvalidFlag('Use only one MetaApp selector: --pin-id or --first-pin-id.');
    }
    if (mine && (pinId || firstPinId)) {
      return commandInvalidFlag('Use --mine by itself; it cannot be combined with --pin-id or --first-pin-id.');
    }

    const handler = context.dependencies.metaapp?.view;
    if (!handler) {
      return commandNotImplemented('view');
    }

    const from = readFromFlag(args);
    return handler({
      ...(pinId ? { pinId } : {}),
      ...(firstPinId ? { firstPinId } : {}),
      ...(from ? { from } : {}),
      mine,
    });
  }

  if (subcommand === 'comment') {
    const pinId = readRequiredFlag(args, '--pin-id');
    if (!pinId.ok) {
      return pinId.result;
    }
    const comment = readRequiredFlag(args, '--comment');
    if (!comment.ok) {
      return comment.result;
    }

    const chainFlag = readChainWriteFlag(args);
    if (chainFlag.error) {
      return chainFlag.error;
    }

    const handler = context.dependencies.metaapp?.comment;
    if (!handler) {
      return commandNotImplemented('comment');
    }

    const from = readFromFlag(args);
    return handler({
      pinId: pinId.value,
      ...(from ? { from } : {}),
      ...(chainFlag.chain ? { network: chainFlag.chain } : {}),
      comment: comment.value,
    });
  }

  return commandUnknownSubcommand(`metaapp ${args.join(' ')}`.trim());
}
