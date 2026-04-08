import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { commandMissingFlag, commandUnknownSubcommand, readFlagValue } from './helpers';
import type { CliRuntimeContext } from '../types';

export async function runEvolutionCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>> {
  const subcommand = args[0];

  if (subcommand === 'status') {
    const handler = context.dependencies.evolution?.status;
    if (!handler) {
      return commandFailed('not_implemented', 'Evolution status handler is not configured.');
    }
    return handler();
  }

  if (subcommand === 'adopt') {
    const handler = context.dependencies.evolution?.adopt;
    if (!handler) {
      return commandFailed('not_implemented', 'Evolution adopt handler is not configured.');
    }
    const skill = readFlagValue(args, '--skill');
    if (!skill) {
      return commandMissingFlag('--skill');
    }
    const variantId = readFlagValue(args, '--variant-id');
    if (!variantId) {
      return commandMissingFlag('--variant-id');
    }
    return handler({ skill, variantId });
  }

  if (subcommand === 'rollback') {
    const handler = context.dependencies.evolution?.rollback;
    if (!handler) {
      return commandFailed('not_implemented', 'Evolution rollback handler is not configured.');
    }
    const skill = readFlagValue(args, '--skill');
    if (!skill) {
      return commandMissingFlag('--skill');
    }
    return handler({ skill });
  }

  return commandUnknownSubcommand(`evolution ${args.join(' ')}`.trim());
}
