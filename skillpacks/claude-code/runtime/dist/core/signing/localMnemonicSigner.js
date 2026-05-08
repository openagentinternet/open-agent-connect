"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLocalMnemonicSigner = createLocalMnemonicSigner;
exports.executeTransfer = executeTransfer;
const deriveIdentity_1 = require("../identity/deriveIdentity");
const loadIdentity_1 = require("../identity/loadIdentity");
const writePin_1 = require("../chain/writePin");
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
            const feeRate = input.feeRates?.[request.network];
            const inscriptionResult = await adapter.buildInscription({
                request,
                identity,
                feeRate,
            });
            // Broadcast all signed transactions in order
            const broadcastTxids = [];
            for (const rawTx of inscriptionResult.signedRawTxs) {
                broadcastTxids.push(await adapter.broadcastTx(rawTx));
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
        },
    };
}
/**
 * Convenience helper: execute a transfer using an adapter's buildTransfer + broadcastTx.
 * Replaces the old `executeMvcTransfer` / `executeBtcTransfer` per-chain functions.
 */
async function executeTransfer(adapter, input) {
    const { rawTx, fee } = await adapter.buildTransfer({
        mnemonic: input.mnemonic,
        path: input.path,
        toAddress: input.toAddress,
        amountSatoshis: input.amountSatoshis,
        feeRate: input.feeRate,
    });
    const txid = await adapter.broadcastTx(rawTx);
    return { txid, fee };
}
