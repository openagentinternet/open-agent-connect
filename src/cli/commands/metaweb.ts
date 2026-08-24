/**
 * `metabot metaweb …` — MetaWeb knowledge access (OAC port of the IDBots M1
 * tools as CLI verbs). Read-only aggregation calls run in-process against
 * the metaso-p2p node (same pattern as `metaid search`).
 */

import { commandMissingFlag } from './helpers';
import type { MetabotCommandResult } from '../../core/contracts/commandResult';
import type { CliRuntimeContext } from '../types';

function readFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) return undefined;
  const value = args[index + 1]?.trim();
  return value ? value : undefined;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function commandNotImplemented(command: string): MetabotCommandResult<never> {
  return {
    ok: false,
    state: 'failed',
    code: 'not_implemented',
    message: `The "${command}" metaweb command is not configured in this runtime.`,
  };
}

function commandUnknownSubcommand(command: string): MetabotCommandResult<never> {
  return {
    ok: false,
    state: 'failed',
    code: 'unknown_subcommand',
    message: `Unknown command: ${command}. See \`metabot metaweb --help\`.`,
  };
}

function readSizeFlag(args: string[]): { ok: true; value?: number } | { ok: false; result: MetabotCommandResult<never> } {
  const raw = readFlagValue(args, '--size');
  if (raw == null) return { ok: true };
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return {
      ok: false,
      result: {
        ok: false,
        state: 'failed',
        code: 'invalid_flag',
        message: '--size must be a positive integer.',
      },
    };
  }
  return { ok: true, value: Math.min(50, parsed) };
}

export function runMetawebCommand(
  args: string[],
  context: CliRuntimeContext,
): Promise<MetabotCommandResult<unknown>> {
  const subcommand = args[0];

  if (subcommand === 'search') {
    const size = readSizeFlag(args);
    if (!size.ok) return Promise.resolve(size.result);

    const handler = context.dependencies.metaweb?.search;
    if (!handler) return Promise.resolve(commandNotImplemented('search'));

    const query = readFlagValue(args, '--query');
    if (!query) return Promise.resolve(commandMissingFlag('--query'));
    const protocols = readFlagValue(args, '--protocols');
    const publisher = readFlagValue(args, '--publisher');
    const sinceDays = readFlagValue(args, '--since-days');
    const untilDays = readFlagValue(args, '--until-days');
    const cursor = readFlagValue(args, '--cursor');
    const nowSeconds = Math.floor(Date.now() / 1000);
    const dayValue = (raw: string | undefined): number | undefined => {
      const parsed = Number(raw);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    };
    return Promise.resolve(handler({
      query,
      ...(protocols ? { protocols } : {}),
      ...(publisher ? { publisher } : {}),
      ...(dayValue(sinceDays) ? { since: nowSeconds - dayValue(sinceDays)! * 86_400 } : {}),
      ...(dayValue(untilDays) ? { until: nowSeconds - dayValue(untilDays)! * 86_400 } : {}),
      ...(hasFlag(args, '--newest') ? { sort: 'newest' } : {}),
      ...(size.value ? { size: size.value } : {}),
      ...(cursor ? { cursor } : {}),
    }));
  }

  if (subcommand === 'read') {
    const pinId = readFlagValue(args, '--pin');
    if (!pinId) return Promise.resolve(commandMissingFlag('--pin'));

    const handler = context.dependencies.metaweb?.read;
    if (!handler) return Promise.resolve(commandNotImplemented('read'));
    return Promise.resolve(handler({ pinId }));
  }

  return Promise.resolve(commandUnknownSubcommand(`metaweb ${args.join(' ')}`.trim()));
}
