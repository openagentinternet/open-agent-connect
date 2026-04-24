"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runWalletCommand = runWalletCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
function readWalletBalanceChainFlag(args) {
    const index = args.indexOf('--chain');
    if (index === -1) {
        return { chain: 'all', error: null };
    }
    const rawValue = args[index + 1];
    if (typeof rawValue !== 'string' || rawValue.startsWith('--')) {
        return {
            chain: 'all',
            error: (0, commandResult_1.commandFailed)('invalid_flag', 'Missing value for --chain. Supported values: all, mvc, btc.'),
        };
    }
    const normalized = rawValue.trim().toLowerCase();
    if (normalized !== 'all' && normalized !== 'mvc' && normalized !== 'btc') {
        return {
            chain: 'all',
            error: (0, commandResult_1.commandFailed)('invalid_flag', `Unsupported --chain value: ${rawValue}. Supported values: all, mvc, btc.`),
        };
    }
    return { chain: normalized, error: null };
}
async function runWalletCommand(args, context) {
    if (args[0] !== 'balance') {
        return (0, helpers_1.commandUnknownSubcommand)(`wallet ${args.join(' ')}`.trim());
    }
    const chainFlag = readWalletBalanceChainFlag(args);
    if (chainFlag.error) {
        return chainFlag.error;
    }
    const handler = context.dependencies.wallet?.balance;
    if (!handler) {
        return (0, commandResult_1.commandFailed)('not_implemented', 'Wallet balance handler is not configured.');
    }
    return handler({ chain: chainFlag.chain });
}
