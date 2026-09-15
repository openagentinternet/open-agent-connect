import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { commandMissingFlag, commandUnknownSubcommand, readFlagValue, readFromFlag } from './helpers';
import type { CliRuntimeContext } from '../types';

type SurfDeps = NonNullable<CliRuntimeContext['dependencies']['surf']>;

function requireSurfHandler<K extends keyof SurfDeps>(
  context: CliRuntimeContext,
  key: K,
): NonNullable<SurfDeps[K]> | MetabotCommandResult<never> {
  const handler = context.dependencies.surf?.[key];
  if (!handler) {
    return commandFailed('not_implemented', `Surf ${String(key)} handler is not configured.`);
  }
  return handler as NonNullable<SurfDeps[K]>;
}

function isFailure(value: unknown): value is MetabotCommandResult<never> {
  return Boolean(value && typeof value === 'object' && (value as { ok?: unknown }).ok === false);
}

const TRIGGERS = new Set(['manual-chat', 'manual-ui', 'pre-dream']);

export async function runSurfCommand(
  args: string[],
  context: CliRuntimeContext,
): Promise<MetabotCommandResult<unknown>> {
  const [subcommand] = args;
  const from = readFromFlag(args);

  if (subcommand === 'status') {
    const handler = requireSurfHandler(context, 'status');
    if (isFailure(handler)) return handler;
    const limitRaw = readFlagValue(args, '--limit');
    const limit = limitRaw === null ? undefined : Number(limitRaw);
    return handler({ from, ...(limit !== undefined && Number.isFinite(limit) ? { limit: Math.floor(limit) } : {}) });
  }

  if (subcommand === 'run') {
    const handler = requireSurfHandler(context, 'run');
    if (isFailure(handler)) return handler;
    const triggerRaw = readFlagValue(args, '--trigger');
    if (triggerRaw !== null && !TRIGGERS.has(triggerRaw)) {
      return commandFailed('invalid_trigger', `--trigger must be one of manual-chat, manual-ui, pre-dream (got "${triggerRaw}").`);
    }
    return handler({
      from,
      ...(triggerRaw ? { trigger: triggerRaw as 'manual-chat' | 'manual-ui' | 'pre-dream' } : {}),
      ...(args.includes('--wait') ? { wait: true } : {}),
    });
  }

  if (subcommand === 'enable' || subcommand === 'disable') {
    const handler = requireSurfHandler(context, subcommand === 'enable' ? 'enable' : 'disable');
    if (isFailure(handler)) return handler;
    return handler({ from });
  }

  if (subcommand === 'budget') {
    const handler = requireSurfHandler(context, 'budget');
    if (isFailure(handler)) return handler;
    const positional = args.filter((arg) => !arg.startsWith('--') && arg !== 'budget');
    const raw = positional[0] ?? readFlagValue(args, '--value');
    if (raw === undefined || raw === null) {
      return commandMissingFlag('budget value (metabot surf budget --from <slug> <0-100>)');
    }
    const budget = Number(raw);
    if (!Number.isInteger(budget) || budget < 0 || budget > 100) {
      return commandFailed('invalid_budget', 'Interaction budget must be an integer between 0 and 100.');
    }
    return handler({ from, budget });
  }

  if (!subcommand) {
    return commandFailed('missing_subcommand', 'Usage: metabot surf <status|run|enable|disable|budget> [--from <slug>]');
  }
  return commandUnknownSubcommand(`surf ${subcommand}`);
}
