import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { commandMissingFlag, commandUnknownSubcommand, hasFlag, readFlagValue, readJsonFile } from './helpers';
import type { CliRuntimeContext } from '../types';

function readFromSlug(args: string[]): string | null {
  return readFlagValue(args, '--from');
}

function readLimit(args: string[], fallback: number): number {
  const raw = readFlagValue(args, '--limit');
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function missingFrom(): MetabotCommandResult<never> {
  return commandMissingFlag('--from');
}

export async function runBotCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>> {
  const [subcommand, nested] = args;

  if (subcommand === 'list') {
    const handler = context.dependencies.bot?.listProfiles;
    if (!handler) {
      return commandFailed('not_implemented', 'Bot profile list handler is not configured.');
    }
    return handler();
  }

  if (subcommand === 'show') {
    const slug = readFromSlug(args);
    if (!slug) return missingFrom();
    const handler = context.dependencies.bot?.getProfile;
    if (!handler) {
      return commandFailed('not_implemented', 'Bot profile handler is not configured.');
    }
    return handler({ slug });
  }

  if (subcommand === 'create') {
    const name = readFlagValue(args, '--name');
    if (!name) return commandMissingFlag('--name');
    const host = readFlagValue(args, '--host');
    const handler = context.dependencies.bot?.createProfile;
    if (!handler) {
      return commandFailed('not_implemented', 'Bot profile create handler is not configured.');
    }
    const dshLlmProvider = readFlagValue(args, '--dsh-llm-provider');
    const dshLlmModel = readFlagValue(args, '--dsh-llm-model');
    const dshLlmReasoningEffort = readFlagValue(args, '--dsh-llm-reasoning-effort');
    const dshLlmFallbackProvider = readFlagValue(args, '--dsh-llm-fallback-provider');
    const dshLlmFallbackModel = readFlagValue(args, '--dsh-llm-fallback-model');
    const dshLlmFallbackReasoningEffort = readFlagValue(args, '--dsh-llm-fallback-reasoning-effort');
    const botType = readFlagValue(args, '--type');
    if (botType !== null && botType !== 'twin' && botType !== 'worker') {
      return commandFailed('invalid_flag', '--type must be twin or worker.');
    }
    const ownerGlobalMetaId = readFlagValue(args, '--owner');
    return handler({
      name,
      ...(host ? { host } : {}),
      ...(dshLlmProvider ? { dshLlmProvider } : {}),
      ...(dshLlmModel ? { dshLlmModel } : {}),
      ...(dshLlmReasoningEffort ? { dshLlmReasoningEffort } : {}),
      ...(dshLlmFallbackProvider ? { dshLlmFallbackProvider } : {}),
      ...(dshLlmFallbackModel ? { dshLlmFallbackModel } : {}),
      ...(dshLlmFallbackReasoningEffort ? { dshLlmFallbackReasoningEffort } : {}),
      ...(botType ? { botType } : {}),
      ...(ownerGlobalMetaId ? { ownerGlobalMetaId } : {}),
    });
  }

  if (subcommand === 'bind-owner') {
    const slug = readFromSlug(args);
    if (!slug) return missingFrom();
    const handler = context.dependencies.bot?.bindOwner;
    if (!handler) {
      return commandFailed('not_implemented', 'Bot bind-owner handler is not configured.');
    }
    const owner = readFlagValue(args, '--owner');
    const unbind = hasFlag(args, '--unbind');
    if (owner && unbind) {
      return commandFailed('invalid_flag', '--owner and --unbind cannot be combined.');
    }
    return handler({
      slug,
      ...(owner ? { ownerGlobalMetaId: owner } : {}),
      ...(unbind ? { unbind: true } : {}),
    });
  }

  if (subcommand === 'update') {
    const slug = readFromSlug(args);
    if (!slug) return missingFrom();
    const payloadFile = readFlagValue(args, '--payload-file');
    if (!payloadFile) return commandMissingFlag('--payload-file');
    const handler = context.dependencies.bot?.updateProfile;
    if (!handler) {
      return commandFailed('not_implemented', 'Bot profile update handler is not configured.');
    }
    const payload = await readJsonFile(context, payloadFile);
    return handler({ slug, ...payload });
  }

  if (subcommand === 'delete') {
    const slug = readFromSlug(args);
    if (!slug) return missingFrom();
    if (!hasFlag(args, '--confirm')) {
      return commandFailed('confirmation_required', 'Bot delete requires --confirm.');
    }
    const handler = context.dependencies.bot?.deleteProfile;
    if (!handler) {
      return commandFailed('not_implemented', 'Bot profile delete handler is not configured.');
    }
    return handler({ slug, confirm: true });
  }

  if (subcommand === 'config' && nested === 'get') {
    const slug = readFromSlug(args);
    if (!slug) return missingFrom();
    const handler = context.dependencies.bot?.getConfig;
    if (!handler) {
      return commandFailed('not_implemented', 'Bot config handler is not configured.');
    }
    return handler({ slug });
  }

  if (subcommand === 'config' && nested === 'set') {
    const slug = readFromSlug(args);
    if (!slug) return missingFrom();
    const payloadFile = readFlagValue(args, '--payload-file');
    if (!payloadFile) return commandMissingFlag('--payload-file');
    const handler = context.dependencies.bot?.setConfig;
    if (!handler) {
      return commandFailed('not_implemented', 'Bot config handler is not configured.');
    }
    const payload = await readJsonFile(context, payloadFile);
    return handler({ slug, ...payload });
  }

  if (subcommand === 'wallet') {
    const slug = readFromSlug(args);
    if (!slug) return missingFrom();
    const handler = context.dependencies.bot?.getWallet;
    if (!handler) {
      return commandFailed('not_implemented', 'Bot wallet handler is not configured.');
    }
    return handler({ slug });
  }

  if (subcommand === 'backup') {
    const slug = readFromSlug(args);
    if (!slug) return missingFrom();
    const handler = context.dependencies.bot?.getBackup;
    if (!handler) {
      return commandFailed('not_implemented', 'Bot backup handler is not configured.');
    }
    return handler({ slug });
  }

  if (subcommand === 'runtimes' && nested === 'list') {
    const from = readFromSlug(args) || undefined;
    const handler = context.dependencies.bot?.listRuntimes;
    if (!handler) {
      return commandFailed('not_implemented', 'Bot runtime list handler is not configured.');
    }
    return handler(from ? { from } : undefined);
  }

  if (subcommand === 'runtimes' && nested === 'discover') {
    const from = readFromSlug(args) || undefined;
    const handler = context.dependencies.bot?.discoverRuntimes;
    if (!handler) {
      return commandFailed('not_implemented', 'Bot runtime discovery handler is not configured.');
    }
    return handler(from ? { from } : undefined);
  }

  if (subcommand === 'sessions') {
    const from = readFromSlug(args) || undefined;
    const handler = context.dependencies.bot?.listSessions;
    if (!handler) {
      return commandFailed('not_implemented', 'Bot session list handler is not configured.');
    }
    return handler({
      ...(from ? { slug: from } : {}),
      limit: readLimit(args, 50),
    });
  }

  return commandUnknownSubcommand(`bot ${args.join(' ')}`.trim());
}
