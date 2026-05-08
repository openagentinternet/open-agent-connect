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
    const mvcAddress = readString(source.mvcAddress ?? source.mvc_address);
    const btcAddress = readString(source.btcAddress ?? source.btc_address);
    const dogeAddress = readString(source.dogeAddress ?? source.doge_address);
    // Build addresses map from explicit fields
    const addresses = {};
    if (mvcAddress)
        addresses.mvc = mvcAddress;
    if (btcAddress)
        addresses.btc = btcAddress;
    if (dogeAddress)
        addresses.doge = dogeAddress;
    return {
        publicKey: readString(source.publicKey ?? source.public_key),
        chatPublicKey: readString(source.chatPublicKey ?? source.chat_public_key),
        mvcAddress,
        addresses: Object.keys(addresses).length > 0 ? addresses : undefined,
        metaId: readString(source.metaId ?? source.metaid),
        globalMetaId: readGlobalMetaId(source.globalMetaId ?? source.globalmetaid)
    };
}
function hasCompleteDerivedFields(derived) {
    return Boolean(derived.publicKey &&
        derived.chatPublicKey &&
        derived.mvcAddress &&
        derived.addresses &&
        derived.metaId &&
        derived.globalMetaId);
}
function assertDerivedFieldsMatch(expected, actual) {
    for (const key of Object.keys(actual)) {
        const value = actual[key];
        if (value === undefined)
            continue;
        if (key === 'addresses') {
            // Compare addresses map entries
            const actualAddresses = value;
            for (const [chain, addr] of Object.entries(actualAddresses)) {
                if (addr !== expected.addresses[chain]) {
                    throw new Error(`Identity field mismatch: addresses.${chain}`);
                }
            }
            continue;
        }
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
            publicKey: derivedFields.publicKey,
            chatPublicKey: derivedFields.chatPublicKey,
            addresses: derivedFields.addresses,
            mvcAddress: derivedFields.mvcAddress,
            metaId: derivedFields.metaId,
            globalMetaId: derivedFields.globalMetaId,
        };
    }
    throw new Error('Identity source is missing mnemonic');
}
