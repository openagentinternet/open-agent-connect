import { commandFailed, commandSuccess, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { commandMissingFlag, commandUnknownSubcommand, hasFlag, readFlagValue } from './helpers';
import type { CliRuntimeContext } from '../types';

function parseLimitFlag(args: string[]): { limit?: number; error?: MetabotCommandResult<never> } {
  const rawLimit = readFlagValue(args, '--limit');
  if (rawLimit == null) {
    return {};
  }

  const parsed = Number.parseInt(rawLimit.trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    return {
      error: commandFailed(
        'invalid_flag',
        `Unsupported --limit value: ${rawLimit}. Supported range: 1-100.`,
      ),
    };
  }

  return { limit: parsed };
}

export async function runNetworkCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>> {
  const shouldRenderTable = Boolean(
    context.stdout
    && typeof context.stdout === 'object'
    && 'isTTY' in (context.stdout as Record<string, unknown>)
    && (context.stdout as { isTTY?: boolean }).isTTY,
  );

  if (args[0] === 'services') {
    const handler = context.dependencies.network?.listServices;
    if (!handler) {
      return commandFailed('not_implemented', 'Network services handler is not configured.');
    }

    const parsedLimit = parseLimitFlag(args);
    if (parsedLimit.error) {
      return parsedLimit.error;
    }
    const limit = parsedLimit.limit ?? 20;
    const query = readFlagValue(args, '--query') ?? readFlagValue(args, '--search') ?? undefined;

    const request: { online?: boolean; query?: string } = {
      online: hasFlag(args, '--online') ? true : undefined,
    };
    if (query) {
      request.query = query;
    }
    const result = await handler(request);

    if (shouldRenderTable && result.ok && result.state === 'success') {
      const data = result.data as { services?: Array<Record<string, unknown>> };
      const allServices = Array.isArray(data?.services) ? data.services : [];
      const services = allServices.slice(0, limit);
      const truncate = (s: string, max: number) => s.length > max ? s.slice(0, max) + '...' : s;
      const rows = ['| # | service | provider | price | Last Seen |', '|---|---------|----------|-------|-----------|'];
      for (let i = 0; i < services.length; i++) {
        const svc = services[i];
        const service = truncate(String(svc['displayName'] || svc['serviceName'] || ''), 30);
        const gmid = String(svc['providerGlobalMetaId'] || '');
        const name = String(svc['providerName'] || '');
        const provider = name ? `${truncate(name, 20)}(${truncate(gmid, 20)})` : truncate(gmid, 30);
        const priceVal = String(svc['price'] || '');
        const currencyVal = String(svc['currency'] || '');
        const price = priceVal ? `${priceVal}${currencyVal ? currencyVal : ''}` : '-';
        const agoSec = typeof svc['lastSeenAgoSeconds'] === 'number' ? svc['lastSeenAgoSeconds'] : null;
        const lastSeen = agoSec != null ? `${agoSec}s 🟢` : '-';
        rows.push(`| ${i + 1} | ${service} | ${provider} | ${price} | ${lastSeen} |`);
      }
      context.stdout.write(rows.join('\n') + '\n');
      const rendered = commandSuccess(data) as MetabotCommandResult<unknown> & { __rawStdoutHandled?: boolean };
      rendered.__rawStdoutHandled = true;
      return rendered;
    }

    return result;
  }

  if (args[0] === 'bots') {
    const handler = context.dependencies.network?.listBots;
    if (!handler) {
      return commandFailed('not_implemented', 'Network bots handler is not configured.');
    }

    const parsedLimit = parseLimitFlag(args);
    if (parsedLimit.error) {
      return parsedLimit.error;
    }

    const result = await handler({
      online: hasFlag(args, '--online') ? true : undefined,
      limit: parsedLimit.limit,
    });

    if (shouldRenderTable && result.ok && result.state === 'success') {
      const data = result.data as { bots?: Array<{ globalMetaId: string; name?: string; goal?: string; lastSeenAgoSeconds?: number }> };
      const bots = Array.isArray(data?.bots) ? data.bots : [];
      const truncate = (s: string, max: number) => s.length > max ? s.slice(0, max) + '...' : s;
      const rows = ['| # | name | globalmetaid | bio | Last Seen |', '|---|------|-------------|-----|-----------|'];
      for (let i = 0; i < bots.length; i++) {
        const bot = bots[i];
        const name = truncate(bot.name ?? '', 20);
        const gmid = bot.globalMetaId;
        const bio = truncate(bot.goal ?? '', 40);
        const lastSeen = `${bot.lastSeenAgoSeconds ?? 0}s 🟢`;
        rows.push(`| ${i + 1} | ${name} | ${gmid} | ${bio} | ${lastSeen} |`);
      }
      context.stdout.write(rows.join('\n') + '\n');
      const rendered = commandSuccess(data) as MetabotCommandResult<unknown> & { __rawStdoutHandled?: boolean };
      rendered.__rawStdoutHandled = true;
      return rendered;
    }

    return result;
  }

  if (args[0] !== 'sources') {
    return commandUnknownSubcommand(`network ${args.join(' ')}`.trim());
  }

  const subcommand = args[1];

  if (subcommand === 'list') {
    const handler = context.dependencies.network?.listSources;
    if (!handler) {
      return commandFailed('not_implemented', 'Network source list handler is not configured.');
    }
    return handler();
  }

  if (subcommand === 'add') {
    const handler = context.dependencies.network?.addSource;
    if (!handler) {
      return commandFailed('not_implemented', 'Network source add handler is not configured.');
    }
    const baseUrl = readFlagValue(args, '--base-url');
    if (!baseUrl) {
      return commandMissingFlag('--base-url');
    }
    const label = readFlagValue(args, '--label') ?? undefined;
    return handler({ baseUrl, label });
  }

  if (subcommand === 'remove') {
    const handler = context.dependencies.network?.removeSource;
    if (!handler) {
      return commandFailed('not_implemented', 'Network source remove handler is not configured.');
    }
    const baseUrl = readFlagValue(args, '--base-url');
    if (!baseUrl) {
      return commandMissingFlag('--base-url');
    }
    return handler({ baseUrl });
  }

  return commandUnknownSubcommand(`network ${args.join(' ')}`.trim());
}
