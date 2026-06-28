"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMvcLargeUploadFunding = buildMvcLargeUploadFunding;
const meta_contract_1 = require("meta-contract");
const deriveIdentity_1 = require("../identity/deriveIdentity");
const mvcPendingUtxos_1 = require("./mvcPendingUtxos");
const NET = 'livenet';
const P2PKH_INPUT_SIZE = 148;
const PRE_TX_SIGTYPE = meta_contract_1.mvc.crypto.Signature.SIGHASH_NONE | meta_contract_1.mvc.crypto.Signature.SIGHASH_FORKID;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function readPositiveNumber(name, value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        throw new Error(`${name} must be a positive number.`);
    }
    return numeric;
}
function readPositiveInteger(name, value) {
    const numeric = readPositiveNumber(name, value);
    if (!Number.isInteger(numeric)) {
        throw new Error(`${name} must be a positive integer.`);
    }
    return numeric;
}
function buildMvcSigningIdentity(mnemonic, path) {
    const network = meta_contract_1.mvc.Networks.livenet;
    const addressIndex = (0, deriveIdentity_1.parseAddressIndexFromPath)(path);
    const mnemonicObject = meta_contract_1.mvc.Mnemonic.fromString(mnemonic);
    const hdPrivateKey = mnemonicObject.toHDPrivateKey('', network);
    const childPrivateKey = hdPrivateKey.deriveChild(`m/44'/10001'/0'/0/${addressIndex}`);
    return {
        privateKey: childPrivateKey.privateKey,
        address: childPrivateKey.publicKey.toAddress(network).toString(),
    };
}
function isUsableFundingUtxo(utxo, fundingAddress) {
    return (normalizeText(utxo.address) === fundingAddress &&
        /^[0-9a-f]{64}:\d+$/u.test((0, mvcPendingUtxos_1.getMvcUtxoOutpointKey)({
            txId: utxo.txId,
            outputIndex: utxo.outputIndex,
        }))
        && Number.isInteger(utxo.outputIndex)
        && utxo.outputIndex >= 0
        && Number.isInteger(utxo.satoshis)
        && utxo.satoshis >= 600);
}
function normalizeExcludedOutpoints(excludedOutpoints) {
    const normalized = new Set();
    for (const outpoint of excludedOutpoints ?? []) {
        const value = normalizeText(outpoint);
        const separatorIndex = value.lastIndexOf(':');
        if (separatorIndex <= 0)
            continue;
        const txId = value.slice(0, separatorIndex);
        const outputIndex = Number(value.slice(separatorIndex + 1));
        if (!Number.isInteger(outputIndex) || outputIndex < 0)
            continue;
        normalized.add((0, mvcPendingUtxos_1.getMvcUtxoOutpointKey)({ txId, outputIndex }));
    }
    return normalized;
}
function selectFundingUtxos(input) {
    const candidates = input.utxos.filter((utxo) => {
        if (!isUsableFundingUtxo(utxo, input.fundingAddress))
            return false;
        const outpoint = (0, mvcPendingUtxos_1.getMvcUtxoOutpointKey)({
            txId: utxo.txId,
            outputIndex: utxo.outputIndex,
        });
        return !input.excludedOutpoints.has(outpoint);
    });
    if (candidates.length === 0) {
        throw new Error('No spendable MVC UTXOs are available for large upload funding.');
    }
    let current = 0;
    const selected = [];
    for (const utxo of candidates) {
        current += utxo.satoshis;
        selected.push(utxo);
        const estimatedRequired = input.outputAmount
            + Math.ceil((100 + (34 * 2) + (selected.length * P2PKH_INPUT_SIZE)) * input.feeRate);
        if (current > estimatedRequired) {
            return selected;
        }
    }
    throw new Error('Insufficient MVC balance for large upload funding.');
}
function buildPreTx(input) {
    const txComposer = new meta_contract_1.TxComposer();
    txComposer.appendP2PKHInput({
        address: new meta_contract_1.mvc.Address(input.address, NET),
        txId: input.mergeTxId,
        outputIndex: input.outputIndex,
        satoshis: input.satoshis,
    });
    txComposer.unlockP2PKHInput(input.privateKey, 0, PRE_TX_SIGTYPE);
    return txComposer.getRawHex();
}
async function buildMvcLargeUploadFunding(input) {
    const feeRate = readPositiveNumber('feeRate', input.feeRate);
    const chunkPreTxFee = readPositiveInteger('chunkPreTxFee', input.chunkPreTxFee);
    const indexPreTxFee = readPositiveInteger('indexPreTxFee', input.indexPreTxFee);
    const signingIdentity = buildMvcSigningIdentity(input.identity.mnemonic, input.identity.path);
    const derivedAddress = normalizeText(signingIdentity.address);
    if (!derivedAddress) {
        throw new Error('MVC funding address is required for large upload funding.');
    }
    const requestedAddress = normalizeText(input.address)
        || normalizeText(input.identity.addresses?.mvc)
        || normalizeText(input.identity.mvcAddress);
    if (requestedAddress && requestedAddress !== derivedAddress) {
        throw new Error('MVC funding address does not match derived MVC address.');
    }
    const address = derivedAddress;
    const chunkPreTxOutputAmount = chunkPreTxFee + Math.ceil((200 + 150) * feeRate);
    const indexPreTxOutputAmount = indexPreTxFee + Math.ceil((200 + 150) * feeRate);
    const outputAmount = chunkPreTxOutputAmount + indexPreTxOutputAmount;
    const spentUtxos = selectFundingUtxos({
        utxos: input.utxos,
        outputAmount,
        feeRate,
        fundingAddress: address,
        excludedOutpoints: normalizeExcludedOutpoints(input.excludedOutpoints),
    });
    const privateKey = signingIdentity.privateKey;
    const addressObject = new meta_contract_1.mvc.Address(address, meta_contract_1.mvc.Networks.livenet);
    const mergeComposer = new meta_contract_1.TxComposer();
    mergeComposer.appendP2PKHOutput({
        address: addressObject,
        satoshis: chunkPreTxOutputAmount,
    });
    mergeComposer.appendP2PKHOutput({
        address: addressObject,
        satoshis: indexPreTxOutputAmount,
    });
    for (const utxo of spentUtxos) {
        mergeComposer.appendP2PKHInput({
            address: addressObject,
            txId: utxo.txId,
            outputIndex: utxo.outputIndex,
            satoshis: utxo.satoshis,
        });
    }
    mergeComposer.appendChangeOutput(addressObject, feeRate);
    for (let inputIndex = 0; inputIndex < mergeComposer.tx.inputs.length; inputIndex += 1) {
        mergeComposer.unlockP2PKHInput(privateKey, inputIndex);
    }
    const mergeTxHex = mergeComposer.getRawHex();
    const mergeTx = new meta_contract_1.mvc.Transaction(mergeTxHex);
    const mergeTxId = mergeTx.id;
    const changeIndex = mergeTx.outputs.length > 2 ? mergeTx.outputs.length - 1 : -1;
    const changeUtxo = changeIndex >= 0
        ? {
            txId: mergeTxId,
            outputIndex: changeIndex,
            satoshis: Number(mergeTx.outputs[changeIndex].satoshis),
            address,
            height: 0,
        }
        : null;
    return {
        mergeTxHex,
        mergeTxId,
        chunkPreTxHex: buildPreTx({
            mergeTxId,
            outputIndex: 0,
            satoshis: Number(mergeTx.outputs[0].satoshis),
            address,
            privateKey,
        }),
        indexPreTxHex: buildPreTx({
            mergeTxId,
            outputIndex: 1,
            satoshis: Number(mergeTx.outputs[1].satoshis),
            address,
            privateKey,
        }),
        chunkPreTxOutputAmount,
        indexPreTxOutputAmount,
        spentUtxos,
        spentOutpoints: spentUtxos.map((utxo) => (0, mvcPendingUtxos_1.getMvcUtxoOutpointKey)({
            txId: utxo.txId,
            outputIndex: utxo.outputIndex,
        })),
        changeUtxo,
    };
}
