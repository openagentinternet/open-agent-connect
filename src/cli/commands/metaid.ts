import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import {
  commandMissingFlag,
  commandUnknownSubcommand,
  hasFlag,
  readFlagValue,
} from './helpers';
import type { CliRuntimeContext } from '../types';

const METAID_SEARCH_LIMIT_DEFAULT = 8;
const METAID_SEARCH_LIMIT_MAX = 20;
const SECONDS_PER_DAY = 86_400;

function readOptionalFlag(args: string[], flag: string): string | undefined {
  const value = readFlagValue(args, flag);
  return value && !value.startsWith('--') ? value : undefined;
}

function commandNotImplemented(command: string): MetabotCommandResult<never> {
  return commandFailed('not_implemented', `MetaID ${command} handler is not configured.`);
}

function commandInvalidFlag(message: string): MetabotCommandResult<never> {
  return commandFailed('invalid_flag', message);
}

function readPositiveIntegerFlag(args: string[], flag: string, fallback: number): {
  ok: true;
  value: number;
} | { ok: false; result: MetabotCommandResult<never> } {
  const index = args.indexOf(flag);
  if (index === -1) {
    return { ok: true, value: fallback };
  }

  const raw = args[index + 1];
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) {
    return { ok: false, result: commandInvalidFlag(`${flag} must be a positive integer.`) };
  }

  return { ok: true, value: Number.parseInt(raw, 10) };
}

function readSearchLimitFlag(args: string[]): {
  ok: true;
  value: number;
} | { ok: false; result: MetabotCommandResult<never> } {
  const limit = readPositiveIntegerFlag(args, '--limit', METAID_SEARCH_LIMIT_DEFAULT);
  if (!limit.ok) {
    return limit;
  }
  if (limit.value > METAID_SEARCH_LIMIT_MAX) {
    return { ok: false, result: commandInvalidFlag(`--limit must be between 1 and ${METAID_SEARCH_LIMIT_MAX}.`) };
  }
  return limit;
}

export async function runMetaIdCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>> {
  const subcommand = args[0];

  if (subcommand === 'search') {
    const limit = readSearchLimitFlag(args);
    if (!limit.ok) {
      return limit.result;
    }

    const sinceDays = readPositiveIntegerFlag(args, '--since-days', 0);
    if (!sinceDays.ok) {
      return sinceDays.result;
    }
    const untilDays = readPositiveIntegerFlag(args, '--until-days', 0);
    if (!untilDays.ok) {
      return untilDays.result;
    }

    const handler = context.dependencies.metaid?.search;
    if (!handler) {
      return commandNotImplemented('search');
    }

    // The aggregation API only understands unix-second bounds, so the
    // day-based flags are converted here relative to the current time.
    const nowSeconds = Math.floor(Date.now() / 1000);
    const query = readOptionalFlag(args, '--query');
    const skill = readOptionalFlag(args, '--skill');
    const chain = readOptionalFlag(args, '--chain');
    const cursor = readOptionalFlag(args, '--cursor');
    return handler({
      ...(query ? { query } : {}),
      ...(skill ? { skill } : {}),
      ...(chain ? { chain: chain.trim().toLowerCase() } : {}),
      ...(hasFlag(args, '--chat-pubkey') ? { chatPubkey: true } : {}),
      ...(hasFlag(args, '--homepage') ? { homepage: true } : {}),
      ...(sinceDays.value > 0 ? { since: nowSeconds - sinceDays.value * SECONDS_PER_DAY } : {}),
      ...(untilDays.value > 0 ? { until: nowSeconds - untilDays.value * SECONDS_PER_DAY } : {}),
      limit: limit.value,
      ...(cursor ? { cursor } : {}),
    });
  }

  if (subcommand === 'detail') {
    const identity = readOptionalFlag(args, '--identity');
    if (!identity) {
      return commandMissingFlag('--identity');
    }

    const handler = context.dependencies.metaid?.detail;
    if (!handler) {
      return commandNotImplemented('detail');
    }

    return handler({ identity });
  }

  return commandUnknownSubcommand(`metaid ${args.join(' ')}`.trim());
}
