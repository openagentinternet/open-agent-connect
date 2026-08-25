import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { commandMissingFlag, commandUnknownSubcommand, readFlagValue } from './helpers';
import type { CliRuntimeContext } from '../types';
import type { ConcreteSkillHost, SkillRenderFormat } from '../../core/skills/skillContractTypes';
import { SUPPORTED_PLATFORM_IDS, isPlatformId } from '../../core/platform/platformRegistry';

const SUPPORTED_HOSTS: ConcreteSkillHost[] = [...SUPPORTED_PLATFORM_IDS];
const SUPPORTED_FORMATS: SkillRenderFormat[] = ['json', 'markdown'];

function isSupportedFormat(value: string): value is SkillRenderFormat {
  return SUPPORTED_FORMATS.includes(value as SkillRenderFormat);
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

export async function runSkillsCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>> {
  const subcommand = args[0];

  if (subcommand === 'resolve') {
    const handler = context.dependencies.skills?.resolve;
    if (!handler) {
      return commandFailed('not_implemented', 'Skills resolve handler is not configured.');
    }

    const skill = readFlagValue(args, '--skill');
    if (!skill) {
      return commandMissingFlag('--skill');
    }
    const host = readFlagValue(args, '--host');
    if (host && !isPlatformId(host)) {
      return commandFailed(
        'invalid_argument',
        `Unsupported --host value: ${host}. Supported values: ${SUPPORTED_HOSTS.join(', ')}.`,
      );
    }
    const resolvedHost: ConcreteSkillHost | undefined = host && isPlatformId(host) ? host : undefined;

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

    return handler({ skill, host: resolvedHost, format });
  }

  if (subcommand === 'install') {
    const handler = context.dependencies.skills?.install;
    if (!handler) {
      return commandFailed('not_implemented', 'Skills install handler is not configured.');
    }
    const pin = readFlagValue(args, '--pin');
    const uri = readFlagValue(args, '--uri');
    if (!pin && !uri) {
      return commandFailed(
        'invalid_argument',
        'Pass --pin <metabot-skill pinId> (recommended; reads the pin payload for the package URI) or --uri <metafile://…|https://…> for a direct package zip.',
      );
    }
    return handler({
      ...(pin ? { pin } : {}),
      ...(uri ? { uri } : {}),
      ...(readFlagValue(args, '--name') ? { name: readFlagValue(args, '--name') } : {}),
      confirm: hasFlag(args, '--confirm'),
      force: hasFlag(args, '--force'),
      noRebind: hasFlag(args, '--no-rebind'),
    });
  }

  if (subcommand === 'list') {
    const handler = context.dependencies.skills?.list;
    if (!handler) {
      return commandFailed('not_implemented', 'Skills list handler is not configured.');
    }
    return handler({ json: hasFlag(args, '--json') });
  }

  if (subcommand === 'read') {
    const handler = context.dependencies.skills?.read;
    if (!handler) {
      return commandFailed('not_implemented', 'Skills read handler is not configured.');
    }
    const name = readFlagValue(args, '--name');
    if (!name) {
      return commandMissingFlag('--name');
    }
    return handler({ name });
  }

  if (subcommand === 'uninstall') {
    const handler = context.dependencies.skills?.uninstall;
    if (!handler) {
      return commandFailed('not_implemented', 'Skills uninstall handler is not configured.');
    }
    const name = readFlagValue(args, '--name');
    if (!name) {
      return commandMissingFlag('--name');
    }
    return handler({ name, confirm: hasFlag(args, '--confirm') });
  }

  return commandUnknownSubcommand(`skills ${args.join(' ')}`.trim());
}
