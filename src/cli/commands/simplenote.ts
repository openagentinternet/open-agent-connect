import path from 'node:path';
import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { commandMissingFlag, commandUnknownSubcommand, readChainWriteFlag, readFlagValue, readFromFlag, readJsonFile } from './helpers';
import type { CliRuntimeContext } from '../types';

function resolveMaybeRelativePath(baseDir: string, filePath: unknown): string | undefined {
  if (typeof filePath !== 'string') return undefined;
  if (path.isAbsolute(filePath)) return filePath;
  // URI-shaped values (metafile://…) pass through untouched.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(filePath)) return filePath;
  return path.resolve(baseDir, filePath);
}

function resolveFileList(baseDir: string, value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((entry) => resolveMaybeRelativePath(baseDir, entry) ?? entry);
}

export async function runSimpleNoteCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>> {
  if (args[0] !== 'post') {
    return commandUnknownSubcommand(`simplenote ${args.join(' ')}`.trim());
  }

  const requestFile = readFlagValue(args, '--request-file');
  if (!requestFile) {
    return commandMissingFlag('--request-file');
  }
  const from = readFromFlag(args);

  const chainFlag = readChainWriteFlag(args);
  if (chainFlag.error) {
    return chainFlag.error;
  }

  const handler = context.dependencies.simplenote?.post;
  if (!handler) {
    return commandFailed('not_implemented', 'SimpleNote post handler is not configured.');
  }

  const request = await readJsonFile(context, requestFile);
  const requestDir = path.dirname(path.isAbsolute(requestFile) ? requestFile : path.resolve(context.cwd, requestFile));
  const cover = resolveMaybeRelativePath(requestDir, request.cover);
  const attachments = resolveFileList(requestDir, request.attachments);
  const resolvedRequest = {
    ...request,
    // content_type mirrors the CLI-facing name the skill uses.
    contentType: request.contentType ?? request.content_type,
    ...(cover ? { cover } : {}),
    ...(attachments === undefined ? {} : { attachments }),
    ...(chainFlag.chain ? { network: chainFlag.chain } : {}),
    ...(from ? { from } : {}),
  };
  return handler(resolvedRequest);
}
