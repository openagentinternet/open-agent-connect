import { promises as fs } from 'node:fs';
import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import {
  commandMissingFlag,
  commandUnknownSubcommand,
  hasFlag,
  readFlagValue,
  readFromFlag,
} from './helpers';
import type { CliRuntimeContext } from '../types';

type KbDeps = NonNullable<CliRuntimeContext['dependencies']['knowledgeBase']>;

function requireKbHandler<K extends keyof KbDeps>(
  context: CliRuntimeContext,
  key: K,
): NonNullable<KbDeps[K]> | MetabotCommandResult<never> {
  const handler = context.dependencies.knowledgeBase?.[key];
  if (!handler) {
    return commandFailed('not_implemented', `Knowledge-base ${String(key)} handler is not configured.`);
  }
  return handler as NonNullable<KbDeps[K]>;
}

function isFailure(value: unknown): value is MetabotCommandResult<never> {
  return Boolean(value && typeof value === 'object' && (value as { ok?: unknown }).ok === false);
}

function readOnOffFlag(args: string[], flag: string): boolean | 'invalid' | undefined {
  const raw = readFlagValue(args, flag);
  if (raw === null) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (['on', 'true', '1'].includes(normalized)) return true;
  if (['off', 'false', '0'].includes(normalized)) return false;
  return 'invalid';
}

function readNumberFlag(args: string[], flag: string): number | 'invalid' | undefined {
  const raw = readFlagValue(args, flag);
  if (raw === null) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : 'invalid';
}

const SOURCE_TYPES = new Set(['web', 'metaweb', 'manual']);

async function readContentFlag(
  context: CliRuntimeContext,
  args: string[],
): Promise<string | MetabotCommandResult<never>> {
  const inline = readFlagValue(args, '--content');
  const file = readFlagValue(args, '--content-file');
  if (inline !== null && file !== null) {
    return commandFailed('invalid_flag', 'Use either --content or --content-file, not both.');
  }
  if (inline !== null) return inline;
  if (file !== null) {
    try {
      return await fs.readFile(file, 'utf8');
    } catch (error) {
      return commandFailed('invalid_flag', `--content-file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return commandMissingFlag('--content or --content-file');
}

export async function runKnowledgeBaseCommand(
  args: string[],
  context: CliRuntimeContext,
): Promise<MetabotCommandResult<unknown>> {
  const [subcommand] = args;
  const from = readFromFlag(args);

  if (subcommand === 'list') {
    const handler = requireKbHandler(context, 'list');
    if (isFailure(handler)) return handler;
    return handler({ from });
  }

  if (subcommand === 'create') {
    const handler = requireKbHandler(context, 'create');
    if (isFailure(handler)) return handler;
    const name = readFlagValue(args, '--name');
    if (!name?.trim()) return commandMissingFlag('--name');
    const autoLearn = readOnOffFlag(args, '--autolearn');
    if (autoLearn === 'invalid') {
      return commandFailed('invalid_flag', '--autolearn accepts on|off.');
    }
    return handler({
      from,
      name: name.trim(),
      ...(readFlagValue(args, '--description')?.trim()
        ? { description: readFlagValue(args, '--description')!.trim() }
        : {}),
      ...(autoLearn !== undefined ? { autoLearn } : {}),
    });
  }

  if (subcommand === 'update') {
    const handler = requireKbHandler(context, 'update');
    if (isFailure(handler)) return handler;
    const id = readFlagValue(args, '--id');
    if (!id?.trim()) return commandMissingFlag('--id');
    const autoLearn = readOnOffFlag(args, '--autolearn');
    if (autoLearn === 'invalid') {
      return commandFailed('invalid_flag', '--autolearn accepts on|off.');
    }
    return handler({
      from,
      id: id.trim(),
      ...(readFlagValue(args, '--name')?.trim() ? { name: readFlagValue(args, '--name')!.trim() } : {}),
      ...(readFlagValue(args, '--description')?.trim()
        ? { description: readFlagValue(args, '--description')!.trim() }
        : {}),
      ...(autoLearn !== undefined ? { autoLearn } : {}),
    });
  }

  if (subcommand === 'remove') {
    const handler = requireKbHandler(context, 'remove');
    if (isFailure(handler)) return handler;
    const id = readFlagValue(args, '--id');
    if (!id?.trim()) return commandMissingFlag('--id');
    if (!hasFlag(args, '--confirm')) {
      return commandFailed(
        'missing_flag',
        'Removing a knowledge base deletes its raw documents. Pass --confirm to proceed.',
      );
    }
    return handler({ from, id: id.trim() });
  }

  if (subcommand === 'query') {
    const handler = requireKbHandler(context, 'query');
    if (isFailure(handler)) return handler;
    const text = readFlagValue(args, '--text');
    if (!text?.trim()) return commandMissingFlag('--text');
    const topK = readNumberFlag(args, '--top-k');
    if (topK === 'invalid') return commandFailed('invalid_flag', '--top-k must be a number.');
    const minScore = readNumberFlag(args, '--min-score');
    if (minScore === 'invalid') return commandFailed('invalid_flag', '--min-score must be a number.');
    return handler({
      from,
      text: text.trim(),
      ...(readFlagValue(args, '--id')?.trim() ? { id: readFlagValue(args, '--id')!.trim() } : {}),
      ...(topK !== undefined ? { topK } : {}),
      ...(minScore !== undefined ? { minScore } : {}),
    });
  }

  if (subcommand === 'add-document') {
    const handler = requireKbHandler(context, 'addDocument');
    if (isFailure(handler)) return handler;
    const title = readFlagValue(args, '--title');
    if (!title?.trim()) return commandMissingFlag('--title');
    const content = await readContentFlag(context, args);
    if (typeof content !== 'string') return content;
    const sourceType = readFlagValue(args, '--source-type');
    if (sourceType !== null && !SOURCE_TYPES.has(sourceType.trim())) {
      return commandFailed('invalid_flag', '--source-type accepts web|metaweb|manual.');
    }
    const tags = readFlagValue(args, '--tags');
    return handler({
      from,
      title: title.trim(),
      content,
      ...(readFlagValue(args, '--id')?.trim() ? { id: readFlagValue(args, '--id')!.trim() } : {}),
      ...(sourceType?.trim() ? { sourceType: sourceType.trim() } : {}),
      ...(readFlagValue(args, '--url')?.trim() ? { url: readFlagValue(args, '--url')!.trim() } : {}),
      ...(readFlagValue(args, '--pin-id')?.trim() ? { pinId: readFlagValue(args, '--pin-id')!.trim() } : {}),
      ...(tags?.trim() ? { tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean) } : {}),
    });
  }

  if (subcommand === 'learn') {
    const handler = requireKbHandler(context, 'learn');
    if (isFailure(handler)) return handler;
    return handler({
      from,
      ...(readFlagValue(args, '--id')?.trim() ? { id: readFlagValue(args, '--id')!.trim() } : {}),
      full: hasFlag(args, '--full'),
    });
  }

  return commandUnknownSubcommand(`knowledge-base ${String(subcommand ?? '')}`.trim());
}
