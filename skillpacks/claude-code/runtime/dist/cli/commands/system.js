"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSystemCommand = runSystemCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
const SUPPORTED_HOSTS = ['codex', 'claude-code', 'openclaw'];
function isSupportedHost(value) {
    return SUPPORTED_HOSTS.includes(value);
}
function parseKnownFlags(args, valueFlags, booleanFlags) {
    const valueFlagSet = new Set(valueFlags);
    const booleanFlagSet = new Set(booleanFlags);
    for (let index = 1; index < args.length; index += 1) {
        const token = args[index];
        if (!token.startsWith('--')) {
            continue;
        }
        if (booleanFlagSet.has(token)) {
            continue;
        }
        if (valueFlagSet.has(token)) {
            const value = args[index + 1];
            if (!value || value.startsWith('--')) {
                return {
                    error: (0, commandResult_1.commandFailed)('invalid_flag', `Missing value for ${token}.`),
                };
            }
            index += 1;
            continue;
        }
        return {
            error: (0, commandResult_1.commandFailed)('invalid_flag', `Unsupported flag: ${token}.`),
        };
    }
    return {};
}
async function runSystemCommand(args, context) {
    const subcommand = args[0];
    if (subcommand === 'update') {
        const parsed = parseKnownFlags(args, ['--host', '--target-version'], ['--dry-run', '--json']);
        if (parsed.error) {
            return parsed.error;
        }
        const handler = context.dependencies.system?.update;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'System update handler is not configured.');
        }
        const host = (0, helpers_1.readFlagValue)(args, '--host');
        if (host && !isSupportedHost(host)) {
            return (0, commandResult_1.commandFailed)('invalid_argument', `Unsupported --host value: ${host}. Legacy release-pack update supports only: ${SUPPORTED_HOSTS.join(', ')}. Omit --host for the npm-first registry-driven update path.`);
        }
        const version = (0, helpers_1.readFlagValue)(args, '--target-version') || undefined;
        return handler({
            host: host,
            version,
            dryRun: (0, helpers_1.hasFlag)(args, '--dry-run'),
        });
    }
    if (subcommand === 'uninstall') {
        const parsed = parseKnownFlags(args, ['--confirm-token'], ['--all', '--yes', '--json']);
        if (parsed.error) {
            return parsed.error;
        }
        const handler = context.dependencies.system?.uninstall;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'System uninstall handler is not configured.');
        }
        const all = (0, helpers_1.hasFlag)(args, '--all');
        const confirmToken = (0, helpers_1.readFlagValue)(args, '--confirm-token') || undefined;
        if (confirmToken && !all) {
            return (0, commandResult_1.commandFailed)('invalid_argument', '--confirm-token can only be used together with --all.');
        }
        return handler({
            all,
            confirmToken,
            yes: (0, helpers_1.hasFlag)(args, '--yes'),
        });
    }
    return (0, helpers_1.commandUnknownSubcommand)(`system ${args.join(' ')}`.trim());
}
