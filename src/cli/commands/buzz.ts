import path from 'node:path';
import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { commandMissingFlag, commandUnknownSubcommand, readFlagValue, readJsonFile } from './helpers';
import type { CliRuntimeContext } from '../types';

function resolveMaybeRelativePath(baseDir: string, filePath: unknown): string | undefined {
  if (typeof filePath !== 'string') return undefined;
  return path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath);
}

function resolveAttachmentPaths(baseDir: string, value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }
  return value.map((entry) => resolveMaybeRelativePath(baseDir, entry) ?? entry);
}

export async function runBuzzCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>> {
  if (args[0] !== 'post') {
    return commandUnknownSubcommand(`buzz ${args.join(' ')}`.trim());
  }

  const requestFile = readFlagValue(args, '--request-file');
  if (!requestFile) {
    return commandMissingFlag('--request-file');
  }

  const handler = context.dependencies.buzz?.post;
  if (!handler) {
    return commandFailed('not_implemented', 'Buzz post handler is not configured.');
  }

  const request = await readJsonFile(context, requestFile);
  const requestDir = path.dirname(path.isAbsolute(requestFile) ? requestFile : path.resolve(context.cwd, requestFile));
  const resolvedRequest = {
    ...request,
    attachments: resolveAttachmentPaths(requestDir, request.attachments),
  };
  return handler(resolvedRequest);
}
