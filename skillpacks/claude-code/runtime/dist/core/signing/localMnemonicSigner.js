"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeMvcTransfer = executeMvcTransfer;
exports.executeBtcTransfer = executeBtcTransfer;
exports.createLocalMnemonicSigner = createLocalMnemonicSigner;
const meta_contract_1 = require("meta-contract");
const utxo_wallet_service_1 = require("@metalet/utxo-wallet-service");
const deriveIdentity_1 = require("../identity/deriveIdentity");
const loadIdentity_1 = require("../identity/loadIdentity");
const writePin_1 = require("../chain/writePin");
const METALET_HOST = 'https://www.metalet.space';
const MEMPOOL_HOST = 'https://mempool.space';
const NET = 'livenet';
const P2PKH_INPUT_SIZE = 148;
const DEFAULT_BTC_WRITE_FEE_RATE = 2;
const DEFAULT_METALET_TIMEOUT_MS = 1_500;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
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
function resolveTimeoutMs(timeoutMs) {
    return Number.isFinite(timeoutMs) && Number(timeoutMs) > 0
        ? Math.floor(Number(timeoutMs))
        : DEFAULT_METALET_TIMEOUT_MS;
}
async function fetchWithTimeout(url, init = {}, timeoutMs) {
    const controller = new AbortController();
    const resolvedTimeoutMs = resolveTimeoutMs(timeoutMs);
    const timeout = setTimeout(() => controller.abort(), resolvedTimeoutMs);
    try {
        return await fetch(url, {
            ...init,
            signal: controller.signal,
        });
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
async function fetchMvcUtxos(address) {
    const all = [];
    let flag;
    while (true) {
        const params = new URLSearchParams({ address, net: NET, ...(flag ? { flag } : {}) });
        const response = await fetch(`${METALET_HOST}/wallet-api/v4/mvc/address/utxo-list?${params}`);
        const json = await response.json();
        const list = json?.data?.list ?? [];
        if (!list.length) {
            break;
        }
        all.push(...list.filter((utxo) => utxo.value >= 600));
        flag = list[list.length - 1]?.flag;
        if (!flag) {
            break;
        }
    }
    return all;
}
async function broadcastMvcTx(rawTx) {
    const response = await fetch(`${METALET_HOST}/wallet-api/v3/tx/broadcast`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            chain: 'mvc',
            net: NET,
            rawTx,
        }),
    });
    const json = await response.json();
    if (json?.code !== 0) {
        throw new Error(json?.message || 'Broadcast failed');
    }
    return json.data ?? '';
}
function normalizeBtcUtxos(input) {
    const normalized = input.list.map((utxo) => ({
        txId: normalizeText(utxo.txId ?? utxo.txid),
        outputIndex: Number.isInteger(utxo.outputIndex) ? Number(utxo.outputIndex) : Number(utxo.vout),
        satoshis: Number(utxo.satoshis ?? utxo.value ?? 0),
        address: normalizeText(utxo.address) || input.address,
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
    return confirmed.length > 0 ? confirmed : normalized;
}
async function fetchBtcRawTxHex(txId, options = {}) {
    if (!options.preferMempool) {
        try {
            const params = new URLSearchParams({
                txId,
                chain: 'btc',
                net: NET,
            });
            const response = await fetchWithTimeout(`${METALET_HOST}/wallet-api/v3/tx/raw?${params}`, {}, options.timeoutMs);
            const json = await response.json();
            if (json?.code !== 0) {
                throw new Error(json?.message || 'Metalet BTC raw tx query failed.');
            }
            const rawTx = normalizeText(json?.data?.rawTx ?? json?.data?.hex);
            if (!rawTx) {
                throw new Error(`Metalet BTC raw tx response is empty for ${txId}.`);
            }
            return rawTx;
        }
        catch (error) {
            if (!isRetryableBtcProviderError(error)) {
                throw error;
            }
        }
    }
    const rawTx = normalizeText(await mempoolGetText(`/tx/${txId}/hex`));
    if (!rawTx) {
        throw new Error(`Mempool BTC raw tx response is empty for ${txId}.`);
    }
    return rawTx;
}
async function fetchBtcUtxos(address, needRawTx) {
    let preferMempool = false;
    let utxos;
    try {
        const params = new URLSearchParams({
            address,
            unconfirmed: '1',
            net: NET,
        });
        const response = await fetchWithTimeout(`${METALET_HOST}/wallet-api/v3/address/btc-utxo?${params}`);
        const json = await response.json();
        if (json?.code !== 0) {
            throw new Error(json?.message || 'Metalet BTC UTXO query failed.');
        }
        utxos = normalizeBtcUtxos({
            list: json?.data ?? [],
            address,
        });
    }
    catch (error) {
        if (!isRetryableBtcProviderError(error)) {
            throw error;
        }
        preferMempool = true;
        const mempoolUtxos = await mempoolGetJson(`/address/${address}/utxo`);
        utxos = normalizeBtcUtxos({
            list: mempoolUtxos,
            address,
        });
    }
    if (!needRawTx) {
        return utxos;
    }
    const withRawTx = [];
    for (const utxo of utxos) {
        withRawTx.push({
            ...utxo,
            rawTx: await fetchBtcRawTxHex(utxo.txId, { preferMempool }),
        });
    }
    return withRawTx;
}
async function broadcastBtcTx(rawTx) {
    const response = await fetch(`${METALET_HOST}/wallet-api/v3/tx/broadcast`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            chain: 'btc',
            net: NET,
            rawTx,
        }),
    });
    const json = await response.json();
    if (json?.code !== 0) {
        throw new Error(json?.message || 'BTC broadcast failed');
    }
    const txid = normalizeText(json.data);
    if (!txid) {
        throw new Error('BTC broadcast returned an empty txid.');
    }
    return txid;
}
function buildMvcOpReturnParts(input) {
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
function getEstimatedTxSizeWithoutInputs(opReturnScriptSize) {
    return 4 + 1 + 1 + 43 + (9 + opReturnScriptSize) + 4;
}
function pickMvcUtxos(utxos, totalOutput, feeRate, estimatedTxSizeWithoutInputs) {
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
        if (current >= requiredAmount) {
            return picked;
        }
    }
    throw new Error('MetaBot balance is insufficient for this chain write.');
}
async function loadSignerIdentity(secretStore) {
    const secrets = await secretStore.readIdentitySecrets();
    if (!secrets?.mnemonic) {
        throw new Error('Local identity mnemonic is missing from the secret store.');
    }
    return (0, loadIdentity_1.loadIdentity)(secrets);
}
async function buildPrivateChatIdentity(secretStore) {
    const secrets = await secretStore.readIdentitySecrets();
    if (!secrets?.mnemonic) {
        throw new Error('Local identity mnemonic is missing from the secret store.');
    }
    const identity = await (0, loadIdentity_1.loadIdentity)(secrets);
    const privateKeyHex = normalizeText(secrets.privateKeyHex) || await (0, deriveIdentity_1.derivePrivateKeyHex)({
        mnemonic: identity.mnemonic,
        path: identity.path,
    });
    if (!privateKeyHex) {
        throw new Error('Local private key could not be derived from the secret store.');
    }
    return {
        globalMetaId: identity.globalMetaId,
        chatPublicKey: identity.chatPublicKey,
        privateKeyHex,
    };
}
function buildMvcPrivateKey(mnemonic, path) {
    const network = meta_contract_1.mvc.Networks.livenet;
    const addressIndex = (0, deriveIdentity_1.parseAddressIndexFromPath)(path);
    const mnemonicObject = meta_contract_1.mvc.Mnemonic.fromString(mnemonic);
    const hdPrivateKey = mnemonicObject.toHDPrivateKey('', network);
    const childPrivateKey = hdPrivateKey.deriveChild(`m/44'/10001'/0'/0/${addressIndex}`);
    const address = childPrivateKey.publicKey.toAddress(network).toString();
    return {
        privateKey: childPrivateKey.privateKey,
        address,
    };
}
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
async function runDefaultBtcCreatePin(input) {
    const wallet = buildBtcWallet(input.identity.mnemonic, input.identity.path);
    const address = wallet.getAddress();
    const scriptType = wallet.getScriptType?.() ?? 'P2PKH';
    const needRawTx = scriptType === 'P2PKH';
    const utxos = await input.btcTransport.fetchUtxos(address, needRawTx);
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
        feeRate: input.feeRate,
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
    if (!commitTx?.rawTx) {
        throw new Error('BTC signTx returned no commit transaction.');
    }
    await input.btcTransport.broadcastTx(commitTx.rawTx);
    const txids = [];
    const revealTxs = Array.isArray(signResult.revealTxs) ? signResult.revealTxs : [];
    let totalCost = Number(commitTx.fee ?? 0);
    for (const revealTx of revealTxs) {
        const rawTx = normalizeText(revealTx?.rawTx);
        if (!rawTx) {
            throw new Error('BTC signTx returned an empty reveal transaction.');
        }
        txids.push(await input.btcTransport.broadcastTx(rawTx));
        totalCost += Number(revealTx?.fee ?? 0);
    }
    if (!txids.length) {
        throw new Error('BTC inscription produced no reveal transaction.');
    }
    return {
        txids,
        pinId: `${txids[0]}i0`,
        totalCost: Number.isFinite(totalCost) ? totalCost : 0,
    };
}
async function executeMvcTransfer(input) {
    const feeRate = Number.isFinite(input.feeRate) && Number(input.feeRate) > 0 ? input.feeRate : 1;
    const { privateKey, address } = buildMvcPrivateKey(input.mnemonic, input.path);
    const rawUtxos = await fetchMvcUtxos(address);
    const utxos = rawUtxos.map((utxo) => ({
        txId: utxo.txid,
        outputIndex: utxo.outIndex,
        satoshis: utxo.value,
        address,
        height: utxo.height,
    }));
    const SIMPLE_P2PKH_TX_BASE_SIZE = 96;
    const picked = pickMvcUtxos(utxos, input.amountSatoshis, feeRate, SIMPLE_P2PKH_TX_BASE_SIZE);
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
    const txid = await broadcastMvcTx(txComposer.getRawHex());
    return { txid };
}
async function executeBtcTransfer(input) {
    const feeRate = Number.isFinite(input.feeRate) && Number(input.feeRate) > 0 ? input.feeRate : DEFAULT_BTC_WRITE_FEE_RATE;
    const wallet = buildBtcWallet(input.mnemonic, input.path);
    const address = wallet.getAddress();
    const scriptType = wallet.getScriptType?.() ?? 'P2PKH';
    const needRawTx = scriptType === 'P2PKH';
    const utxos = await fetchBtcUtxos(address, needRawTx);
    const signResult = wallet.signTx(utxo_wallet_service_1.SignType.SEND, {
        utxos: utxos.map((utxo) => ({
            txId: utxo.txId,
            outputIndex: utxo.outputIndex,
            satoshis: utxo.satoshis,
            address: utxo.address,
            rawTx: utxo.rawTx,
            confirmed: utxo.confirmed,
        })),
        toInfo: {
            address: input.toAddress,
            satoshis: input.amountSatoshis,
        },
        feeRate,
    });
    const rawTx = normalizeText(signResult?.rawTx);
    if (!rawTx) {
        throw new Error('BTC signTx(SEND) returned no raw transaction.');
    }
    const txid = await broadcastBtcTx(rawTx);
    return { txid };
}
function createLocalMnemonicSigner(input) {
    const mvcTransport = input.mvcTransport ?? {
        fetchUtxos: fetchMvcUtxos,
        broadcastTx: broadcastMvcTx,
    };
    const btcTransport = input.btcTransport ?? {
        fetchUtxos: fetchBtcUtxos,
        broadcastTx: broadcastBtcTx,
    };
    const btcFeeRate = Number.isFinite(input.btcFeeRate) && Number(input.btcFeeRate) > 0
        ? Math.floor(Number(input.btcFeeRate))
        : DEFAULT_BTC_WRITE_FEE_RATE;
    return {
        getIdentity: async () => loadSignerIdentity(input.secretStore),
        getPrivateChatIdentity: async () => buildPrivateChatIdentity(input.secretStore),
        writePin: async (rawInput) => {
            const request = (0, writePin_1.normalizeChainWriteRequest)(rawInput);
            const identity = await loadSignerIdentity(input.secretStore);
            if (request.network === 'btc') {
                const btcWrite = input.btcCreatePin ?? (async (btcInput) => (runDefaultBtcCreatePin({
                    request: btcInput.request,
                    identity: btcInput.identity,
                    btcTransport,
                    feeRate: btcFeeRate,
                })));
                const result = await btcWrite({
                    request,
                    identity,
                });
                return {
                    txids: result.txids,
                    pinId: result.pinId,
                    totalCost: result.totalCost,
                    network: request.network,
                    operation: request.operation,
                    path: request.path,
                    contentType: request.contentType,
                    encoding: request.encoding,
                    globalMetaId: identity.globalMetaId,
                    mvcAddress: identity.mvcAddress,
                };
            }
            if (request.network !== 'mvc') {
                throw new Error(`Chain write network ${request.network} is not supported yet.`);
            }
            const { privateKey, address } = buildMvcPrivateKey(identity.mnemonic, identity.path);
            const utxos = await mvcTransport.fetchUtxos(address);
            const usableUtxos = utxos.map((utxo) => ({
                txId: utxo.txid,
                outputIndex: utxo.outIndex,
                satoshis: utxo.value,
                address,
                height: utxo.height,
            }));
            const addressObject = new meta_contract_1.mvc.Address(address, meta_contract_1.mvc.Networks.livenet);
            const opReturnParts = buildMvcOpReturnParts(request);
            const opReturnScriptSize = getOpReturnScriptSize(opReturnParts);
            const estimatedTxSizeWithoutInputs = getEstimatedTxSizeWithoutInputs(opReturnScriptSize);
            const txComposer = new meta_contract_1.TxComposer();
            txComposer.appendP2PKHOutput({
                address: addressObject,
                satoshis: 1,
            });
            txComposer.appendOpReturnOutput(opReturnParts);
            const totalOutput = txComposer.tx.outputs.reduce((sum, output) => sum + output.satoshis, 0);
            const pickedUtxos = pickMvcUtxos(usableUtxos, totalOutput, 1, estimatedTxSizeWithoutInputs);
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
            const txid = await mvcTransport.broadcastTx(rawTx);
            const inputTotal = txComposer.tx.inputs.reduce((sum, current) => sum + (current.output?.satoshis || 0), 0);
            const outputTotal = txComposer.tx.outputs.reduce((sum, output) => sum + output.satoshis, 0);
            return {
                txids: [txid],
                pinId: `${txid}i0`,
                totalCost: inputTotal - outputTotal,
                network: request.network,
                operation: request.operation,
                path: request.path,
                contentType: request.contentType,
                encoding: request.encoding,
                globalMetaId: identity.globalMetaId,
                mvcAddress: identity.mvcAddress,
            };
        },
    };
}
