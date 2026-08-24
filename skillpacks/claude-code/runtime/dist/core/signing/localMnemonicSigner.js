"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChainBroadcastUnknownError = void 0;
exports.createLocalMnemonicSigner = createLocalMnemonicSigner;
exports.executeTransfer = executeTransfer;
const deriveIdentity_1 = require("../identity/deriveIdentity");
const node_crypto_1 = require("node:crypto");
const loadIdentity_1 = require("../identity/loadIdentity");
const writePin_1 = require("../chain/writePin");
const spendQueue_1 = require("../wallet/spendQueue");
const DEFAULT_BTC_WRITE_FEE_RATE = 2;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
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
/**
 * A broadcast-phase failure with UNKNOWN finality: the signed transactions
 * left the wallet but the node never confirmed acceptance (timeout, network
 * drop, ambiguous node error). Retrying blindly mints duplicates — the
 * transaction may already be on-chain. Handlers must surface this as
 * manual_action_required with the candidate txids, never as a plain failure.
 */
class ChainBroadcastUnknownError extends Error {
    /** Candidate txids derived from the signed raw transactions (verify on-chain). */
    candidateTxids;
    /** Txids that DID broadcast successfully before the failure. */
    confirmedTxids;
    constructor(input) {
        const message = input.cause instanceof Error ? input.cause.message : String(input.cause);
        super(`Chain broadcast status UNKNOWN: ${message}. Signed transactions may already be on-chain — `
            + `do NOT retry the same publish blindly. Candidate txids (verify on an explorer): `
            + `${[...new Set([...input.confirmedTxids, ...input.candidateTxids])].join(', ') || '(unavailable)'}`);
        this.name = 'ChainBroadcastUnknownError';
        this.candidateTxids = input.candidateTxids;
        this.confirmedTxids = input.confirmedTxids;
    }
}
exports.ChainBroadcastUnknownError = ChainBroadcastUnknownError;
/** Bitcoin-style txid of a serialized raw tx: double SHA-256, little-endian. */
function computeCandidateTxid(rawTxHex) {
    try {
        const first = (0, node_crypto_1.createHash)('sha256').update(Buffer.from(rawTxHex, 'hex')).digest();
        const second = (0, node_crypto_1.createHash)('sha256').update(first).digest();
        return [...second].reverse().map((byte) => byte.toString(16).padStart(2, '0')).join('');
    }
    catch {
        return null;
    }
}
/**
 * Create a local mnemonic signer backed by a ChainAdapterRegistry.
 *
 * The Signer delegates all chain-specific operations (inscription building, broadcasting)
 * to the appropriate ChainAdapter. No chain-dispatch logic (`if network === 'mvc'`, etc.)
 * lives in the Signer itself.
 */
function createLocalMnemonicSigner(input) {
    return {
        getIdentity: async () => loadSignerIdentity(input.secretStore),
        getPrivateChatIdentity: async () => buildPrivateChatIdentity(input.secretStore),
        writePin: async (rawInput) => {
            const request = (0, writePin_1.normalizeChainWriteRequest)(rawInput);
            const identity = await loadSignerIdentity(input.secretStore);
            const adapters = input.adapters ?? new Map();
            const adapter = adapters.get(request.network);
            if (!adapter) {
                throw new Error(`Chain write network ${request.network} is not supported.`);
            }
            const lockKey = await (0, spendQueue_1.resolveWalletSpendQueueKey)({
                adapter,
                mnemonic: identity.mnemonic,
                path: identity.path,
                fallbackAddress: identity.addresses?.[request.network] ?? identity.mvcAddress,
            });
            return (0, spendQueue_1.withWalletSpendQueue)(lockKey, async () => {
                const feeRate = input.feeRates?.[request.network];
                const inscriptionResult = await adapter.buildInscription({
                    request,
                    identity,
                    feeRate,
                });
                // Broadcast all signed transactions in order. A failure here leaves
                // finality UNKNOWN (earlier txs of the batch may be on-chain): surface
                // ChainBroadcastUnknownError instead of a plain retryable error.
                const broadcastTxids = [];
                try {
                    for (const rawTx of inscriptionResult.signedRawTxs) {
                        broadcastTxids.push(await adapter.broadcastTx(rawTx));
                    }
                }
                catch (error) {
                    throw new ChainBroadcastUnknownError({
                        confirmedTxids: [...broadcastTxids],
                        candidateTxids: inscriptionResult.signedRawTxs
                            .map((rawTx) => computeCandidateTxid(rawTx))
                            .filter((txid) => txid !== null),
                        cause: error,
                    });
                }
                const firstRevealTxid = broadcastTxids[inscriptionResult.revealIndices[0]];
                const revealTxids = inscriptionResult.revealIndices.map((i) => broadcastTxids[i]);
                return {
                    txids: revealTxids,
                    pinId: `${firstRevealTxid}i0`,
                    totalCost: inscriptionResult.totalCost,
                    network: request.network,
                    operation: request.operation,
                    path: request.path,
                    contentType: request.contentType,
                    encoding: request.encoding,
                    globalMetaId: identity.globalMetaId,
                    mvcAddress: identity.mvcAddress,
                };
            });
        },
    };
}
/**
 * Convenience helper: execute a transfer using an adapter's buildTransfer + broadcastTx.
 * Replaces the old `executeMvcTransfer` / `executeBtcTransfer` per-chain functions.
 */
async function executeTransfer(adapter, input) {
    const lockKey = await (0, spendQueue_1.resolveWalletSpendQueueKey)({
        adapter,
        mnemonic: input.mnemonic,
        path: input.path,
    });
    return (0, spendQueue_1.withWalletSpendQueue)(lockKey, async () => {
        const { rawTx, fee } = await adapter.buildTransfer({
            mnemonic: input.mnemonic,
            path: input.path,
            toAddress: input.toAddress,
            amountSatoshis: input.amountSatoshis,
            feeRate: input.feeRate,
        });
        const txid = await adapter.broadcastTx(rawTx);
        return { txid, fee };
    });
}
