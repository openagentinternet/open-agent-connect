import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import {
  commandMissingFlag,
  commandUnknownSubcommand,
  hasFlag,
  readChainWriteFlag,
  readFileUploadChainFlag,
  readFlagValue,
  readFromFlag,
  readJsonFile,
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

function readOptionalValueFlag(args: string[], flag: string): {
  ok: true;
  value?: string;
} | { ok: false; result: MetabotCommandResult<never> } {
  if (!args.includes(flag)) {
    return { ok: true };
  }
  const value = readFlagValue(args, flag);
  if (!value || value.startsWith('--')) {
    return { ok: false, result: commandInvalidFlag(`${flag} requires a value.`) };
  }
  return { ok: true, value };
}

function commandNotImplemented(command: string): MetabotCommandResult<never> {
  return commandFailed('not_implemented', `MetaApp ${command} handler is not configured.`);
}

function commandInvalidFlag(message: string): MetabotCommandResult<never> {
  return commandFailed('invalid_flag', message);
}

function confirmationRequired(message: string): MetabotCommandResult<never> {
  return commandFailed('confirmation_required', message);
}

function migrationError(message: string): MetabotCommandResult<never> {
  return commandFailed('invalid_flag', message);
}

function readPositiveIntegerFlag(args: string[], flag: string, fallback: number): {
  ok: true;
  value: number;
} | { ok: false; result: MetabotCommandResult<never> } {
  const index = args.indexOf(flag);
  if (index === -1) {
    return { ok: true, value: fallback };
  }

  const raw = args[index + 1];
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) {
    return { ok: false, result: commandInvalidFlag(`${flag} must be a positive integer.`) };
  }

  return { ok: true, value: Number.parseInt(raw, 10) };
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

  if (subcommand === 'list') {
    const size = readPositiveIntegerFlag(args, '--size', 12);
    if (!size.ok) {
      return size.result;
    }

    const handler = context.dependencies.metaapp?.list;
    if (!handler) {
      return commandNotImplemented('list');
    }

    const from = readFromFlag(args);
    const cursor = readOptionalFlag(args, '--cursor');
    return handler({
      ...(from ? { from } : {}),
      size: size.value,
      ...(cursor ? { cursor } : {}),
    });
  }

  if (subcommand === 'publish') {
    if (args.includes('--project-dir')) {
      return migrationError('Use metabot metaapp publish-project for project-directory publishing. metabot metaapp publish now requires --payload-file.');
    }

    const payloadFile = readRequiredFlag(args, '--payload-file');
    if (!payloadFile.ok) {
      return payloadFile.result;
    }

    if (!hasFlag(args, '--confirm')) {
      return confirmationRequired('metabot metaapp publish requires --confirm.');
    }

    const chainFlag = readChainWriteFlag(args);
    if (chainFlag.error) {
      return chainFlag.error;
    }

    const handler = context.dependencies.metaapp?.publish;
    if (!handler) {
      return commandNotImplemented('publish');
    }

    const from = readFromFlag(args);
    const payload = await readJsonFile(context, payloadFile.value);
    return handler({
      ...payload,
      ...(chainFlag.chain ? { network: chainFlag.chain } : {}),
      ...(from ? { from } : {}),
      confirm: true,
    });
  }

  if (subcommand === 'update') {
    if (args.includes('--project-dir')) {
      return migrationError('Use metabot metaapp update-project for project-directory publishing. metabot metaapp update now requires --payload-file.');
    }

    const targetPinId = readRequiredFlag(args, '--target-pin-id');
    if (!targetPinId.ok) {
      return targetPinId.result;
    }

    const payloadFile = readRequiredFlag(args, '--payload-file');
    if (!payloadFile.ok) {
      return payloadFile.result;
    }

    if (!hasFlag(args, '--confirm')) {
      return confirmationRequired('metabot metaapp update requires --confirm.');
    }

    const chainFlag = readChainWriteFlag(args);
    if (chainFlag.error) {
      return chainFlag.error;
    }

    const handler = context.dependencies.metaapp?.update;
    if (!handler) {
      return commandNotImplemented('update');
    }

    const from = readFromFlag(args);
    const payload = await readJsonFile(context, payloadFile.value);
    return handler({
      ...payload,
      targetPinId: targetPinId.value,
      ...(chainFlag.chain ? { network: chainFlag.chain } : {}),
      ...(from ? { from } : {}),
      confirm: true,
    });
  }

  if (subcommand === 'delete') {
    const targetPinId = readRequiredFlag(args, '--target-pin-id');
    if (!targetPinId.ok) {
      return targetPinId.result;
    }

    if (!hasFlag(args, '--confirm')) {
      return confirmationRequired('metabot metaapp delete requires --confirm.');
    }

    const chainFlag = readChainWriteFlag(args);
    if (chainFlag.error) {
      return chainFlag.error;
    }

    const handler = context.dependencies.metaapp?.delete;
    if (!handler) {
      return commandNotImplemented('delete');
    }

    const from = readFromFlag(args);
    return handler({
      targetPinId: targetPinId.value,
      ...(chainFlag.chain ? { network: chainFlag.chain } : {}),
      ...(from ? { from } : {}),
      confirm: true,
    });
  }

  if (subcommand === 'publish-project') {
    const projectDir = readRequiredFlag(args, '--project-dir');
    if (!projectDir.ok) {
      return projectDir.result;
    }

    const chainFlag = readFileUploadChainFlag(args);
    if (chainFlag.error) {
      return chainFlag.error;
    }

    const handler = context.dependencies.metaapp?.publishProject;
    if (!handler) {
      return commandNotImplemented('publish-project');
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

  if (subcommand === 'update-project') {
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

    const handler = context.dependencies.metaapp?.updateProject;
    if (!handler) {
      return commandNotImplemented('update-project');
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
    const pinIdInput = readOptionalValueFlag(args, '--pin-id');
    if (!pinIdInput.ok) {
      return pinIdInput.result;
    }
    const firstPinIdInput = readOptionalValueFlag(args, '--first-pin-id');
    if (!firstPinIdInput.ok) {
      return firstPinIdInput.result;
    }

    const pinId = pinIdInput.value;
    const firstPinId = firstPinIdInput.value;
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
