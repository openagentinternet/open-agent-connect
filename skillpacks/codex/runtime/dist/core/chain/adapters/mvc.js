"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mvcChainAdapter = void 0;
exports.__clearPendingMvcSpentOutpointsForTests = __clearPendingMvcSpentOutpointsForTests;
require("../../compat/nodeLocalStorage");
const meta_contract_1 = require("meta-contract");
const utxo_wallet_service_1 = require("@metalet/utxo-wallet-service");
const deriveIdentity_1 = require("../../identity/deriveIdentity");
const mvcPendingUtxos_1 = require("../mvcPendingUtxos");
const utxoBroadcastErrors_1 = require("../utxoBroadcastErrors");
const mvcFileInscriptionDraft_1 = require("../mvcFileInscriptionDraft");
const mvcSigningIdentity_1 = require("../mvcSigningIdentity");
const METALET_HOST = 'https://www.metalet.space';
const NET = 'livenet';
const P2PKH_INPUT_SIZE = 148;
const DEFAULT_MVC_FEE_RATE = 1;
const deferredTrackers = new Map();
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function __clearPendingMvcSpentOutpointsForTests() {
    (0, mvcPendingUtxos_1.__clearPendingMvcUtxosForTests)();
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
        if (json?.code !== 0) {
            const tracker = deferredTrackers.get(rawTx);
            if (tracker && (0, utxoBroadcastErrors_1.isRetryableUtxoFundingError)(json?.message)) {
                (0, mvcPendingUtxos_1.rememberPendingMvcTransaction)({
                    address: tracker.address,
                    spentUtxos: tracker.spentUtxos,
                    createdUtxos: [],
                });
                deferredTrackers.delete(rawTx);
            }
            throw new Error(json?.message || 'Broadcast failed');
        }
        const txid = json.data ?? '';
        // Complete deferred pending UTXO tracking
        const tracker = deferredTrackers.get(rawTx);
        if (tracker) {
            (0, mvcPendingUtxos_1.rememberPendingMvcTransaction)({
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
        const { privateKey, address } = (0, mvcSigningIdentity_1.buildMvcSigningIdentity)({
            mnemonic: input.mnemonic,
            path: input.path,
        });
        const rawUtxos = await this.fetchUtxos(address);
        const utxos = (0, mvcPendingUtxos_1.resolveSpendableMvcUtxos)({ address, utxos: rawUtxos });
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
            createdUtxosFactory: (txid) => (0, mvcFileInscriptionDraft_1.extractOwnedOutputsFromPreparedMvcTx)({
                txHex: rawTx,
                txId: txid,
                address,
            }),
        });
        const inputTotal = txComposer.tx.inputs.reduce((sum, current) => sum + (current.output?.satoshis || 0), 0);
        const outputTotal = txComposer.tx.outputs.reduce((sum, output) => sum + output.satoshis, 0);
        return { rawTx, fee: inputTotal - outputTotal };
    },
    async buildInscription(input) {
        const address = await this.deriveAddress(input.identity.mnemonic, input.identity.path);
        const draft = await (0, mvcFileInscriptionDraft_1.buildMvcFileInscriptionDraft)({
            identity: input.identity,
            request: input.request,
            utxos: await this.fetchUtxos(address),
            feeRate: 1,
        });
        const userInputIndexes = Array.from({ length: draft.userInputCount }, (_, index) => index);
        const { txHex: rawTx } = await (0, mvcFileInscriptionDraft_1.signMvcPreparedUserInputs)({
            identity: input.identity,
            preparedTxHex: draft.unsignedTxHex,
            userInputs: draft.userInputs,
            userInputIndexes,
        });
        // Defer pending UTXO tracking until broadcast
        deferredTrackers.set(rawTx, {
            address,
            spentUtxos: draft.selectedUtxos,
            createdUtxosFactory: (txid) => (0, mvcFileInscriptionDraft_1.extractOwnedOutputsFromPreparedMvcTx)({
                txHex: rawTx,
                txId: txid,
                address,
            }),
        });
        const tx = new meta_contract_1.mvc.Transaction(rawTx);
        const inputTotal = draft.userInputs.reduce((sum, utxo) => sum + utxo.satoshis, 0);
        const outputTotal = tx.outputs.reduce((sum, output) => sum + output.satoshis, 0);
        return {
            signedRawTxs: [rawTx],
            revealIndices: [0],
            totalCost: inputTotal - outputTotal,
        };
    },
};
exports.default = exports.mvcChainAdapter;
