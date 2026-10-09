import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import type { ConcreteSkillHost } from '../../core/skills/skillContractTypes';
import { SUPPORTED_PLATFORM_IDS, isPlatformId } from '../../core/platform/platformRegistry';
import { commandMissingFlag, commandUnknownSubcommand, readFlagValue, redactSensitiveArgs } from './helpers';
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
        return commandUnknownSubcommand(`host ${redactSensitiveArgs(args).join(' ')}`.trim());
      }
      return commandFailed('not_implemented', `Host persona ${action} handler is not configured.`);
    }

    const host = readPersonaHost(args);
    if (host !== 'codex') {
      return host;
    }
    return handler({ host, from: readFlagValue(args, '--from') ?? undefined });
  }

  if (args[0] === 'binding') {
    const action = args[1];
    const hostDeps = context.dependencies.host;
    const from = readFlagValue(args, '--from') ?? undefined;
    switch (action) {
      case 'status': {
        const handler = hostDeps?.grokBotBindingStatus;
        if (!handler) return commandFailed('not_implemented', 'Host binding status handler is not configured.');
        return handler({ from });
      }
      case 'bind': {
        const handler = hostDeps?.grokBotBindingBind;
        if (!handler) return commandFailed('not_implemented', 'Host binding bind handler is not configured.');
        const assistantId = readFlagValue(args, '--assistant-id');
        if (!assistantId) return commandMissingFlag('--assistant-id');
        return handler({
          from,
          assistantId,
          assistantName: readFlagValue(args, '--assistant-name') ?? undefined,
          force: args.includes('--force'),
        });
      }
      case 'webhook': {
        const handler = hostDeps?.grokBotBindingWebhook;
        if (!handler) return commandFailed('not_implemented', 'Host binding webhook handler is not configured.');
        const clear = args.includes('--clear');
        const url = readFlagValue(args, '--url') ?? undefined;
        if (!clear && !url) return commandMissingFlag('--url');
        return handler({
          from,
          url,
          secret: readFlagValue(args, '--secret') ?? undefined,
          clear,
        });
      }
      case 'unbind': {
        const handler = hostDeps?.grokBotBindingUnbind;
        if (!handler) return commandFailed('not_implemented', 'Host binding unbind handler is not configured.');
        return handler({ from });
      }
      case 'doctor': {
        const handler = hostDeps?.grokBotBindingDoctor;
        if (!handler) return commandFailed('not_implemented', 'Host binding doctor handler is not configured.');
        return handler();
      }
      default:
        return commandUnknownSubcommand(`host ${redactSensitiveArgs(args).join(' ')}`.trim());
    }
  }

  if (args[0] !== 'bind-skills') {
    return commandUnknownSubcommand(`host ${redactSensitiveArgs(args).join(' ')}`.trim());
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
