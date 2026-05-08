"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mvcChainAdapter = void 0;
exports.__clearPendingMvcSpentOutpointsForTests = __clearPendingMvcSpentOutpointsForTests;
const meta_contract_1 = require("meta-contract");
const utxo_wallet_service_1 = require("@metalet/utxo-wallet-service");
const deriveIdentity_1 = require("../../identity/deriveIdentity");
const METALET_HOST = 'https://www.metalet.space';
const NET = 'livenet';
const P2PKH_INPUT_SIZE = 148;
const DEFAULT_MVC_FEE_RATE = 1;
// ---- pending UTXO tracking (for local change detection) ----
const PENDING_SPENT_OUTPOINT_TTL_MS = 10 * 60 * 1000;
/** Maps address:txid:outputIndex → pending spent outpoint */
const pendingSpentOutpoints = new Map();
const pendingAvailableUtxos = new Map();
const deferredTrackers = new Map();
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeOutpointTxid(value) {
    return normalizeText(value).toLowerCase();
}
function buildOutpointKey(address, txId, outputIndex) {
    return [normalizeText(address), normalizeOutpointTxid(txId), String(outputIndex)].join(':');
}
function prunePendingSpentOutpoints(now = Date.now()) {
    for (const [key, value] of pendingSpentOutpoints.entries()) {
        if (value.expiresAt <= now)
            pendingSpentOutpoints.delete(key);
    }
    for (const [key, value] of pendingAvailableUtxos.entries()) {
        if (value.expiresAt <= now)
            pendingAvailableUtxos.delete(key);
    }
}
function rememberPendingTransaction(input) {
    const now = input.now ?? Date.now();
    prunePendingSpentOutpoints(now);
    const expiresAt = now + PENDING_SPENT_OUTPOINT_TTL_MS;
    for (const utxo of input.spentUtxos) {
        const key = buildOutpointKey(input.address, utxo.txId, utxo.outputIndex);
        pendingSpentOutpoints.set(key, { expiresAt });
        pendingAvailableUtxos.delete(key);
    }
    for (const utxo of input.createdUtxos) {
        if (utxo.satoshis < 600)
            continue;
        const key = buildOutpointKey(input.address, utxo.txId, utxo.outputIndex);
        if (!pendingSpentOutpoints.has(key)) {
            pendingAvailableUtxos.set(key, { utxo, expiresAt });
        }
    }
}
function resolveSpendableUtxos(input) {
    const now = input.now ?? Date.now();
    prunePendingSpentOutpoints(now);
    const merged = new Map();
    for (const utxo of input.utxos) {
        merged.set(buildOutpointKey(input.address, utxo.txId, utxo.outputIndex), utxo);
    }
    for (const [key, value] of pendingAvailableUtxos.entries()) {
        if (normalizeText(value.utxo.address) === normalizeText(input.address)) {
            merged.set(key, value.utxo);
        }
    }
    return [...merged.entries()]
        .filter(([key]) => !pendingSpentOutpoints.has(key))
        .map(([, utxo]) => utxo);
}
function extractOwnedOutputs(input) {
    const txId = normalizeOutpointTxid(input.txid);
    if (!txId)
        return [];
    const owned = [];
    input.outputs.forEach((output, outputIndex) => {
        let outputAddress = '';
        try {
            const resolved = output.script?.toAddress?.(NET);
            outputAddress = normalizeText(resolved == null ? '' : String(resolved));
        }
        catch {
            outputAddress = '';
        }
        const satoshis = Number(output.satoshis ?? 0);
        if (outputAddress === normalizeText(input.address) && Number.isFinite(satoshis) && satoshis > 0) {
            owned.push({ txId, outputIndex, satoshis, address: input.address, height: 0 });
        }
    });
    return owned;
}
function __clearPendingMvcSpentOutpointsForTests() {
    pendingSpentOutpoints.clear();
    pendingAvailableUtxos.clear();
    deferredTrackers.clear();
}
// ---- helpers ----
function toFiniteNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
}
async function getV3AddressType() {
    return utxo_wallet_service_1.AddressType.LegacyMvc;
}
// ---- private key / address ----
function buildMvcPrivateKey(mnemonic, path) {
    const network = meta_contract_1.mvc.Networks.livenet;
    const addressIndex = (0, deriveIdentity_1.parseAddressIndexFromPath)(path);
    const mnemonicObject = meta_contract_1.mvc.Mnemonic.fromString(mnemonic);
    const hdPrivateKey = mnemonicObject.toHDPrivateKey('', network);
    const childPrivateKey = hdPrivateKey.deriveChild(`m/44'/10001'/0'/0/${addressIndex}`);
    const address = childPrivateKey.publicKey.toAddress(network).toString();
    return { privateKey: childPrivateKey.privateKey, address };
}
// ---- UTXO selection ----
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
// ---- OP_RETURN ----
function buildOpReturnParts(input) {
    const parts = ['metaid', input.operation];
    if (input.operation !== 'init') {
        parts.push(input.path.toLowerCase());
        parts.push(input.encryption);
        parts.push(input.version);
        parts.push(input.contentType);
        parts.push(Buffer.from(input.payload, input.encoding));
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
// ---- MvcChainAdapter ----
exports.mvcChainAdapter = {
    network: 'mvc',
    explorerBaseUrl: 'https://www.mvcscan.com',
    feeRateUnit: 'sat/byte',
    minTransferSatoshis: 600,
    async deriveAddress(mnemonic, path) {
        const addressIndex = (0, deriveIdentity_1.parseAddressIndexFromPath)(path);
        const wallet = new utxo_wallet_service_1.MvcWallet({
            coinType: utxo_wallet_service_1.CoinType.MVC,
            addressType: await getV3AddressType(),
            addressIndex,
            network: NET,
            mnemonic,
        });
        return wallet.getAddress();
    },
    async fetchUtxos(address) {
        const all = [];
        let flag;
        while (true) {
            const params = new URLSearchParams({ address, net: NET, ...(flag ? { flag } : {}) });
            const response = await fetch(`${METALET_HOST}/wallet-api/v4/mvc/address/utxo-list?${params}`);
            const json = await response.json();
            const list = json?.data?.list ?? [];
            if (!list.length)
                break;
            all.push(...list.filter((utxo) => utxo.value >= 600).map((utxo) => ({
                txId: utxo.txid,
                outputIndex: utxo.outIndex,
                satoshis: utxo.value,
                address,
                height: utxo.height,
            })));
            flag = list[list.length - 1]?.flag;
            if (!flag)
                break;
        }
        return all;
    },
    async fetchBalance(address) {
        const utxos = await this.fetchUtxos(address);
        let totalSatoshis = 0;
        let confirmedSatoshis = 0;
        let unconfirmedSatoshis = 0;
        for (const utxo of utxos) {
            totalSatoshis += utxo.satoshis;
            if (utxo.height > 0)
                confirmedSatoshis += utxo.satoshis;
            else
                unconfirmedSatoshis += utxo.satoshis;
        }
        return {
            chain: 'mvc',
            address,
            totalSatoshis,
            confirmedSatoshis,
            unconfirmedSatoshis,
            utxoCount: utxos.length,
        };
    },
    async fetchFeeRate() {
        try {
            const url = `${METALET_HOST}/wallet-api/v4/mvc/fee/summary?net=${NET}`;
            const response = await fetch(url);
            const json = await response.json();
            if (json?.code !== 0)
                return DEFAULT_MVC_FEE_RATE;
            const list = json?.data?.list ?? [];
            const avg = list.find((t) => /avg/i.test(String(t?.title ?? '')));
            const rate = toFiniteNumber(avg?.feeRate ?? list[0]?.feeRate);
            return rate > 0 ? rate : DEFAULT_MVC_FEE_RATE;
        }
        catch {
            return DEFAULT_MVC_FEE_RATE;
        }
    },
    async fetchRawTx(txid) {
        const params = new URLSearchParams({ txId: txid, chain: 'mvc', net: NET });
        const response = await fetch(`${METALET_HOST}/wallet-api/v3/tx/raw?${params}`);
        const json = await response.json();
        if (json?.code !== 0)
            throw new Error(json?.message || 'Metalet MVC raw tx query failed.');
        const rawTx = normalizeText(json?.data?.rawTx ?? json?.data?.hex);
        if (!rawTx)
            throw new Error(`Metalet MVC raw tx response is empty for ${txid}.`);
        return rawTx;
    },
    async broadcastTx(rawTx) {
        const response = await fetch(`${METALET_HOST}/wallet-api/v3/tx/broadcast`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ chain: 'mvc', net: NET, rawTx }),
        });
        const json = await response.json();
        if (json?.code !== 0)
            throw new Error(json?.message || 'Broadcast failed');
        const txid = json.data ?? '';
        // Complete deferred pending UTXO tracking
        const tracker = deferredTrackers.get(rawTx);
        if (tracker) {
            rememberPendingTransaction({
                address: tracker.address,
                spentUtxos: tracker.spentUtxos,
                createdUtxos: tracker.createdUtxosFactory(txid),
            });
            deferredTrackers.delete(rawTx);
        }
        return txid;
    },
    async buildTransfer(input) {
        const feeRate = Number.isFinite(input.feeRate) && Number(input.feeRate) > 0
            ? input.feeRate : DEFAULT_MVC_FEE_RATE;
        const { privateKey, address } = buildMvcPrivateKey(input.mnemonic, input.path);
        const rawUtxos = await this.fetchUtxos(address);
        const utxos = resolveSpendableUtxos({ address, utxos: rawUtxos });
        const SIMPLE_BASE_SIZE = 96;
        const picked = pickUtxos(utxos, input.amountSatoshis, feeRate, SIMPLE_BASE_SIZE);
        const senderAddress = new meta_contract_1.mvc.Address(address, meta_contract_1.mvc.Networks.livenet);
        const recipientAddress = new meta_contract_1.mvc.Address(input.toAddress, meta_contract_1.mvc.Networks.livenet);
        const txComposer = new meta_contract_1.TxComposer();
        txComposer.appendP2PKHOutput({ address: recipientAddress, satoshis: input.amountSatoshis });
        for (const utxo of picked) {
            txComposer.appendP2PKHInput({
                address: senderAddress,
                txId: utxo.txId,
                outputIndex: utxo.outputIndex,
                satoshis: utxo.satoshis,
            });
        }
        txComposer.appendChangeOutput(senderAddress, feeRate);
        for (let i = 0; i < txComposer.tx.inputs.length; i += 1) {
            txComposer.unlockP2PKHInput(privateKey, i);
        }
        const rawTx = txComposer.getRawHex();
        // Defer pending UTXO tracking until broadcast
        deferredTrackers.set(rawTx, {
            address,
            spentUtxos: picked,
            createdUtxosFactory: (txid) => extractOwnedOutputs({
                txid,
                address,
                outputs: txComposer.tx.outputs,
            }),
        });
        const inputTotal = txComposer.tx.inputs.reduce((sum, current) => sum + (current.output?.satoshis || 0), 0);
        const outputTotal = txComposer.tx.outputs.reduce((sum, output) => sum + output.satoshis, 0);
        return { rawTx, fee: inputTotal - outputTotal };
    },
    async buildInscription(input) {
        const { privateKey, address } = buildMvcPrivateKey(input.identity.mnemonic, input.identity.path);
        const rawUtxos = await this.fetchUtxos(address);
        const usableUtxos = resolveSpendableUtxos({ address, utxos: rawUtxos });
        const addressObject = new meta_contract_1.mvc.Address(address, meta_contract_1.mvc.Networks.livenet);
        const opReturnParts = buildOpReturnParts(input.request);
        const opReturnScriptSize = getOpReturnScriptSize(opReturnParts);
        const baseTxSize = getEstimatedBaseTxSize(opReturnScriptSize);
        const txComposer = new meta_contract_1.TxComposer();
        txComposer.appendP2PKHOutput({ address: addressObject, satoshis: 1 });
        txComposer.appendOpReturnOutput(opReturnParts);
        const totalOutput = txComposer.tx.outputs.reduce((sum, output) => sum + output.satoshis, 0);
        const pickedUtxos = pickUtxos(usableUtxos, totalOutput, 1, baseTxSize);
        for (const utxo of pickedUtxos) {
            txComposer.appendP2PKHInput({
                address: addressObject,
                txId: utxo.txId,
                outputIndex: utxo.outputIndex,
                satoshis: utxo.satoshis,
            });
        }
        txComposer.appendChangeOutput(addressObject, 1);
        for (let inputIndex = 0; inputIndex < txComposer.tx.inputs.length; inputIndex += 1) {
            txComposer.unlockP2PKHInput(privateKey, inputIndex);
        }
        const rawTx = txComposer.getRawHex();
        // Defer pending UTXO tracking until broadcast
        deferredTrackers.set(rawTx, {
            address,
            spentUtxos: pickedUtxos,
            createdUtxosFactory: (txid) => extractOwnedOutputs({
                txid,
                address,
                outputs: txComposer.tx.outputs,
            }),
        });
        const inputTotal = txComposer.tx.inputs.reduce((sum, current) => sum + (current.output?.satoshis || 0), 0);
        const outputTotal = txComposer.tx.outputs.reduce((sum, output) => sum + output.satoshis, 0);
        return {
            signedRawTxs: [rawTx],
            revealIndices: [0],
            totalCost: inputTotal - outputTotal,
        };
    },
};
exports.default = exports.mvcChainAdapter;
