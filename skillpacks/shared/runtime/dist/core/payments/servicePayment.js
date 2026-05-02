"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTestServicePaymentExecutor = createTestServicePaymentExecutor;
exports.createWalletServicePaymentExecutor = createWalletServicePaymentExecutor;
exports.executeServiceOrderPayment = executeServiceOrderPayment;
const node_crypto_1 = require("node:crypto");
const localMnemonicSigner_1 = require("../signing/localMnemonicSigner");
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeCurrency(value) {
    const normalized = normalizeText(value).toUpperCase();
    if (normalized === 'SPACE' || normalized === 'MVC' || normalized === 'BTC') {
        return normalized;
    }
    return '';
}
function resolvePaymentChain(currency) {
    return currency === 'BTC' ? 'btc' : 'mvc';
}
function normalizeAmount(value) {
    const amount = normalizeText(value) || '0';
    const numeric = Number(amount);
    if (!Number.isFinite(numeric) || numeric < 0) {
        throw new Error('service_payment_invalid_amount: Service payment amount must be a non-negative number.');
    }
    return amount;
}
function buildFreeOrderReference(input) {
    const digest = (0, node_crypto_1.createHash)('sha256')
        .update([
        normalizeText(input.traceId),
        normalizeText(input.servicePinId),
        normalizeText(input.providerGlobalMetaId),
    ].join('\n'))
        .digest('hex')
        .slice(0, 16);
    return `free-order-${digest}`;
}
function decimalAmountToSatoshis(value) {
    const amount = normalizeText(value);
    if (!/^\d+(?:\.\d{1,8})?$/.test(amount)) {
        throw new Error('service_payment_invalid_amount: Service payment amount must have at most 8 decimal places.');
    }
    const [wholeRaw, fractionRaw = ''] = amount.split('.');
    const whole = Number.parseInt(wholeRaw || '0', 10);
    const fraction = Number.parseInt(fractionRaw.padEnd(8, '0') || '0', 10);
    const satoshis = whole * 100_000_000 + fraction;
    if (!Number.isSafeInteger(satoshis) || satoshis <= 0) {
        throw new Error('service_payment_invalid_amount: Paid service payment amount must be positive.');
    }
    return satoshis;
}
function createTestServicePaymentExecutor() {
    return {
        async execute(input) {
            const paymentTxid = (0, node_crypto_1.createHash)('sha256')
                .update([
                input.servicePinId,
                input.providerGlobalMetaId,
                input.paymentAddress,
                input.amount,
                input.currency,
                input.paymentChain,
            ].join('\n'))
                .digest('hex');
            return {
                paymentTxid,
                paymentChain: input.paymentChain,
                paymentAmount: input.amount,
                paymentCurrency: input.currency === 'MVC' ? 'SPACE' : input.currency,
                settlementKind: input.settlementKind,
                totalCost: 1,
                network: input.paymentChain,
            };
        },
    };
}
function createWalletServicePaymentExecutor(input) {
    return {
        async execute(paymentInput) {
            const secrets = await input.secretStore.readIdentitySecrets();
            if (!secrets?.mnemonic) {
                throw new Error('identity_secrets_missing: Identity mnemonic not found in the secret store.');
            }
            const transferInput = {
                mnemonic: secrets.mnemonic,
                path: secrets.path ?? "m/44'/10001'/0'/0/0",
                toAddress: paymentInput.paymentAddress,
                amountSatoshis: decimalAmountToSatoshis(paymentInput.amount),
                feeRate: input.feeRate,
            };
            const transfer = paymentInput.paymentChain === 'btc'
                ? await (0, localMnemonicSigner_1.executeBtcTransfer)(transferInput)
                : await (0, localMnemonicSigner_1.executeMvcTransfer)(transferInput);
            return {
                paymentTxid: transfer.txid,
                paymentChain: paymentInput.paymentChain,
                paymentAmount: paymentInput.amount,
                paymentCurrency: paymentInput.currency === 'MVC' ? 'SPACE' : paymentInput.currency,
                settlementKind: paymentInput.settlementKind,
                network: paymentInput.paymentChain,
            };
        },
    };
}
async function executeServiceOrderPayment(input) {
    const amount = normalizeAmount(input.amount);
    const numericAmount = Number(amount);
    const currency = normalizeCurrency(input.currency);
    if (!currency) {
        throw new Error('service_payment_unsupported_settlement: Only native SPACE/MVC and BTC service payments are supported.');
    }
    if (numericAmount === 0) {
        return {
            paymentTxid: null,
            paymentChain: resolvePaymentChain(currency),
            paymentAmount: amount,
            paymentCurrency: currency === 'MVC' ? 'SPACE' : currency,
            settlementKind: 'free',
            orderReference: buildFreeOrderReference({
                traceId: input.traceId,
                servicePinId: input.servicePinId,
                providerGlobalMetaId: input.providerGlobalMetaId,
            }),
            totalCost: 0,
            network: resolvePaymentChain(currency),
        };
    }
    const paymentAddress = normalizeText(input.paymentAddress);
    if (!paymentAddress) {
        throw new Error('service_payment_address_missing: Paid service order requires a payment address.');
    }
    const result = await input.executor.execute({
        servicePinId: normalizeText(input.servicePinId),
        providerGlobalMetaId: normalizeText(input.providerGlobalMetaId),
        paymentAddress,
        amount,
        currency,
        paymentChain: resolvePaymentChain(currency),
        settlementKind: 'native',
    });
    const paymentTxid = normalizeText(result.paymentTxid);
    if (!paymentTxid) {
        throw new Error('payment_txid_missing: Paid service payment executor did not return a payment txid.');
    }
    return {
        paymentTxid,
        paymentCommitTxid: normalizeText(result.paymentCommitTxid) || null,
        paymentChain: result.paymentChain ?? resolvePaymentChain(currency),
        paymentAmount: normalizeText(result.paymentAmount) || amount,
        paymentCurrency: normalizeText(result.paymentCurrency) || (currency === 'MVC' ? 'SPACE' : currency),
        settlementKind: 'native',
        totalCost: typeof result.totalCost === 'number' && Number.isFinite(result.totalCost) ? result.totalCost : null,
        network: normalizeText(result.network) || resolvePaymentChain(currency),
    };
}
