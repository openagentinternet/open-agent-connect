"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadIdentity = loadIdentity;
const deriveIdentity_1 = require("./deriveIdentity");
function readString(value) {
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
}
function readGlobalMetaId(value) {
    const normalized = (0, deriveIdentity_1.normalizeGlobalMetaId)(value);
    return normalized ?? undefined;
}
function readDerivedFields(source) {
    return {
        publicKey: readString(source.publicKey ?? source.public_key),
        chatPublicKey: readString(source.chatPublicKey ?? source.chat_public_key),
        mvcAddress: readString(source.mvcAddress ?? source.mvc_address),
        btcAddress: readString(source.btcAddress ?? source.btc_address),
        dogeAddress: readString(source.dogeAddress ?? source.doge_address),
        metaId: readString(source.metaId ?? source.metaid),
        globalMetaId: readGlobalMetaId(source.globalMetaId ?? source.globalmetaid)
    };
}
function hasCompleteDerivedFields(derived) {
    return Boolean(derived.publicKey &&
        derived.chatPublicKey &&
        derived.mvcAddress &&
        derived.btcAddress &&
        derived.dogeAddress &&
        derived.metaId &&
        derived.globalMetaId);
}
function assertDerivedFieldsMatch(expected, actual) {
    for (const key of Object.keys(actual)) {
        const value = actual[key];
        if (value === undefined)
            continue;
        if (expected[key] !== value) {
            throw new Error(`Identity field mismatch: ${key}`);
        }
    }
}
async function loadIdentity(source) {
    const mnemonic = readString(source.mnemonic);
    const path = readString(source.path) ?? deriveIdentity_1.DEFAULT_DERIVATION_PATH;
    const derivedFields = readDerivedFields(source);
    if (mnemonic) {
        const derivedIdentity = await (0, deriveIdentity_1.deriveIdentity)({
            mnemonic,
            path
        });
        assertDerivedFieldsMatch(derivedIdentity, derivedFields);
        return derivedIdentity;
    }
    if (hasCompleteDerivedFields(derivedFields)) {
        return {
            mnemonic: '',
            path,
            ...derivedFields
        };
    }
    throw new Error('Identity source is missing mnemonic');
}
