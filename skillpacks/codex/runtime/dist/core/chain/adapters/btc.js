"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.btcChainAdapter = void 0;
const utxo_wallet_service_1 = require("@metalet/utxo-wallet-service");
const deriveIdentity_1 = require("../../identity/deriveIdentity");
const METALET_HOST = 'https://www.metalet.space';
const MEMPOOL_HOST = 'https://mempool.space';
const NET = 'livenet';
const DEFAULT_BTC_FEE_RATE = 2;
const DEFAULT_TIMEOUT_MS = 1_500;
// ---- helpers ----
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function toFiniteNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
}
function getErrorMessage(error) {
    if (error != null && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
        return error.message;
    }
    return String(error ?? '');
}
function isRetryableBtcProviderError(error) {
    const normalized = getErrorMessage(error).toLowerCase();
    return (normalized.includes('higun request error')
        || normalized.includes('rpc error')
        || normalized.includes('timeout')
        || normalized.includes('timed out')
        || normalized.includes('fetch failed')
        || normalized.includes('failed to fetch')
        || normalized.includes('network error')
        || normalized.includes('networkerror'));
}
async function fetchWithTimeout(url, init = {}, timeoutMs) {
    const controller = new AbortController();
    const resolvedTimeoutMs = Number.isFinite(timeoutMs) && Number(timeoutMs) > 0
        ? Math.floor(Number(timeoutMs)) : DEFAULT_TIMEOUT_MS;
    const timeout = setTimeout(() => controller.abort(), resolvedTimeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    }
    catch (error) {
        if (controller.signal.aborted) {
            throw new Error(`request timeout after ${resolvedTimeoutMs}ms`);
        }
        throw error;
    }
    finally {
        clearTimeout(timeout);
    }
}
async function mempoolGetJson(path) {
    const response = await fetch(`${MEMPOOL_HOST}/api${path}`);
    if ('ok' in response && response.ok === false) {
        throw new Error(`mempool request failed (${response.status})`);
    }
    return await response.json();
}
async function mempoolGetText(path) {
    const response = await fetch(`${MEMPOOL_HOST}/api${path}`);
    if ('ok' in response && response.ok === false) {
        throw new Error(`mempool request failed (${response.status})`);
    }
    return await response.text();
}
// ---- wallet ----
function buildBtcWallet(mnemonic, path) {
    const addressIndex = (0, deriveIdentity_1.parseAddressIndexFromPath)(path);
    return new utxo_wallet_service_1.BtcWallet({
        mnemonic,
        network: NET,
        addressIndex,
        addressType: utxo_wallet_service_1.AddressType.SameAsMvc,
        coinType: utxo_wallet_service_1.CoinType.MVC,
    });
}
// ---- raw tx fetch ----
async function fetchBtcRawTxHex(txId, options = {}) {
    if (!options.preferMempool) {
        try {
            const params = new URLSearchParams({ txId, chain: 'btc', net: NET });
            const response = await fetchWithTimeout(`${METALET_HOST}/wallet-api/v3/tx/raw?${params}`, {}, options.timeoutMs);
            const json = await response.json();
            if (json?.code !== 0) {
                throw new Error(json?.message || 'Metalet BTC raw tx query failed.');
            }
            const rawTx = normalizeText(json?.data?.rawTx ?? json?.data?.hex);
            if (!rawTx)
                throw new Error(`Metalet BTC raw tx response is empty for ${txId}.`);
            return rawTx;
        }
        catch (error) {
            if (!isRetryableBtcProviderError(error))
                throw error;
        }
    }
    const rawTx = normalizeText(await mempoolGetText(`/tx/${txId}/hex`));
    if (!rawTx)
        throw new Error(`Mempool BTC raw tx response is empty for ${txId}.`);
    return rawTx;
}
// ---- UTXO normalization ----
function normalizeBtcUtxos(input) {
    const normalized = input.list.map((utxo) => ({
        txId: normalizeText(utxo.txId ?? utxo.txid),
        outputIndex: Number.isInteger(utxo.outputIndex) ? Number(utxo.outputIndex) : Number(utxo.vout),
        satoshis: Number(utxo.satoshis ?? utxo.value ?? 0),
        address: normalizeText(utxo.address) || input.address,
        height: Number(utxo.height ?? 0),
        confirmed: typeof utxo.confirmed === 'boolean'
            ? utxo.confirmed
            : typeof utxo.status?.confirmed === 'boolean'
                ? utxo.status.confirmed
                : undefined,
    })).filter((utxo) => (/^[0-9a-f]{64}$/i.test(utxo.txId)
        && Number.isInteger(utxo.outputIndex)
        && utxo.outputIndex >= 0
        && Number.isFinite(utxo.satoshis)
        && utxo.satoshis >= 600));
    const confirmed = normalized.filter((utxo) => utxo.confirmed !== false);
    const unconfirmed = normalized.filter((utxo) => utxo.confirmed === false);
    return [...confirmed, ...unconfirmed];
}
// ---- BTC ChainAdapter ----
exports.btcChainAdapter = {
    network: 'btc',
    explorerBaseUrl: 'https://mempool.space',
    feeRateUnit: 'sat/byte',
    minTransferSatoshis: 546,
    async deriveAddress(mnemonic, path) {
        const wallet = buildBtcWallet(mnemonic, path);
        return wallet.getAddress();
    },
    async fetchUtxos(address) {
        let preferMempool = false;
        let utxos;
        try {
            const params = new URLSearchParams({ address, unconfirmed: '1', net: NET });
            const response = await fetchWithTimeout(`${METALET_HOST}/wallet-api/v3/address/btc-utxo?${params}`);
            const json = await response.json();
            if (json?.code !== 0)
                throw new Error(json?.message || 'Metalet BTC UTXO query failed.');
            utxos = normalizeBtcUtxos({ list: json?.data ?? [], address });
        }
        catch (error) {
            if (!isRetryableBtcProviderError(error))
                throw error;
            preferMempool = true;
            const mempoolUtxos = await mempoolGetJson(`/address/${address}/utxo`);
            utxos = normalizeBtcUtxos({ list: mempoolUtxos, address });
        }
        // Attach rawTx for P2PKH inputs (needed for signing)
        const scriptType = buildBtcWallet('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', "m/44'/10001'/0'/0/0").getScriptType?.() ?? 'P2PKH';
        const needRawTx = scriptType === 'P2PKH';
        if (!needRawTx)
            return utxos;
        const withRawTx = [];
        for (const utxo of utxos) {
            withRawTx.push({
                ...utxo,
                rawTx: await fetchBtcRawTxHex(utxo.txId, { preferMempool }),
            });
        }
        return withRawTx;
    },
    async fetchBalance(address) {
        const params = new URLSearchParams({ address, net: NET });
        const response = await fetch(`${METALET_HOST}/wallet-api/v3/address/btc-balance?${params}`);
        const json = await response.json();
        const data = json?.code === 0 ? (json.data ?? {}) : {};
        const totalBtc = Math.max(0, toFiniteNumber(data.balance));
        const confirmedBtc = Math.max(0, toFiniteNumber(data.safeBalance ?? data.balance));
        const unconfirmedBtc = toFiniteNumber(data.pendingBalance);
        return {
            chain: 'btc',
            address,
            totalSatoshis: Math.round(totalBtc * 1e8),
            confirmedSatoshis: Math.round(confirmedBtc * 1e8),
            unconfirmedSatoshis: Math.round(unconfirmedBtc * 1e8),
            utxoCount: 0,
        };
    },
    async fetchFeeRate() {
        try {
            const url = `${METALET_HOST}/wallet-api/v3/btc/fee/summary?net=${NET}`;
            const response = await fetch(url);
            const json = await response.json();
            if (json?.code !== 0)
                return DEFAULT_BTC_FEE_RATE;
            const list = json?.data?.list ?? [];
            const avg = list.find((t) => /avg/i.test(String(t?.title ?? '')));
            const rate = toFiniteNumber(avg?.feeRate ?? list[0]?.feeRate);
            return rate > 0 ? rate : DEFAULT_BTC_FEE_RATE;
        }
        catch {
            return DEFAULT_BTC_FEE_RATE;
        }
    },
    async fetchRawTx(txid) {
        return fetchBtcRawTxHex(txid);
    },
    async broadcastTx(rawTx) {
        const response = await fetch(`${METALET_HOST}/wallet-api/v3/tx/broadcast`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ chain: 'btc', net: NET, rawTx }),
        });
        const json = await response.json();
        if (json?.code !== 0)
            throw new Error(json?.message || 'BTC broadcast failed');
        const txid = normalizeText(json.data);
        if (!txid)
            throw new Error('BTC broadcast returned an empty txid.');
        return txid;
    },
    async buildTransfer(input) {
        const feeRate = Number.isFinite(input.feeRate) && Number(input.feeRate) > 0
            ? input.feeRate : DEFAULT_BTC_FEE_RATE;
        const wallet = buildBtcWallet(input.mnemonic, input.path);
        const address = wallet.getAddress();
        const scriptType = wallet.getScriptType?.() ?? 'P2PKH';
        const needRawTx = scriptType === 'P2PKH';
        let utxos = await this.fetchUtxos(address);
        if (needRawTx && !utxos.every((u) => u.rawTx)) {
            // fetchUtxos attaches rawTx when needed, but let's ensure
            utxos = utxos.filter((u) => u.rawTx);
        }
        const signResult = wallet.signTx(utxo_wallet_service_1.SignType.SEND, {
            utxos: utxos.map((utxo) => ({
                txId: utxo.txId,
                outputIndex: utxo.outputIndex,
                satoshis: utxo.satoshis,
                address: utxo.address,
                rawTx: utxo.rawTx,
                confirmed: utxo.confirmed,
            })),
            outputs: [{
                    address: input.toAddress,
                    satoshis: input.amountSatoshis,
                }],
            feeRate,
            changeAddress: address,
        });
        const rawTx = normalizeText(signResult?.rawTx);
        if (!rawTx)
            throw new Error('BTC signTx(SEND) returned no raw transaction.');
        return { rawTx, fee: Number(signResult.fee ?? 0) };
    },
    async buildInscription(input) {
        const feeRate = Number.isFinite(input.feeRate) && Number(input.feeRate) > 0
            ? input.feeRate : DEFAULT_BTC_FEE_RATE;
        const wallet = buildBtcWallet(input.identity.mnemonic, input.identity.path);
        const address = wallet.getAddress();
        const scriptType = wallet.getScriptType?.() ?? 'P2PKH';
        const needRawTx = scriptType === 'P2PKH';
        let utxos = await this.fetchUtxos(address);
        if (needRawTx) {
            utxos = utxos.filter((u) => u.rawTx);
        }
        if (!utxos.length) {
            throw new Error('MetaBot BTC balance is insufficient for this chain write.');
        }
        const payloadBody = input.request.encoding === 'base64'
            ? Buffer.from(input.request.payload, 'base64').toString('utf-8')
            : input.request.payload;
        const signResult = wallet.signTx(utxo_wallet_service_1.SignType.INSCRIBE_METAIDPIN, {
            utxos: utxos.map((utxo) => ({
                txId: utxo.txId,
                outputIndex: utxo.outputIndex,
                satoshis: utxo.satoshis,
                address: utxo.address,
                rawTx: utxo.rawTx,
                confirmed: utxo.confirmed,
            })),
            feeRate,
            metaidDataList: [{
                    operation: input.request.operation,
                    path: input.request.path,
                    contentType: input.request.contentType,
                    encryption: input.request.encryption,
                    version: input.request.version,
                    body: payloadBody,
                    revealAddr: address,
                }],
        });
        const commitTx = signResult.commitTx;
        if (!commitTx?.rawTx)
            throw new Error('BTC signTx returned no commit transaction.');
        const revealTxs = Array.isArray(signResult.revealTxs) ? signResult.revealTxs : [];
        const firstReveal = revealTxs[0];
        if (!firstReveal?.rawTx)
            throw new Error('BTC inscription produced no reveal transaction.');
        let totalCost = Number(commitTx.fee ?? 0);
        // Build signedRawTxs: [commit, ...reveals]
        const signedRawTxs = [commitTx.rawTx];
        const revealIndices = [];
        for (const reveal of revealTxs) {
            const rawTx = normalizeText(reveal?.rawTx);
            if (!rawTx)
                throw new Error('BTC signTx returned an empty reveal transaction.');
            revealIndices.push(signedRawTxs.length);
            signedRawTxs.push(rawTx);
            totalCost += Number(reveal?.fee ?? 0);
        }
        return {
            signedRawTxs,
            revealIndices,
            totalCost: Number.isFinite(totalCost) ? totalCost : 0,
        };
    },
};
exports.default = exports.btcChainAdapter;
