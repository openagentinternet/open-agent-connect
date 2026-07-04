"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMvcFileInscriptionDraft = buildMvcFileInscriptionDraft;
exports.signMvcPreparedUserInputs = signMvcPreparedUserInputs;
exports.extractOwnedOutputsFromPreparedMvcTx = extractOwnedOutputsFromPreparedMvcTx;
const meta_contract_1 = require("meta-contract");
const writePin_1 = require("./writePin");
const mvcPendingUtxos_1 = require("./mvcPendingUtxos");
const mvcSigningIdentity_1 = require("./mvcSigningIdentity");
const NET = 'livenet';
const P2PKH_INPUT_SIZE = 148;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeOutpointTxid(value) {
    return normalizeText(value).toLowerCase();
}
function pickUtxos(utxos, totalOutput, feeRate, estimatedTxSizeWithoutInputs) {
    const confirmed = utxos.filter((utxo) => utxo.height > 0).sort(() => Math.random() - 0.5);
    const unconfirmed = utxos.filter((utxo) => utxo.height <= 0).sort(() => Math.random() - 0.5);
    const ordered = [...confirmed, ...unconfirmed];
    let current = 0;
    const picked = [];
    for (const utxo of ordered) {
        current += utxo.satoshis;
        picked.push(utxo);
        const estimatedTxSize = estimatedTxSizeWithoutInputs + (picked.length * P2PKH_INPUT_SIZE);
        const requiredAmount = totalOutput + Math.ceil(estimatedTxSize * feeRate);
        if (current >= requiredAmount)
            return picked;
    }
    throw new Error('MetaBot balance is insufficient for this chain write.');
}
function buildOpReturnParts(input) {
    const parts = ['metaid', input.operation];
    if (input.operation !== 'init') {
        parts.push(input.path.toLowerCase());
        parts.push(input.encryption);
        parts.push(input.version);
        parts.push(input.contentType);
        parts.push((0, writePin_1.chainWritePayloadToBuffer)(input));
    }
    return parts;
}
function getOpReturnScriptSize(parts) {
    let size = 1;
    for (const part of parts) {
        const length = Buffer.isBuffer(part) ? part.length : Buffer.byteLength(part, 'utf8');
        if (length < 76)
            size += 1 + length;
        else if (length <= 0xff)
            size += 2 + length;
        else if (length <= 0xffff)
            size += 3 + length;
        else
            size += 5 + length;
    }
    return size;
}
function getEstimatedBaseTxSize(opReturnScriptSize) {
    return 4 + 1 + 1 + 43 + (9 + opReturnScriptSize) + 4;
}
async function buildMvcFileInscriptionDraft(input) {
    const feeRate = Number.isFinite(input.feeRate) && Number(input.feeRate) > 0 ? Number(input.feeRate) : 1;
    const deductMinerFeeFromChange = input.deductMinerFeeFromChange !== false;
    const { privateKey, address } = (0, mvcSigningIdentity_1.buildMvcSigningIdentity)(input.identity);
    const usableUtxos = (0, mvcPendingUtxos_1.resolveSpendableMvcUtxos)({ address, utxos: input.utxos });
    const opReturnParts = buildOpReturnParts(input.request);
    const txComposer = new meta_contract_1.TxComposer();
    const addressObject = new meta_contract_1.mvc.Address(address, meta_contract_1.mvc.Networks.livenet);
    txComposer.appendP2PKHOutput({ address: addressObject, satoshis: 1 });
    txComposer.appendOpReturnOutput(opReturnParts);
    const totalOutput = txComposer.tx.outputs.reduce((sum, output) => sum + output.satoshis, 0);
    const picked = pickUtxos(usableUtxos, totalOutput, deductMinerFeeFromChange ? feeRate : 0, getEstimatedBaseTxSize(getOpReturnScriptSize(opReturnParts)));
    for (const utxo of picked) {
        txComposer.appendP2PKHInput({
            address: addressObject,
            txId: utxo.txId,
            outputIndex: utxo.outputIndex,
            satoshis: utxo.satoshis,
        });
    }
    if (deductMinerFeeFromChange) {
        txComposer.appendChangeOutput(addressObject, feeRate);
    }
    else {
        const changeAmount = picked.reduce((sum, utxo) => sum + utxo.satoshis, 0) - totalOutput;
        if (changeAmount > 0) {
            txComposer.appendP2PKHOutput({ address: addressObject, satoshis: changeAmount });
        }
    }
    return {
        address,
        privateKey,
        userInputs: picked,
        selectedUtxos: picked,
        userInputCount: picked.length,
        unsignedTxHex: txComposer.getRawHex(),
    };
}
async function signMvcPreparedUserInputs(input) {
    const { privateKey } = (0, mvcSigningIdentity_1.buildMvcSigningIdentity)(input.identity);
    const txComposer = new meta_contract_1.TxComposer(new meta_contract_1.mvc.Transaction(input.preparedTxHex));
    for (const [userInputOffset, inputIndex] of input.userInputIndexes.entries()) {
        const utxo = input.userInputs[userInputOffset];
        if (!utxo) {
            throw new Error(`Missing user-owned MVC UTXO descriptor for prepared input index ${inputIndex}.`);
        }
        txComposer.tx.inputs[inputIndex].output = new meta_contract_1.mvc.Transaction.Output({
            script: meta_contract_1.mvc.Script.buildPublicKeyHashOut(new meta_contract_1.mvc.Address(utxo.address, meta_contract_1.mvc.Networks.livenet)),
            satoshis: utxo.satoshis,
        });
        txComposer.unlockP2PKHInput(privateKey, inputIndex);
    }
    return { txHex: txComposer.getRawHex() };
}
function extractOwnedOutputsFromPreparedMvcTx(input) {
    const txId = normalizeOutpointTxid(input.txId);
    if (!txId)
        return [];
    const tx = new meta_contract_1.mvc.Transaction(input.txHex);
    const address = normalizeText(input.address);
    const owned = [];
    tx.outputs.forEach((output, outputIndex) => {
        let outputAddress = '';
        try {
            const resolved = output.script?.toAddress?.(NET);
            outputAddress = normalizeText(resolved == null ? '' : String(resolved));
        }
        catch {
            outputAddress = '';
        }
        const satoshis = Number(output.satoshis ?? 0);
        if (outputAddress === address && Number.isFinite(satoshis) && satoshis > 0) {
            owned.push({ txId, outputIndex, satoshis, address, height: 0 });
        }
    });
    return owned;
}
