import path from 'node:path';
import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { commandMissingFlag, commandUnknownSubcommand, readFileUploadChainFlag, readFlagValue, readJsonFile } from './helpers';
import type { CliRuntimeContext } from '../types';

function resolveMaybeRelativePath(baseDir: string, filePath: unknown): string | undefined {
  if (typeof filePath !== 'string') return undefined;
  return path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath);
}

export async function runFileCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>> {
  if (args[0] !== 'upload') {
    return commandUnknownSubcommand(`file ${args.join(' ')}`.trim());
  }

  const requestFile = readFlagValue(args, '--request-file');
  if (!requestFile) {
    return commandMissingFlag('--request-file');
  }

  const chainFlag = readFileUploadChainFlag(args);
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
  };
  return handler(resolvedRequest);
}
