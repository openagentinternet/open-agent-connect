import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import type { ConcreteSkillHost } from '../../core/skills/skillContractTypes';
import { SUPPORTED_PLATFORM_IDS, isPlatformId } from '../../core/platform/platformRegistry';
import { commandMissingFlag, commandUnknownSubcommand, readFlagValue } from './helpers';
import type { CliRuntimeContext } from '../types';

const SUPPORTED_HOSTS: ConcreteSkillHost[] = [...SUPPORTED_PLATFORM_IDS];

export async function runHostCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>> {
  if (args[0] !== 'bind-skills') {
    return commandUnknownSubcommand(`host ${args.join(' ')}`.trim());
  }

  const handler = context.dependencies.host?.bindSkills;
  if (!handler) {
    return commandFailed('not_implemented', 'Host bind-skills handler is not configured.');
  }

  const host = readFlagValue(args, '--host');
  if (!host) {
    return commandMissingFlag('--host');
  }
  if (!isPlatformId(host)) {
    return commandFailed(
      'invalid_argument',
      `Unsupported --host value: ${host}. Supported values: ${SUPPORTED_HOSTS.join(', ')}.`,
    );
  }

  return handler({ host });
}
