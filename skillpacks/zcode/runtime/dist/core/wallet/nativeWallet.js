"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NATIVE_TRANSFER_UNITS = exports.NATIVE_WALLET_CHAINS = void 0;
exports.decimalAmountToSatoshis = decimalAmountToSatoshis;
exports.parseWalletTransferAmount = parseWalletTransferAmount;
exports.resolveIdentityChainAddress = resolveIdentityChainAddress;
exports.queryWalletBalances = queryWalletBalances;
exports.previewWalletTransfer = previewWalletTransfer;
exports.confirmWalletTransfer = confirmWalletTransfer;
const commandResult_1 = require("../contracts/commandResult");
const localMnemonicSigner_1 = require("../signing/localMnemonicSigner");
exports.NATIVE_WALLET_CHAINS = ['mvc', 'btc', 'doge', 'opcat'];
exports.NATIVE_TRANSFER_UNITS = { mvc: 'SPACE', btc: 'BTC', doge: 'DOGE', opcat: 'OPCAT' };
const DEFAULT_DERIVATION_PATH = "m/44'/10001'/0'/0/0";
const ESTIMATED_TRANSFER_VBYTES = 392;
function isNativeWalletChain(chain) {
    return exports.NATIVE_WALLET_CHAINS.includes(chain);
}
function formatNativeAmount(satoshis, currency) {
    return `${(satoshis / 100_000_000).toFixed(8)} ${currency}`;
}
function normalizeErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function isInsufficientBalanceError(message) {
    const lower = message.toLowerCase();
    return lower.includes('insufficient') || lower.includes('not enough') || lower.includes('余额不足');
}
function decimalAmountToSatoshis(value) {
    const amount = value.trim();
    if (!/^\d+(?:\.\d{1,8})?$/.test(amount)) {
        throw new Error('Invalid amount. Amount must be a positive decimal number with at most 8 decimal places.');
    }
    const [wholeRaw, fractionRaw = ''] = amount.split('.');
    const whole = Number.parseInt(wholeRaw, 10);
    const fraction = Number.parseInt(fractionRaw.padEnd(8, '0') || '0', 10);
    const satoshis = whole * 100_000_000 + fraction;
    if (!Number.isSafeInteger(satoshis) || satoshis <= 0) {
        throw new Error('Invalid amount. Amount must be positive.');
    }
    return satoshis;
}
function parseWalletTransferAmount(raw, adapters) {
    const trimmed = raw.trim();
    const match = trimmed.match(/^(\d+(?:\.\d{1,8})?)\s*(btc|space|doge|opcat)$/i);
    if (!match) {
        const supported = 'BTC, SPACE, DOGE, OPCAT';
        if (!/[a-z]/i.test(trimmed)) {
            throw new Error(`Missing currency unit. Append ${supported} to the amount. Example: 0.00001BTC, 1SPACE, 0.01DOGE, or 10OPCAT.`);
        }
        const unitMatch = trimmed.match(/[a-z]+$/i);
        if (unitMatch && !['BTC', 'SPACE', 'DOGE', 'OPCAT'].includes(unitMatch[0].toUpperCase())) {
            throw new Error(`Unsupported currency unit in "${raw}". Supported units: ${supported}.`);
        }
        throw new Error(`Invalid amount "${raw}". Amount must be positive and use at most 8 decimal places.`);
    }
    const currency = match[2].toUpperCase();
    const chain = currency === 'BTC'
        ? 'btc'
        : currency === 'DOGE'
            ? 'doge'
            : currency === 'OPCAT'
                ? 'opcat'
                : 'mvc';
    const adapter = adapters.get(chain);
    if (!adapter) {
        throw new Error(`No adapter registered for chain "${chain}".`);
    }
    return {
        chain,
        currency,
        satoshis: decimalAmountToSatoshis(match[1]),
        adapter,
    };
}
function resolveIdentityChainAddress(identity, chain) {
    const address = identity.addresses?.[chain];
    if (typeof address === 'string' && address.trim()) {
        return address;
    }
    if (chain === 'mvc' && typeof identity.mvcAddress === 'string' && identity.mvcAddress.trim()) {
        return identity.mvcAddress;
    }
    return null;
}
function resolveTargetChains(chain, adapters) {
    const targets = chain === 'all' ? [...exports.NATIVE_WALLET_CHAINS] : [chain];
    const supported = `all, ${exports.NATIVE_WALLET_CHAINS.join(', ')}`;
    for (const target of targets) {
        if (!isNativeWalletChain(target) || !adapters.has(target)) {
            return (0, commandResult_1.commandFailed)('invalid_flag', `Unsupported --chain value: ${target}. Supported values: ${supported}.`);
        }
    }
    return targets;
}
async function prepareWalletTransfer(input) {
    let parsed;
    try {
        parsed = parseWalletTransferAmount(input.amountRaw, input.adapters);
    }
    catch (error) {
        return (0, commandResult_1.commandFailed)('invalid_argument', normalizeErrorMessage(error));
    }
    if (parsed.satoshis < parsed.adapter.minTransferSatoshis) {
        return (0, commandResult_1.commandFailed)('invalid_argument', `Amount is below the minimum of ${parsed.adapter.minTransferSatoshis} satoshis for ${parsed.currency}.`);
    }
    const fromAddress = resolveIdentityChainAddress(input.identity, parsed.chain);
    if (!fromAddress) {
        return (0, commandResult_1.commandFailed)('identity_address_missing', `Current identity has no address for chain "${parsed.chain}".`);
    }
    const feeRate = await parsed.adapter.fetchFeeRate();
    const feeRateSatPerVb = parsed.adapter.feeRateUnit === 'sat/KB' ? feeRate / 1000 : feeRate;
    const estimatedFeeSatoshis = Math.ceil(ESTIMATED_TRANSFER_VBYTES * feeRateSatPerVb);
    const balance = await parsed.adapter.fetchBalance(fromAddress);
    const totalRequired = parsed.satoshis + estimatedFeeSatoshis;
    if (balance.totalSatoshis < totalRequired) {
        const unconfirmedNote = balance.unconfirmedSatoshis > 0
            ? ` (includes ${balance.unconfirmedSatoshis} unconfirmed sats)`
            : '';
        return (0, commandResult_1.commandFailed)('insufficient_balance', `Total balance ${balance.totalSatoshis} sats (${formatNativeAmount(balance.totalSatoshis, parsed.currency)})${unconfirmedNote} is below the required ${totalRequired} sats (${formatNativeAmount(parsed.satoshis, parsed.currency)} + estimated fee ${estimatedFeeSatoshis} sats).`);
    }
    return {
        parsed,
        fromAddress,
        feeRate,
        feeRateSatPerVb,
        estimatedFeeSatoshis,
        balance,
    };
}
async function queryWalletBalances(input) {
    const targetChains = resolveTargetChains(input.chain, input.adapters);
    if (!Array.isArray(targetChains)) {
        return targetChains;
    }
    try {
        const balances = {};
        for (const chain of targetChains) {
            const adapter = input.adapters.get(chain);
            if (!adapter) {
                return (0, commandResult_1.commandFailed)('invalid_flag', `Unsupported --chain value: ${chain}. Supported values: all, ${exports.NATIVE_WALLET_CHAINS.join(', ')}.`);
            }
            const address = resolveIdentityChainAddress(input.identity, chain);
            if (!address) {
                return (0, commandResult_1.commandFailed)('identity_address_missing', `Current identity has no address for chain "${chain}".`);
            }
            balances[chain] = await adapter.fetchBalance(address);
        }
        return (0, commandResult_1.commandSuccess)({
            chain: input.chain,
            globalMetaId: input.identity.globalMetaId,
            balances,
        });
    }
    catch (error) {
        return (0, commandResult_1.commandFailed)('wallet_balance_query_failed', normalizeErrorMessage(error));
    }
}
async function previewWalletTransfer(input) {
    const prepared = await prepareWalletTransfer(input);
    if ('ok' in prepared) {
        return prepared;
    }
    const unconfirmedNote = prepared.balance.unconfirmedSatoshis > 0
        ? ` (includes ${prepared.balance.unconfirmedSatoshis} unconfirmed sats)`
        : '';
    return (0, commandResult_1.commandAwaitingConfirmation)({
        fromAddress: prepared.fromAddress,
        currentBalance: formatNativeAmount(prepared.balance.totalSatoshis, prepared.parsed.currency) + unconfirmedNote,
        currentBalanceSatoshis: prepared.balance.totalSatoshis,
        toAddress: input.toAddress,
        amount: formatNativeAmount(prepared.parsed.satoshis, prepared.parsed.currency),
        amountSatoshis: prepared.parsed.satoshis,
        estimatedFee: formatNativeAmount(prepared.estimatedFeeSatoshis, prepared.parsed.currency),
        estimatedFeeSatoshis: prepared.estimatedFeeSatoshis,
        feeRateSatPerVb: prepared.feeRateSatPerVb,
        currency: prepared.parsed.currency,
        chain: prepared.parsed.chain,
    });
}
async function confirmWalletTransfer(input) {
    const prepared = await prepareWalletTransfer(input);
    if ('ok' in prepared) {
        return prepared;
    }
    const secrets = await input.secretStore.readIdentitySecrets();
    if (!secrets?.mnemonic) {
        return (0, commandResult_1.commandFailed)('identity_secrets_missing', 'Identity mnemonic not found in the secret store.');
    }
    try {
        const result = await (0, localMnemonicSigner_1.executeTransfer)(prepared.parsed.adapter, {
            mnemonic: secrets.mnemonic,
            path: secrets.path ?? input.identity.path ?? DEFAULT_DERIVATION_PATH,
            toAddress: input.toAddress,
            amountSatoshis: prepared.parsed.satoshis,
            feeRate: prepared.feeRate,
        });
        return (0, commandResult_1.commandSuccess)({
            txid: result.txid,
            explorerUrl: `${prepared.parsed.adapter.explorerBaseUrl}/tx/${result.txid}`,
            amount: formatNativeAmount(prepared.parsed.satoshis, prepared.parsed.currency),
            amountSatoshis: prepared.parsed.satoshis,
            toAddress: input.toAddress,
        });
    }
    catch (error) {
        const message = normalizeErrorMessage(error);
        if (isInsufficientBalanceError(message)) {
            return (0, commandResult_1.commandFailed)('insufficient_balance', `Balance is insufficient: ${message}`);
        }
        return (0, commandResult_1.commandFailed)('transfer_broadcast_failed', `Transfer failed: ${message}. Verify the recipient address is correct and that you have enough total balance to cover the amount plus fees. If UTXO inputs appear stale, wait a few seconds and retry.`);
    }
}
