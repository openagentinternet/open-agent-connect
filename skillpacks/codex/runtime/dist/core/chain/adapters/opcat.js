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
exports.opcatChainAdapter = void 0;
const bitcoin = __importStar(require("bitcoinjs-lib"));
const OPCAT_WALLET_API = 'https://wallet-api.opcatlabs.io';
const OPCAT_DUST_LIMIT = 1;
const DEFAULT_OPCAT_FEE_RATE = 0.001;
// ---- helpers ----
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function toFiniteNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
}
async function opcatV5Get(path) {
    const url = `${OPCAT_WALLET_API}/v5${path}`;
    const response = await fetch(url);
    const json = await response.json();
    if (json?.code !== 0) {
        throw new Error(json?.msg || 'OPCAT API error');
    }
    return json.data;
}
async function opcatBroadcastTx(rawTx) {
    const response = await fetch(`${OPCAT_WALLET_API}/v5/tx/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawtx: rawTx }),
    });
    const text = await response.text();
    // Try JSON first (v5 API returns { code, data, msg } on success, or { code, msg } on error)
    try {
        const json = JSON.parse(text);
        if (json?.code !== 0 && json?.code != null) {
            throw new Error(json?.msg || 'OPCAT broadcast failed');
        }
        const txid = normalizeText(json?.data ?? json?.msg ?? '');
        if (txid && txid.length >= 10)
            return txid;
        // If code is 0 but no txid in data/msg, fall through to compute from rawTx
    }
    catch (err) {
        if (err instanceof SyntaxError) {
            // Not JSON — could be a plain-string txid
            const txid = normalizeText(text);
            if (txid && txid.length >= 10)
                return txid;
        }
        else {
            throw err; // Re-throw API errors
        }
    }
    // Fallback: compute txid from rawTx using double-SHA256
    const hash = await computeOpcatTxId(rawTx);
    if (hash && hash.length >= 10)
        return hash;
    throw new Error('OPCAT broadcast returned an invalid txid.');
}
async function computeOpcatTxId(rawTx) {
    const opcat = await getOpcatLib();
    try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        const tx = opcat.Transaction.fromString(rawTx);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
        return tx.hash;
    }
    catch {
        return '';
    }
}
// ---- key derivation (uses OPCAT's Mnemonic + HDPrivateKey for correct address generation) ----
async function deriveOpcatPrivateKey(mnemonic, path) {
    const opcat = await getOpcatLib();
    // OPCAT Mnemonic handles BIP39 seed generation internally
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    const mnemonicObj = new opcat.Mnemonic(mnemonic);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const hdPriv = mnemonicObj.toHDPrivateKey();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const derived = hdPriv.deriveChild(path);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const pk = derived.privateKey;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const address = pk.toAddress().toString();
    if (!address) {
        throw new Error('OPCAT address derivation failed.');
    }
    return { privateKey: pk, address };
}
// ---- BIP62 push-data encoding (for MetaID inscription payloads) ----
function pushData(data) {
    const len = data.length;
    if (len === 0) {
        return Buffer.from([bitcoin.opcodes.OP_0]);
    }
    if (len < 76) {
        return Buffer.concat([Buffer.from([len]), data]);
    }
    if (len <= 0xff) {
        return Buffer.concat([Buffer.from([bitcoin.opcodes.OP_PUSHDATA1, len]), data]);
    }
    if (len <= 0xffff) {
        const lenBuf = Buffer.alloc(2);
        lenBuf.writeUInt16LE(len);
        return Buffer.concat([Buffer.from([bitcoin.opcodes.OP_PUSHDATA2]), lenBuf, data]);
    }
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32LE(len);
    return Buffer.concat([Buffer.from([bitcoin.opcodes.OP_PUSHDATA4]), lenBuf, data]);
}
// ---- Inscription payload builder ----
const MAX_CHUNK_LEN = 240;
function buildMetaIdInscriptionPayload(request) {
    const bodyParts = [];
    for (let i = 0; i < request.body.length; i += MAX_CHUNK_LEN) {
        bodyParts.push(request.body.slice(i, Math.min(i + MAX_CHUNK_LEN, request.body.length)));
    }
    if (bodyParts.length === 0)
        bodyParts.push(Buffer.alloc(0));
    const chunks = [];
    chunks.push(pushData(Buffer.from('metaid')));
    chunks.push(pushData(Buffer.from(request.operation)));
    chunks.push(pushData(Buffer.from(request.path || '')));
    chunks.push(pushData(Buffer.from(request.encryption || '0')));
    chunks.push(pushData(Buffer.from(request.version || '0.0.1')));
    chunks.push(pushData(Buffer.from(request.contentType || 'text/plain')));
    for (const part of bodyParts)
        chunks.push(pushData(part));
    return Buffer.concat(chunks);
}
// ---- Fee rate and UTXO selection (sat/byte) ----
function estimateTxSize(p2pkhInputCount, outputCount) {
    let size = 10; // version + locktime + varints
    size += p2pkhInputCount * 148; // each P2PKH input ~148 bytes
    size += outputCount * 34; // each P2PKH output ~34 bytes
    return size;
}
function selectUtxos(availableUtxos, targetAmount, feeRate, // sat/byte
outputCount) {
    const selectedUtxos = [];
    let totalInput = 0;
    const sortedUtxos = [...availableUtxos].sort((a, b) => b.satoshis - a.satoshis);
    for (const utxo of sortedUtxos) {
        selectedUtxos.push(utxo);
        totalInput += utxo.satoshis;
        const txSize = estimateTxSize(selectedUtxos.length, outputCount);
        const fee = Math.ceil(txSize * feeRate); // sat/byte: multiply directly
        if (totalInput >= targetAmount + fee) {
            return { selectedUtxos, fee, totalInput };
        }
    }
    throw new Error(`Insufficient funds: need ${targetAmount}, have ${totalInput}`);
}
async function fetchOpcatUtxos(address) {
    const data = await opcatV5Get(`/address/btc-utxo?address=${encodeURIComponent(address)}`);
    const list = Array.isArray(data) ? data : [];
    const utxos = list
        .filter((item) => toFiniteNumber(item.satoshis) >= OPCAT_DUST_LIMIT)
        .map((item) => ({
        txId: normalizeText(item.txid),
        outputIndex: Number(item.vout),
        satoshis: toFiniteNumber(item.satoshis),
        address,
        height: Number(item.height ?? 0),
        scriptPk: normalizeText(item.scriptPk),
    }));
    const confirmed = utxos.filter((u) => u.height > 0);
    const unconfirmed = utxos.filter((u) => u.height <= 0);
    return [...confirmed, ...unconfirmed];
}
let _opcatLib = null;
async function getOpcatLib() {
    if (!_opcatLib) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        _opcatLib = await Promise.resolve().then(() => __importStar(require('@opcat-labs/scrypt-ts-opcat')));
    }
    return _opcatLib;
}
exports.opcatChainAdapter = {
    network: 'opcat',
    explorerBaseUrl: 'https://mempool.opcatlabs.io',
    feeRateUnit: 'sat/byte',
    minTransferSatoshis: OPCAT_DUST_LIMIT,
    async deriveAddress(mnemonic, path) {
        const { address } = await deriveOpcatPrivateKey(mnemonic, path);
        return address;
    },
    async fetchUtxos(address) {
        const utxos = await fetchOpcatUtxos(address);
        // Strip scriptPk from public API — it's internal-only for signing
        return utxos.map(({ scriptPk: _s, ...rest }) => rest);
    },
    async fetchBalance(address) {
        try {
            const data = await opcatV5Get(`/address/balance2?address=${encodeURIComponent(address)}`);
            const available = toFiniteNumber(data?.availableBalance);
            const total = toFiniteNumber(data?.totalBalance);
            // Fetch UTXOs to compute accurate utxoCount (balance2 API does not return UTXO count)
            let utxoCount = 0;
            try {
                const utxos = await fetchOpcatUtxos(address);
                utxoCount = utxos.length;
            }
            catch {
                // utxoCount stays 0 if UTXO fetch fails
            }
            return {
                chain: 'opcat',
                address,
                totalSatoshis: total,
                confirmedSatoshis: available,
                unconfirmedSatoshis: total - available,
                utxoCount,
            };
        }
        catch {
            // Fallback: compute from UTXOs
            const utxos = await fetchOpcatUtxos(address);
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
                chain: 'opcat',
                address,
                totalSatoshis,
                confirmedSatoshis,
                unconfirmedSatoshis,
                utxoCount: utxos.length,
            };
        }
    },
    async fetchFeeRate() {
        try {
            const data = await opcatV5Get('/default/fee-summary');
            const list = data?.list ?? [];
            // Prefer "Fastest" tier
            const fastest = list.find((t) => t.title === 'Fastest');
            if (fastest && toFiniteNumber(fastest.feeRate) > 0) {
                return toFiniteNumber(fastest.feeRate);
            }
            // Fall back to first item
            const firstRate = toFiniteNumber(list[0]?.feeRate);
            return firstRate > 0 ? firstRate : DEFAULT_OPCAT_FEE_RATE;
        }
        catch {
            return DEFAULT_OPCAT_FEE_RATE;
        }
    },
    async fetchRawTx(txid) {
        const response = await fetch(`https://openapi.opcatlabs.io/api/v1/tx/${encodeURIComponent(txid)}/raw`);
        const json = await response.json();
        if (json?.code !== 0) {
            throw new Error(json?.msg || `OPCAT raw tx fetch failed for ${txid}`);
        }
        const rawTx = normalizeText(json?.data);
        if (!rawTx) {
            throw new Error(`OPCAT raw tx response is empty for ${txid}.`);
        }
        return rawTx;
    },
    async broadcastTx(rawTx) {
        return opcatBroadcastTx(rawTx);
    },
    async buildTransfer(input) {
        const feeRate = Number.isFinite(input.feeRate) && Number(input.feeRate) > 0
            ? input.feeRate : await this.fetchFeeRate();
        const opcat = await getOpcatLib();
        // 1. Derive private key
        const { privateKey, address } = await deriveOpcatPrivateKey(input.mnemonic, input.path);
        console.error('[OPCAT buildTransfer] derived address:', address);
        console.error('[OPCAT buildTransfer] feeRate:', feeRate, 'sat/byte');
        console.error('[OPCAT buildTransfer] amountSatoshis:', input.amountSatoshis);
        // 2. Fetch UTXOs with scriptPk
        const utxos = await fetchOpcatUtxos(address);
        if (!utxos.length) {
            throw new Error('MetaBot OPCAT balance is insufficient for this transfer.');
        }
        if (input.amountSatoshis < OPCAT_DUST_LIMIT) {
            throw new Error(`OPCAT transfer amount must be at least ${OPCAT_DUST_LIMIT} satoshi.`);
        }
        // 3. Select UTXOs
        const outputCount = 2; // recipient + change
        const { selectedUtxos, fee } = selectUtxos(utxos, input.amountSatoshis, feeRate, outputCount);
        console.error('[OPCAT buildTransfer] selected', selectedUtxos.length, 'UTXOs, fee:', fee, 'satoshis');
        // 4. Build OPCAT Transaction (uses OPCAT-specific SIGHASH internally)
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
        const tx = new opcat.Transaction();
        // Add UTXO inputs
        for (const utxo of selectedUtxos) {
            const utxoWithScript = utxo;
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            tx.addInput(new opcat.Transaction.Input.PublicKeyHash({
                prevTxId: utxo.txId,
                outputIndex: utxo.outputIndex,
                script: opcat.Script.empty(),
                output: new opcat.Transaction.Output({
                    script: opcat.Script.fromHex(utxoWithScript.scriptPk),
                    satoshis: utxo.satoshis,
                }),
            }));
            console.error(`[OPCAT buildTransfer]   addInput txid=${utxo.txId} vout=${utxo.outputIndex} satoshis=${utxo.satoshis}`);
        }
        // Add recipient output
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        tx.to(input.toAddress, input.amountSatoshis);
        console.error('[OPCAT buildTransfer]   recipient:', input.toAddress, input.amountSatoshis);
        // Set change address
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        tx.change(address);
        console.error('[OPCAT buildTransfer]   change address:', address);
        // 5. Sign with OPCAT SIGHASH
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        tx.sign(privateKey);
        console.error('[OPCAT buildTransfer]   signed with OPCAT SIGHASH');
        // 6. Serialize
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
        const rawTx = tx.uncheckedSerialize();
        console.error('[OPCAT buildTransfer] rawTx hex length:', rawTx.length);
        console.error('[OPCAT buildTransfer] rawTx first 100 chars:', rawTx.slice(0, 100));
        // 7. Validate round-trip
        try {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
            const parsed = opcat.Transaction.fromString(rawTx);
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            console.error('[OPCAT buildTransfer] validation OK — tx hash:', parsed.hash);
        }
        catch (parseErr) {
            console.error('[OPCAT buildTransfer] FATAL: built transaction fails OPCAT parse:', parseErr instanceof Error ? parseErr.message : String(parseErr));
            throw new Error(`OPCAT buildTransfer produced invalid rawTx: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
        }
        return { rawTx, fee };
    },
    async buildInscription(input) {
        try {
            const feeRate = Number.isFinite(input.feeRate) && Number(input.feeRate) > 0
                ? input.feeRate : await this.fetchFeeRate();
            const opcat = await getOpcatLib();
            // 1. Derive private key
            const { privateKey, address } = await deriveOpcatPrivateKey(input.identity.mnemonic, input.identity.path);
            console.error('[OPCAT buildInscription] derived address:', address);
            // 2. Fetch UTXOs with scriptPk
            const utxos = await fetchOpcatUtxos(address);
            if (!utxos.length) {
                throw new Error('MetaBot OPCAT balance is insufficient for this chain write.');
            }
            // 3. Build MetaID inscription payload
            const payloadBody = input.request.encoding === 'base64'
                ? Buffer.from(input.request.payload, 'base64')
                : Buffer.from(input.request.payload, 'utf-8');
            const inscriptionPayload = buildMetaIdInscriptionPayload({
                operation: input.request.operation,
                path: input.request.path,
                contentType: input.request.contentType,
                encryption: input.request.encryption,
                version: input.request.version,
                body: payloadBody,
            });
            // 4. Select UTXOs
            // Outputs: OP_RETURN (0 value) + possibly change P2PKH
            const outputCount = 2;
            const { selectedUtxos, fee } = selectUtxos(utxos, 0, // OP_RETURN has value 0
            feeRate, outputCount);
            // 5. Build OPCAT Transaction
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
            const tx = new opcat.Transaction();
            // Add UTXO inputs
            for (const utxo of selectedUtxos) {
                const utxoWithScript = utxo;
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
                tx.addInput(new opcat.Transaction.Input.PublicKeyHash({
                    prevTxId: utxo.txId,
                    outputIndex: utxo.outputIndex,
                    script: opcat.Script.empty(),
                    output: new opcat.Transaction.Output({
                        script: opcat.Script.fromHex(utxoWithScript.scriptPk),
                        satoshis: utxo.satoshis,
                    }),
                }));
            }
            // Add OP_RETURN output with inscription payload
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            tx.addData(inscriptionPayload);
            // Set change address
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            tx.change(address);
            // 6. Sign with OPCAT SIGHASH
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            tx.sign(privateKey);
            // 7. Validate round-trip
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
            const rawTx = tx.uncheckedSerialize();
            try {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
                const parsed = opcat.Transaction.fromString(rawTx);
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                console.error('[OPCAT buildInscription] validation OK — tx hash:', parsed.hash);
            }
            catch (parseErr) {
                console.error('[OPCAT buildInscription] FATAL: built transaction fails OPCAT parse:', parseErr instanceof Error ? parseErr.message : String(parseErr));
                throw new Error(`OPCAT buildInscription produced invalid rawTx: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
            }
            return {
                signedRawTxs: [rawTx],
                revealIndices: [0],
                totalCost: fee,
            };
        }
        catch (err) {
            throw new Error(`OPCAT buildInscription failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    },
};
exports.default = exports.opcatChainAdapter;
