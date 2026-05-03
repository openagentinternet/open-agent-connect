"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runNetworkCommand = runNetworkCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
function parseLimitFlag(args) {
    const rawLimit = (0, helpers_1.readFlagValue)(args, '--limit');
    if (rawLimit == null) {
        return {};
    }
    const parsed = Number.parseInt(rawLimit.trim(), 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
        return {
            error: (0, commandResult_1.commandFailed)('invalid_flag', `Unsupported --limit value: ${rawLimit}. Supported range: 1-100.`),
        };
    }
    return { limit: parsed };
}
async function runNetworkCommand(args, context) {
    const shouldRenderTable = Boolean(context.stdout
        && typeof context.stdout === 'object'
        && 'isTTY' in context.stdout
        && context.stdout.isTTY);
    if (args[0] === 'services') {
        const handler = context.dependencies.network?.listServices;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Network services handler is not configured.');
        }
        const parsedLimit = parseLimitFlag(args);
        if (parsedLimit.error) {
            return parsedLimit.error;
        }
        const limit = parsedLimit.limit ?? 20;
        const query = (0, helpers_1.readFlagValue)(args, '--query') ?? (0, helpers_1.readFlagValue)(args, '--search') ?? undefined;
        const request = {
            online: (0, helpers_1.hasFlag)(args, '--online') ? true : undefined,
        };
        if (query) {
            request.query = query;
        }
        const result = await handler(request);
        if (shouldRenderTable && result.ok && result.state === 'success') {
            const data = result.data;
            const allServices = Array.isArray(data?.services) ? data.services : [];
            const services = allServices.slice(0, limit);
            const truncate = (s, max) => s.length > max ? s.slice(0, max) + '...' : s;
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
            const rendered = (0, commandResult_1.commandSuccess)(data);
            rendered.__rawStdoutHandled = true;
            return rendered;
        }
        return result;
    }
    if (args[0] === 'bots') {
        const handler = context.dependencies.network?.listBots;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Network bots handler is not configured.');
        }
        const parsedLimit = parseLimitFlag(args);
        if (parsedLimit.error) {
            return parsedLimit.error;
        }
        const result = await handler({
            online: (0, helpers_1.hasFlag)(args, '--online') ? true : undefined,
            limit: parsedLimit.limit,
        });
        if (shouldRenderTable && result.ok && result.state === 'success') {
            const data = result.data;
            const bots = Array.isArray(data?.bots) ? data.bots : [];
            const truncate = (s, max) => s.length > max ? s.slice(0, max) + '...' : s;
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
            const rendered = (0, commandResult_1.commandSuccess)(data);
            rendered.__rawStdoutHandled = true;
            return rendered;
        }
        return result;
    }
    if (args[0] !== 'sources') {
        return (0, helpers_1.commandUnknownSubcommand)(`network ${args.join(' ')}`.trim());
    }
    const subcommand = args[1];
    if (subcommand === 'list') {
        const handler = context.dependencies.network?.listSources;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Network source list handler is not configured.');
        }
        return handler();
    }
    if (subcommand === 'add') {
        const handler = context.dependencies.network?.addSource;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Network source add handler is not configured.');
        }
        const baseUrl = (0, helpers_1.readFlagValue)(args, '--base-url');
        if (!baseUrl) {
            return (0, helpers_1.commandMissingFlag)('--base-url');
        }
        const label = (0, helpers_1.readFlagValue)(args, '--label') ?? undefined;
        return handler({ baseUrl, label });
    }
    if (subcommand === 'remove') {
        const handler = context.dependencies.network?.removeSource;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Network source remove handler is not configured.');
        }
        const baseUrl = (0, helpers_1.readFlagValue)(args, '--base-url');
        if (!baseUrl) {
            return (0, helpers_1.commandMissingFlag)('--base-url');
        }
        return handler({ baseUrl });
    }
    return (0, helpers_1.commandUnknownSubcommand)(`network ${args.join(' ')}`.trim());
}
