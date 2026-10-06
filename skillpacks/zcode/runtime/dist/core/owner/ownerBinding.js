"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OWNER_BINDING_VERSION = exports.OWNER_BINDING_ALGORITHM = exports.OWNER_BINDING_MESSAGE_PREFIX = exports.OWNER_BINDING_PATH = void 0;
exports.buildOwnerBindingMessage = buildOwnerBindingMessage;
exports.buildOwnerBindingPayload = buildOwnerBindingPayload;
exports.parseOwnerBindingPayload = parseOwnerBindingPayload;
exports.signOwnerBinding = signOwnerBinding;
exports.buildOwnerBindingPublishTarget = buildOwnerBindingPublishTarget;
exports.verifyOwnerBinding = verifyOwnerBinding;
/**
 * Owner binding: the local human owner signs a binding statement over the
 * Bot's GlobalMetaID with their MVC identity key (secp256k1, Bitcoin Signed
 * Message format). The Bot publishes the signature in an /info/owner pin, so
 * the binding carries both parties' consent: the pin itself is signed by the
 * Bot's key on-chain, and the embedded signature proves the human owner's
 * consent. Ported from IDBots ownerBindingService.ts (same wire format).
 *
 * Third-party verification is self-contained:
 *   1. decode payload.owner (GlobalMetaID) -> pubkey hash
 *   2. hash160(payload.ownerPublicKey) must equal that hash
 *   3. payload.signedMessage must match this Bot's GlobalMetaID
 *   4. ECDSA-verify payload.signature over magicHash(signedMessage) with
 *      payload.ownerPublicKey
 */
const meta_contract_1 = require("meta-contract");
const deriveIdentity_1 = require("../identity/deriveIdentity");
const mvcMessageSigning_1 = require("../subsidy/mvcMessageSigning");
exports.OWNER_BINDING_PATH = '/info/owner';
exports.OWNER_BINDING_MESSAGE_PREFIX = 'metabot-owner-binding:';
exports.OWNER_BINDING_ALGORITHM = 'ecdsa-secp256k1-bitcoin-message';
exports.OWNER_BINDING_VERSION = 1;
const ADDRESS_VERSION_P2PKH = 0;
function buildOwnerBindingMessage(botGlobalMetaId) {
    return `${exports.OWNER_BINDING_MESSAGE_PREFIX}${(botGlobalMetaId ?? '').trim().toLowerCase()}`;
}
function buildOwnerBindingPayload(input) {
    const payload = {
        version: exports.OWNER_BINDING_VERSION,
        owner: input.ownerGlobalMetaId.trim().toLowerCase(),
        ownerPublicKey: input.ownerPublicKey.trim(),
        signedMessage: buildOwnerBindingMessage(input.botGlobalMetaId),
        signature: input.signature,
        algorithm: exports.OWNER_BINDING_ALGORITHM,
    };
    return JSON.stringify(payload);
}
function parseOwnerBindingPayload(raw) {
    if (!raw || typeof raw !== 'string')
        return null;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object')
            return null;
        const { version, owner, ownerPublicKey, signedMessage, signature, algorithm } = parsed;
        if (typeof version !== 'number')
            return null;
        if (typeof owner !== 'string' || typeof ownerPublicKey !== 'string')
            return null;
        if (typeof signedMessage !== 'string' || typeof signature !== 'string')
            return null;
        if (typeof algorithm !== 'string')
            return null;
        return { version, owner, ownerPublicKey, signedMessage, signature, algorithm };
    }
    catch {
        return null;
    }
}
/**
 * Sign an owner-binding statement with the owner identity's MVC key. Returns
 * the JSON payload ready to publish at /info/owner plus the signing details.
 */
async function signOwnerBinding(owner, botGlobalMetaId) {
    const ownerGlobalMetaId = (owner.globalMetaId ?? '').trim();
    if (!ownerGlobalMetaId) {
        throw new Error('Owner identity has no globalMetaId');
    }
    const botId = (botGlobalMetaId ?? '').trim();
    if (!botId) {
        throw new Error('botGlobalMetaId is required');
    }
    const signedMessage = buildOwnerBindingMessage(botId);
    const { signature, publicKey } = await (0, mvcMessageSigning_1.signMvcAddressMessage)({
        mnemonic: owner.mnemonic,
        path: owner.path,
        message: signedMessage,
    });
    const payload = buildOwnerBindingPayload({
        ownerGlobalMetaId,
        ownerPublicKey: publicKey,
        botGlobalMetaId: botId,
        signature,
    });
    return { payload, signature, publicKey, signedMessage };
}
/** Build the /info/owner publish target for a Bot owned by `owner`. */
async function buildOwnerBindingPublishTarget(owner, botGlobalMetaId) {
    const { payload } = await signOwnerBinding(owner, botGlobalMetaId);
    return {
        path: exports.OWNER_BINDING_PATH,
        contentType: 'application/json',
        payload,
        encoding: 'utf-8',
        operation: 'create',
    };
}
/**
 * Verify an /info/owner payload against the GlobalMetaID of the Bot that
 * published it. Purely offline: no chain queries needed.
 */
function verifyOwnerBinding(payloadRaw, expectedBotGlobalMetaId) {
    const payload = parseOwnerBindingPayload(payloadRaw);
    if (!payload)
        return false;
    if (payload.version !== exports.OWNER_BINDING_VERSION)
        return false;
    if (payload.algorithm !== exports.OWNER_BINDING_ALGORITHM)
        return false;
    const expectedMessage = buildOwnerBindingMessage(expectedBotGlobalMetaId);
    if (!expectedMessage || payload.signedMessage !== expectedMessage)
        return false;
    try {
        // 1. The declared public key must hash to the owner GlobalMetaID's payload.
        const ownerDecoded = (0, deriveIdentity_1.decodeGlobalMetaIdPayload)(payload.owner);
        if (!ownerDecoded || ownerDecoded.version !== ADDRESS_VERSION_P2PKH)
            return false;
        const publicKey = meta_contract_1.mvc.PublicKey.fromString(payload.ownerPublicKey);
        const pubkeyHash = meta_contract_1.mvc.crypto.Hash.sha256ripemd160(publicKey.toBuffer());
        const ownerHash = Buffer.from(ownerDecoded.payload);
        if (pubkeyHash.length !== ownerHash.length || !pubkeyHash.equals(ownerHash))
            return false;
        // 2. ECDSA-verify the Bitcoin Signed Message signature with that key.
        // meta-contract's .d.ts misdeclares Message.magicHash as static and ECDSA
        // as non-constructable; both are instance APIs at runtime (IDBots tests).
        const signatureBuffer = Buffer.from(payload.signature, 'base64');
        if (signatureBuffer.length !== 65)
            return false;
        const sig = meta_contract_1.mvc.crypto.Signature.fromCompact(signatureBuffer);
        const message = new meta_contract_1.mvc.Message(payload.signedMessage);
        const hashbuf = message.magicHash();
        const ecdsa = new meta_contract_1.mvc.crypto.ECDSA({ hashbuf, sig, pubkey: publicKey });
        ecdsa.verify();
        return ecdsa.verified === true;
    }
    catch {
        return false;
    }
}
