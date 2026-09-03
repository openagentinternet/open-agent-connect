import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { commandUnknownSubcommand, readFlagValue } from './helpers';
import type { CliRuntimeContext } from '../types';

const TRAFFIC_LEDGER_DEFAULT_LIMIT = 20;

function trafficNotImplemented(verb: string): MetabotCommandResult<never> {
  return commandFailed('not_implemented', `Traffic ${verb} handler is not configured.`);
}

function parseLedgerCursor(raw: string | null): { cursor?: string; error?: MetabotCommandResult<never> } {
  if (raw === null || !raw.trim()) return {};
  if (!/^\d+$/.test(raw.trim())) {
    return { error: commandFailed('invalid_argument', `--cursor must be a non-negative integer, got "${raw}".`) };
  }
  return { cursor: raw.trim() };
}

function parseLedgerLimit(raw: string | null): { limit?: number; error?: MetabotCommandResult<never> } {
  if (raw === null) return {};
  if (!/^[1-9]\d*$/.test(raw.trim())) {
    return { error: commandFailed('invalid_argument', `--limit must be a positive integer, got "${raw}".`) };
  }
  return { limit: Number.parseInt(raw.trim(), 10) };
}

/**
 * Traffic (流量 account-quota gas credit) verbs. All owner-scoped thin HTTP
 * clients over the daemon /api/traffic/* routes (no --from); the daemon
 * handlers own the soft/hard TrafficApiError mapping.
 */
export async function runTrafficCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>> {
  const subcommand = args[0];
  const traffic = context.dependencies.traffic;

  if (subcommand === 'status') {
    return traffic?.status ? traffic.status() : trafficNotImplemented('status');
  }

  if (subcommand === 'mode') {
    const mode = args[1];
    if (mode === undefined) {
      return traffic?.getMode ? traffic.getMode() : trafficNotImplemented('mode');
    }
    if (mode !== 'traffic' && mode !== 'selfpay') {
      return commandFailed('invalid_argument', `mode must be "traffic" or "selfpay", got "${mode}".`);
    }
    return traffic?.setMode ? traffic.setMode({ mode }) : trafficNotImplemented('mode');
  }

  if (subcommand === 'balance') {
    return traffic?.balance ? traffic.balance() : trafficNotImplemented('balance');
  }

  if (subcommand === 'ledger') {
    if (!traffic?.ledger) {
      return trafficNotImplemented('ledger');
    }
    const parsedCursor = parseLedgerCursor(readFlagValue(args, '--cursor'));
    if (parsedCursor.error) return parsedCursor.error;
    const parsedLimit = parseLedgerLimit(readFlagValue(args, '--limit'));
    if (parsedLimit.error) return parsedLimit.error;
    return traffic.ledger({
      ...(parsedCursor.cursor ? { cursor: parsedCursor.cursor } : {}),
      limit: parsedLimit.limit ?? TRAFFIC_LEDGER_DEFAULT_LIMIT,
    });
  }

  if (subcommand === 'usage') {
    return traffic?.usage ? traffic.usage() : trafficNotImplemented('usage');
  }

  if (subcommand === 'claim') {
    return traffic?.claim ? traffic.claim() : trafficNotImplemented('claim');
  }

  if (subcommand === 'redeem') {
    const code = args[1];
    if (!code || code.startsWith('--')) {
      return commandFailed('missing_argument', 'Missing required redeem code. Usage: metabot traffic redeem <code>');
    }
    return traffic?.redeem ? traffic.redeem({ code }) : trafficNotImplemented('redeem');
  }

  if (subcommand === 'api-base') {
    const action = args[1];
    if (action === undefined || action === 'get') {
      return traffic?.getApiBase ? traffic.getApiBase() : trafficNotImplemented('api-base');
    }
    if (action === 'reset') {
      return traffic?.resetApiBase ? traffic.resetApiBase() : trafficNotImplemented('api-base');
    }
    if (action === 'set') {
      const value = args[2];
      if (!value || value.startsWith('--')) {
        return commandFailed('missing_argument', 'Missing required URL. Usage: metabot traffic api-base set <url>');
      }
      return traffic?.setApiBase ? traffic.setApiBase({ apiBase: value }) : trafficNotImplemented('api-base');
    }
    return commandFailed('invalid_argument', `Unknown api-base action: ${action}. Expected "get", "set <url>", or "reset".`);
  }

  return commandUnknownSubcommand(`traffic ${args.join(' ')}`.trim());
}
