"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runWalletCommand = runWalletCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
function readStringFlag(args, flag) {
    const index = args.indexOf(flag);
    if (index === -1)
        return null;
    const value = args[index + 1];
    return typeof value === 'string' && !value.startsWith('--') ? value : null;
}
/**
 * Read --chain flag with dynamic validation against the adapter registry.
 * The supported chains are read from the wallet balance handler's metadata
 * or validated at runtime. For CLI command parsing, we accept any non-empty
 * chain name and let the handler validate it.
 */
function readWalletBalanceChainFlag(args) {
    const index = args.indexOf('--chain');
    if (index === -1) {
        return { chain: 'all', error: null };
    }
    const rawValue = args[index + 1];
    if (typeof rawValue !== 'string' || rawValue.startsWith('--')) {
        return {
            chain: 'all',
            error: (0, commandResult_1.commandFailed)('invalid_flag', 'Missing value for --chain.'),
        };
    }
    const normalized = rawValue.trim().toLowerCase();
    if (!normalized) {
        return {
            chain: 'all',
            error: (0, commandResult_1.commandFailed)('invalid_flag', 'Empty --chain value.'),
        };
    }
    return { chain: normalized, error: null };
}
async function runWalletCommand(args, context) {
    if (args[0] === 'balance') {
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
    if (args[0] === 'transfer') {
        const toAddress = readStringFlag(args, '--to');
        if (!toAddress) {
            return (0, commandResult_1.commandFailed)('invalid_argument', 'Missing --to <address>. Specify the recipient address.');
        }
        const amountRaw = readStringFlag(args, '--amount');
        if (!amountRaw) {
            return (0, commandResult_1.commandFailed)('invalid_argument', 'Missing --amount <amount><UNIT>. Example: 0.00001BTC or 1SPACE.');
        }
        const confirm = args.includes('--confirm');
        const handler = context.dependencies.wallet?.transfer;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Wallet transfer handler is not configured.');
        }
        return handler({ toAddress, amountRaw, confirm });
    }
    return (0, helpers_1.commandUnknownSubcommand)(`wallet ${args.join(' ')}`.trim());
}
