"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.decimalPaymentAmountToSatoshis = decimalPaymentAmountToSatoshis;
exports.verifyServiceOrderPayment = verifyServiceOrderPayment;
const meta_contract_1 = require("meta-contract");
const bitcoin = __importStar(require("bitcoinjs-lib"));
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeCurrency(value) {
    const normalized = normalizeText(value).toUpperCase();
    return normalized === 'MVC' ? 'SPACE' : normalized;
}
function normalizePaymentChain(value, currency) {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === 'mvc' || normalized === 'btc')
        return normalized;
    const normalizedCurrency = normalizeCurrency(currency);
    if (normalizedCurrency === 'BTC')
        return 'btc';
    if (normalizedCurrency === 'SPACE')
        return 'mvc';
    return '';
}
function decimalPaymentAmountToSatoshis(value) {
    const amount = normalizeText(value);
    if (!/^\d+(?:\.\d{1,8})?$/.test(amount)) {
        throw new Error('service_payment_invalid_amount: Service payment amount must have at most 8 decimal places.');
    }
    const [wholeRaw, fractionRaw = ''] = amount.split('.');
    const whole = Number.parseInt(wholeRaw || '0', 10);
    const fraction = Number.parseInt(fractionRaw.padEnd(8, '0') || '0', 10);
    const satoshis = whole * 100_000_000 + fraction;
    if (!Number.isSafeInteger(satoshis) || satoshis < 0) {
        throw new Error('service_payment_invalid_amount: Service payment amount is out of range.');
    }
    return satoshis;
}
function readMvcOutputAddress(output) {
    try {
        const address = output.script?.toAddress?.(meta_contract_1.mvc.Networks.livenet);
        return address == null ? '' : String(address).trim();
    }
    catch {
        return '';
    }
}
function findMvcPaymentOutput(input) {
    const tx = new meta_contract_1.mvc.Transaction(input.rawTx);
    const outputs = Array.isArray(tx.outputs) ? tx.outputs : [];
    const index = outputs.findIndex((output) => (Number(output.satoshis ?? 0) >= input.amountSatoshis
        && readMvcOutputAddress(output) === input.paymentAddress));
    return index >= 0 ? index : null;
}
function findBtcPaymentOutput(input) {
    const tx = bitcoin.Transaction.fromHex(input.rawTx);
    const index = tx.outs.findIndex((output) => {
        if (Number(output.value) < input.amountSatoshis) {
            return false;
        }
        try {
            return bitcoin.address.fromOutputScript(output.script, bitcoin.networks.bitcoin) === input.paymentAddress;
        }
        catch {
            return false;
        }
    });
    return index >= 0 ? index : null;
}
async function findMvcPaymentUtxoFallback(input) {
    const utxos = await input.adapter.fetchUtxos(input.paymentAddress);
    const match = utxos.find((utxo) => (normalizeText(utxo.txId).toLowerCase() === input.paymentTxid.toLowerCase()
        && normalizeText(utxo.address) === input.paymentAddress
        && Number(utxo.satoshis ?? 0) >= input.amountSatoshis));
    return match ? match.outputIndex : null;
}
async function verifyServiceOrderPayment(input) {
    const amount = normalizeText(input.amount) || '0';
    const currency = normalizeCurrency(input.currency);
    const amountSatoshis = decimalPaymentAmountToSatoshis(amount);
    const paymentTxid = normalizeText(input.paymentTxid) || null;
    const settlementKind = normalizeText(input.settlementKind).toLowerCase() === 'free' || amountSatoshis === 0
        ? 'free'
        : 'native';
    const paymentChain = settlementKind === 'free'
        ? null
        : normalizePaymentChain(input.paymentChain, currency);
    const paymentAddress = normalizeText(input.paymentAddress) || null;
    if (settlementKind === 'free') {
        const verified = !paymentTxid && amountSatoshis === 0;
        return {
            verified,
            outcome: verified ? 'verified' : 'mismatch',
            paymentTxid: null,
            paymentChain: null,
            settlementKind,
            paymentAddress: null,
            amount,
            currency,
            amountSatoshis,
            matchedOutputIndex: null,
            failureKind: verified ? null : 'input_invalid',
        };
    }
    if (!paymentTxid || !paymentChain || !paymentAddress || amountSatoshis <= 0) {
        return {
            verified: false,
            outcome: 'mismatch',
            paymentTxid,
            paymentChain: paymentChain || null,
            settlementKind,
            paymentAddress,
            amount,
            currency,
            amountSatoshis,
            matchedOutputIndex: null,
            failureKind: 'input_invalid',
        };
    }
    const adapter = input.adapters.get(paymentChain);
    if (!adapter) {
        return {
            verified: false,
            outcome: 'mismatch',
            paymentTxid,
            paymentChain,
            settlementKind,
            paymentAddress,
            amount,
            currency,
            amountSatoshis,
            matchedOutputIndex: null,
            failureKind: 'adapter_missing',
        };
    }
    let matchedOutputIndex = null;
    let failureKind = null;
    try {
        const rawTx = await adapter.fetchRawTx(paymentTxid);
        matchedOutputIndex = paymentChain === 'btc'
            ? findBtcPaymentOutput({ rawTx, paymentAddress, amountSatoshis })
            : findMvcPaymentOutput({ rawTx, paymentAddress, amountSatoshis });
        if (matchedOutputIndex === null) {
            failureKind = 'output_mismatch';
        }
    }
    catch (error) {
        if (paymentChain !== 'mvc') {
            // The only lookup available for this chain failed to answer; this is a
            // transient transport/indexer failure, not evidence of a missing payment.
            failureKind = 'chain_unavailable';
        }
        else {
            let utxoLookupFailed = false;
            matchedOutputIndex = await findMvcPaymentUtxoFallback({
                adapter,
                paymentTxid,
                paymentAddress,
                amountSatoshis,
            }).catch(() => {
                utxoLookupFailed = true;
                return null;
            });
            if (matchedOutputIndex === null) {
                // The raw-tx lookup already failed, so an empty or failed UTXO fallback
                // only proves non-payment when the fallback itself answered.
                failureKind = utxoLookupFailed ? 'chain_unavailable' : 'payment_not_found';
            }
        }
    }
    return {
        verified: matchedOutputIndex !== null,
        outcome: matchedOutputIndex !== null
            ? 'verified'
            : failureKind === 'chain_unavailable'
                ? 'error'
                : 'mismatch',
        paymentTxid,
        paymentChain,
        settlementKind,
        paymentAddress,
        amount,
        currency,
        amountSatoshis,
        matchedOutputIndex,
        failureKind: matchedOutputIndex !== null ? null : failureKind,
    };
}
