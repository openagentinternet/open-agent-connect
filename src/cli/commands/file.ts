import path from 'node:path';
import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { commandMissingFlag, commandUnknownSubcommand, hasFlag, readFileUploadChainFlag, readFlagValue, readFromFlag, readJsonFile } from './helpers';
import type { CliRuntimeContext } from '../types';

const UPLOAD_LARGE_SOURCE_MESSAGE = 'Choose exactly one upload file source: --file, positional path, or --request-file.';
const UPLOAD_LARGE_POSITIONAL_VALUE_FLAGS = new Set([
  '--request-file',
  '--file',
  '--content-type',
  '--from',
  '--chain',
]);

function resolveMaybeRelativePath(baseDir: string, filePath: unknown): string | undefined {
  if (typeof filePath !== 'string') return undefined;
  return path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath);
}

function readNonEmptyFlagValue(args: string[], flag: string): string | undefined {
  const value = readFlagValue(args, flag);
  if (typeof value !== 'string' || value.startsWith('--') || value.trim() === '') {
    return undefined;
  }
  return value;
}

function validateDirectInputFlagValue(args: string[], flag: string): MetabotCommandResult<never> | null {
  const index = args.indexOf(flag);
  if (index === -1) {
    return null;
  }
  const value = args[index + 1];
  if (typeof value !== 'string' || value.startsWith('--') || value.trim() === '') {
    return commandFailed('invalid_flag', `Missing value for ${flag}.`);
  }
  return null;
}

function collectUploadLargePositionalPaths(args: string[]): string[] {
  const positionalPaths: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (UPLOAD_LARGE_POSITIONAL_VALUE_FLAGS.has(arg)) {
      index += 1;
      continue;
    }
    if (arg.startsWith('--')) {
      continue;
    }
    positionalPaths.push(arg);
  }
  return positionalPaths;
}

export async function runFileCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>> {
  const subcommand = args[0];
  if (subcommand !== 'upload' && subcommand !== 'upload-large') {
    return commandUnknownSubcommand(`file ${args.join(' ')}`.trim());
  }

  const commandArgs = args.slice(1);

  if (subcommand === 'upload') {
    const requestFile = readFlagValue(commandArgs, '--request-file');
    if (!requestFile) {
      return commandMissingFlag('--request-file');
    }
    const from = readFromFlag(commandArgs);

    const chainFlag = readFileUploadChainFlag(commandArgs);
    if (chainFlag.error) {
      return chainFlag.error;
    }

    const handler = context.dependencies.file?.upload;
    if (!handler) {
      return commandFailed('not_implemented', 'File upload handler is not configured.');
    }

    const request = await readJsonFile(context, requestFile);
    const requestDir = path.dirname(path.isAbsolute(requestFile) ? requestFile : path.resolve(context.cwd, requestFile));
    const resolvedRequest = {
      ...request,
      filePath: resolveMaybeRelativePath(requestDir, request.filePath) ?? request.filePath,
      ...(chainFlag.chain ? { network: chainFlag.chain } : {}),
      ...(from ? { from } : {}),
    };
    return handler(resolvedRequest);
  }

  const from = readFromFlag(commandArgs);
  const chainFlag = readFileUploadChainFlag(commandArgs);
  if (chainFlag.error) {
    return chainFlag.error;
  }

  const requestFile = readFlagValue(commandArgs, '--request-file');
  const fileFlagError = validateDirectInputFlagValue(commandArgs, '--file');
  if (fileFlagError) {
    return fileFlagError;
  }
  const contentTypeFlagError = validateDirectInputFlagValue(commandArgs, '--content-type');
  if (contentTypeFlagError) {
    return contentTypeFlagError;
  }
  const fileFlag = readNonEmptyFlagValue(commandArgs, '--file');
  const positionalPaths = collectUploadLargePositionalPaths(commandArgs);
  if (positionalPaths.length > 1) {
    return commandFailed('invalid_flag', UPLOAD_LARGE_SOURCE_MESSAGE);
  }

  const sourceCount = [requestFile, fileFlag, positionalPaths[0]].filter(Boolean).length;
  if (sourceCount > 1) {
    return commandFailed('invalid_flag', UPLOAD_LARGE_SOURCE_MESSAGE);
  }
  if (sourceCount === 0) {
    return commandMissingFlag('--request-file');
  }

  const handler = context.dependencies.file?.uploadLarge;
  if (!handler) {
    return commandFailed('not_implemented', 'Large file upload handler is not configured.');
  }

  if (!requestFile) {
    const contentType = readNonEmptyFlagValue(commandArgs, '--content-type')?.trim();
    const filePath = fileFlag ?? positionalPaths[0];
    return handler({
      filePath,
      ...(contentType ? { contentType } : {}),
      ...(chainFlag.chain ? { network: chainFlag.chain } : {}),
      ...(from ? { from } : {}),
      ...(hasFlag(commandArgs, '--verify') ? { verify: true } : {}),
    });
  }

  const request = await readJsonFile(context, requestFile);
  const requestDir = path.dirname(path.isAbsolute(requestFile) ? requestFile : path.resolve(context.cwd, requestFile));
  const resolvedRequest = {
    ...request,
    filePath: resolveMaybeRelativePath(requestDir, request.filePath) ?? request.filePath,
    ...(chainFlag.chain ? { network: chainFlag.chain } : {}),
    ...(from ? { from } : {}),
    ...(hasFlag(commandArgs, '--verify') ? { verify: true } : {}),
  };
  return handler(resolvedRequest);
}
