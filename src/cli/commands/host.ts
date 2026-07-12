import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import type { ConcreteSkillHost } from '../../core/skills/skillContractTypes';
import { SUPPORTED_PLATFORM_IDS, isPlatformId } from '../../core/platform/platformRegistry';
import { commandMissingFlag, commandUnknownSubcommand, readFlagValue } from './helpers';
import type { CliRuntimeContext } from '../types';

const SUPPORTED_HOSTS: ConcreteSkillHost[] = [...SUPPORTED_PLATFORM_IDS];
const SUPPORTED_PERSONA_HOSTS = ['codex'] as const;

function readPersonaHost(args: string[]): 'codex' | MetabotCommandResult<unknown> {
  const host = readFlagValue(args, '--host');
  if (!host) {
    return commandMissingFlag('--host');
  }
  if (host !== 'codex') {
    return commandFailed(
      'invalid_argument',
      `Unsupported persona --host value: ${host}. Supported values: ${SUPPORTED_PERSONA_HOSTS.join(', ')}.`,
    );
  }
  return host;
}

export async function runHostCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>> {
  if (args[0] === 'persona') {
    const action = args[1];
    const handler = action === 'bind'
      ? context.dependencies.host?.bindPersona
      : action === 'status'
        ? context.dependencies.host?.personaStatus
        : action === 'unbind'
          ? context.dependencies.host?.unbindPersona
          : undefined;
    if (!handler) {
      if (!['bind', 'status', 'unbind'].includes(action ?? '')) {
        return commandUnknownSubcommand(`host ${args.join(' ')}`.trim());
      }
      return commandFailed('not_implemented', `Host persona ${action} handler is not configured.`);
    }

    const host = readPersonaHost(args);
    if (host !== 'codex') {
      return host;
    }
    return handler({ host, from: readFlagValue(args, '--from') ?? undefined });
  }

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
