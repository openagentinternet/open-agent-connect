/**
 * `metabot qanda …` — on-chain Q&A (docs/metaid_protocols/08-qanda.md):
 * simplequestion / simpleanswer / paylike writes through the daemon, and the
 * read-only Q&A recall verbs (search / latest / detail / answers) over the
 * metaso-p2p Q&A APIs. OAC port of the IDBots feat/metaweb-qa tools.
 */

import path from 'node:path';
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
    message: `The "${command}" qanda command is not configured in this runtime.`,
  };
}

function readNumberFlag(args: string[], flag: string): number | undefined {
  const raw = readFlagValue(args, flag);
  if (raw == null) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readBooleanFlag(args: string[], flag: string): boolean | undefined {
  const raw = readFlagValue(args, flag);
  if (raw == null) return undefined;
  return raw === 'true' || raw === '1';
}

/** Resolve relative attachment paths against the request file (metafile:// passes through). */
function resolveFileList(baseDir: string, value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((entry) => {
    if (typeof entry !== 'string') return entry;
    if (path.isAbsolute(entry) || /^[a-z][a-z0-9+.-]*:\/\//i.test(entry)) return entry;
    return path.resolve(baseDir, entry);
  });
}

export async function runQandaCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>> {
  const subcommand = args[0];

  if (subcommand === 'question' || subcommand === 'answer' || subcommand === 'like') {
    const requestFile = readFlagValue(args, '--request-file');
    if (!requestFile) {
      return commandMissingFlag('--request-file');
    }
    const from = readFromFlag(args);
    const chainFlag = readChainWriteFlag(args);
    if (chainFlag.error) {
      return chainFlag.error;
    }
    const handler = context.dependencies.qanda?.[subcommand];
    if (!handler) {
      return commandNotImplemented(subcommand);
    }
    const request = await readJsonFile(context, requestFile);
    const requestDir = path.dirname(path.isAbsolute(requestFile) ? requestFile : path.resolve(context.cwd, requestFile));
    const attachments = resolveFileList(requestDir, request.attachments);
    const resolvedRequest = {
      ...request,
      // content_type mirrors the CLI-facing name the tools use.
      ...(request.content_type != null && request.contentType == null
        ? { contentType: request.content_type }
        : {}),
      ...(request.answer_to != null && request.answerTo == null ? { answerTo: request.answer_to } : {}),
      ...(request.pin_id != null && request.pinId == null ? { pinId: request.pin_id } : {}),
      ...(request.is_like != null && request.isLike == null ? { isLike: request.is_like } : {}),
      ...(request.allow_repeat != null && request.allowRepeat == null ? { allowRepeat: request.allow_repeat } : {}),
      ...(attachments === undefined ? {} : { attachments }),
      ...(chainFlag.chain ? { network: chainFlag.chain } : {}),
      ...(from ? { from } : {}),
    };
    return handler(resolvedRequest);
  }

  if (subcommand === 'search') {
    const query = readFlagValue(args, '--query');
    if (!query) return commandMissingFlag('--query');
    const handler = context.dependencies.qanda?.search;
    if (!handler) return commandNotImplemented('search');
    const answered = readBooleanFlag(args, '--answered');
    return handler({
      query,
      ...(readFlagValue(args, '--tags') ? { tags: readFlagValue(args, '--tags')!.split(',').map((tag) => tag.trim()).filter(Boolean) } : {}),
      ...(readFlagValue(args, '--publisher') ? { publisher: readFlagValue(args, '--publisher') } : {}),
      ...(answered != null ? { answered } : {}),
      ...(readFlagValue(args, '--newest') ? { sort: 'newest' } : {}),
      ...(readNumberFlag(args, '--size') ? { size: readNumberFlag(args, '--size') } : {}),
      ...(readFlagValue(args, '--cursor') ? { cursor: readFlagValue(args, '--cursor') } : {}),
    });
  }

  if (subcommand === 'latest') {
    const handler = context.dependencies.qanda?.latest;
    if (!handler) return commandNotImplemented('latest');
    return handler({
      ...(readFlagValue(args, '--tags') ? { tags: readFlagValue(args, '--tags')!.split(',').map((tag) => tag.trim()).filter(Boolean) } : {}),
      ...(readNumberFlag(args, '--min-answers') != null ? { minAnswers: readNumberFlag(args, '--min-answers') } : {}),
      ...(readNumberFlag(args, '--max-answers') != null ? { maxAnswers: readNumberFlag(args, '--max-answers') } : {}),
      ...(readFlagValue(args, '--hot') ? { sort: 'hot' } : {}),
      ...(readNumberFlag(args, '--size') ? { size: readNumberFlag(args, '--size') } : {}),
      ...(readFlagValue(args, '--cursor') ? { cursor: readFlagValue(args, '--cursor') } : {}),
    });
  }

  if (subcommand === 'detail') {
    const pinId = readFlagValue(args, '--pin');
    if (!pinId) return commandMissingFlag('--pin');
    const handler = context.dependencies.qanda?.detail;
    if (!handler) return commandNotImplemented('detail');
    return handler({ pinId });
  }

  if (subcommand === 'answers') {
    const pinId = readFlagValue(args, '--pin');
    if (!pinId) return commandMissingFlag('--pin');
    const handler = context.dependencies.qanda?.answers;
    if (!handler) return commandNotImplemented('answers');
    return handler({
      pinId,
      ...(readFlagValue(args, '--publisher') ? { publisher: readFlagValue(args, '--publisher') } : {}),
      ...(readNumberFlag(args, '--size') ? { size: readNumberFlag(args, '--size') } : {}),
      ...(readFlagValue(args, '--cursor') ? { cursor: readFlagValue(args, '--cursor') } : {}),
    });
  }

  if (subcommand === undefined) {
    return commandFailed('missing_subcommand', 'Usage: metabot qanda <question|answer|like|search|latest|detail|answers> …');
  }
  return commandUnknownSubcommand(`qanda ${args.join(' ')}`.trim());
}
