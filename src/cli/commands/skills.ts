import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { commandMissingFlag, commandUnknownSubcommand, readFlagValue } from './helpers';
import type { CliRuntimeContext } from '../types';
import type { SkillHost, SkillRenderFormat } from '../../core/skills/skillContractTypes';

const SUPPORTED_HOSTS: SkillHost[] = ['codex', 'claude-code', 'openclaw'];
const SUPPORTED_FORMATS: SkillRenderFormat[] = ['json', 'markdown'];

function isSupportedHost(value: string): value is SkillHost {
  return SUPPORTED_HOSTS.includes(value as SkillHost);
}

function isSupportedFormat(value: string): value is SkillRenderFormat {
  return SUPPORTED_FORMATS.includes(value as SkillRenderFormat);
}

export async function runSkillsCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>> {
  if (args[0] !== 'resolve') {
    return commandUnknownSubcommand(`skills ${args.join(' ')}`.trim());
  }

  const handler = context.dependencies.skills?.resolve;
  if (!handler) {
    return commandFailed('not_implemented', 'Skills resolve handler is not configured.');
  }

  const skill = readFlagValue(args, '--skill');
  if (!skill) {
    return commandMissingFlag('--skill');
  }
  const host = readFlagValue(args, '--host');
  if (!host) {
    return commandMissingFlag('--host');
  }
  if (!isSupportedHost(host)) {
    return commandFailed(
      'invalid_argument',
      `Unsupported --host value: ${host}. Supported values: ${SUPPORTED_HOSTS.join(', ')}.`,
    );
  }

  const format = readFlagValue(args, '--format');
  if (!format) {
    return commandMissingFlag('--format');
  }
  if (!isSupportedFormat(format)) {
    return commandFailed(
      'invalid_argument',
      `Unsupported --format value: ${format}. Supported values: ${SUPPORTED_FORMATS.join(', ')}.`,
    );
  }

  return handler({ skill, host, format });
}
