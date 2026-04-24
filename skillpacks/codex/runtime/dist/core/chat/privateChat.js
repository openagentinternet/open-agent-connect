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
exports.sendPrivateChat = sendPrivateChat;
exports.receivePrivateChat = receivePrivateChat;
const node_crypto_1 = require("node:crypto");
const crypto_js_1 = __importStar(require("crypto-js"));
const UTF8 = crypto_js_1.enc.Utf8;
const PRIVATE_CHAT_IV = UTF8.parse('0000000000000000');
const PRIVATE_CHAT_SALT = crypto_js_1.default.lib.WordArray.create([180470613, 109027952], 8);
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function requirePrivateKeyBuffer(identity, fieldName) {
    const value = identity.privateKeyHex;
    if (Buffer.isBuffer(value)) {
        if (value.length === 0) {
            throw new Error(`${fieldName} is required`);
        }
        return value;
    }
    const normalized = normalizeText(value);
    if (!normalized) {
        throw new Error(`${fieldName} is required`);
    }
    if (!/^[0-9a-f]+$/i.test(normalized) || normalized.length % 2 !== 0) {
        throw new Error(`${fieldName} must be a hex string`);
    }
    return Buffer.from(normalized, 'hex');
}
function requirePeerChatPublicKey(peerChatPublicKey) {
    const normalized = normalizeText(peerChatPublicKey);
    if (!normalized) {
        throw new Error('Peer chat public key is required');
    }
    return normalized;
}
function computeEcdhSharedSecret(privateKey32, peerPublicKeyHex) {
    const ecdh = (0, node_crypto_1.createECDH)('prime256v1');
    ecdh.setPrivateKey(privateKey32);
    const secret = ecdh.computeSecret(Buffer.from(peerPublicKeyHex, 'hex'));
    return secret.toString('hex');
}
function computeEcdhSharedSecretSha256(privateKey32, peerPublicKeyHex) {
    const rawSecretHex = computeEcdhSharedSecret(privateKey32, peerPublicKeyHex);
    return (0, node_crypto_1.createHash)('sha256').update(Buffer.from(rawSecretHex, 'hex')).digest('hex');
}
function ecdhDecrypt(cipherText, sharedSecret) {
    const secretStr = String(sharedSecret ?? '').trim();
    const isHex64 = secretStr.length === 64 && /^[0-9a-fA-F]+$/.test(secretStr);
    if (isHex64 && cipherText && !cipherText.startsWith('U2FsdGVkX1')) {
        try {
            const key = crypto_js_1.enc.Hex.parse(secretStr);
            const bytes = crypto_js_1.AES.decrypt(cipherText, key, {
                iv: PRIVATE_CHAT_IV,
                mode: crypto_js_1.mode.CBC,
                padding: crypto_js_1.pad.Pkcs7,
            });
            const out = bytes.toString(UTF8);
            if (out)
                return out;
        }
        catch {
            // Fall through to OpenSSL passphrase mode.
        }
    }
    try {
        const bytes = crypto_js_1.AES.decrypt(cipherText, secretStr);
        return bytes.toString(UTF8) || cipherText;
    }
    catch {
        return cipherText;
    }
}
function ecdhEncrypt(plaintext, sharedSecretHex) {
    const cipherParams = crypto_js_1.default.lib.PasswordBasedCipher.encrypt(crypto_js_1.default.algo.AES, crypto_js_1.default.enc.Utf8.parse(String(plaintext ?? '')), String(sharedSecretHex ?? ''), {
        salt: PRIVATE_CHAT_SALT,
        format: crypto_js_1.default.format.OpenSSL,
    });
    return cipherParams.toString();
}
function buildPrivateMsgPayload(toGlobalMetaId, encryptedContent, replyPinId, timestamp) {
    return JSON.stringify({
        to: toGlobalMetaId,
        timestamp,
        content: encryptedContent,
        contentType: 'text/plain',
        encrypt: 'ecdh',
        replyPin: replyPinId,
    });
}
function extractCipherTextFromRawData(rawData) {
    const raw = normalizeText(rawData);
    if (!raw)
        return '';
    try {
        const parsed = JSON.parse(raw);
        const direct = typeof parsed.content === 'string' ? parsed.content.trim() : '';
        if (direct)
            return direct;
        const nested = parsed.data && typeof parsed.data.content === 'string'
            ? parsed.data.content.trim()
            : '';
        return nested;
    }
    catch {
        return '';
    }
}
function looksLikeEncryptedPrivateContent(value) {
    const normalized = normalizeText(value);
    if (!normalized)
        return false;
    if (normalized.startsWith('U2FsdGVkX1'))
        return true;
    return /^[0-9a-fA-F]{32,}$/.test(normalized) && normalized.length % 2 === 0;
}
function tryDecryptWithSecret(cipherText, secret) {
    if (!cipherText || !secret)
        return null;
    const plain = ecdhDecrypt(cipherText, secret);
    if (!plain || plain === cipherText)
        return null;
    return plain;
}
function tryParsePlaintextJson(value) {
    const normalized = normalizeText(value);
    if (!normalized) {
        return null;
    }
    try {
        return JSON.parse(normalized);
    }
    catch {
        return null;
    }
}
function sendPrivateChat(input) {
    const peerPublicKey = requirePeerChatPublicKey(input.peerChatPublicKey);
    const toGlobalMetaId = normalizeText(input.toGlobalMetaId);
    if (!toGlobalMetaId) {
        throw new Error('Target globalMetaId is required');
    }
    const secretVariant = input.secretVariant === 'raw' ? 'raw' : 'sha256';
    let sharedSecret = normalizeText(input.sharedSecretOverride);
    if (!sharedSecret) {
        const localPrivateKey = requirePrivateKeyBuffer(input.fromIdentity, 'Local private key');
        try {
            sharedSecret = secretVariant === 'raw'
                ? computeEcdhSharedSecret(localPrivateKey, peerPublicKey)
                : computeEcdhSharedSecretSha256(localPrivateKey, peerPublicKey);
        }
        catch (error) {
            throw new Error(`Peer chat public key is invalid: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    const encryptedContent = ecdhEncrypt(String(input.content ?? ''), sharedSecret);
    const payload = buildPrivateMsgPayload(toGlobalMetaId, encryptedContent, normalizeText(input.replyPinId), Number.isFinite(input.timestamp) ? Number(input.timestamp) : Math.floor(Date.now() / 1000));
    return {
        path: '/protocols/simplemsg',
        encryption: '0',
        version: '1.0.0',
        contentType: 'application/json',
        payload,
        encryptedContent,
        sharedSecret,
        secretVariant,
    };
}
function receivePrivateChat(input) {
    const localPrivateKey = requirePrivateKeyBuffer(input.localIdentity, 'Local private key');
    const peerPublicKey = requirePeerChatPublicKey(input.peerChatPublicKey);
    const rawCipherText = extractCipherTextFromRawData(input.payload.rawData);
    const directContent = normalizeText(input.payload.content);
    const cipherText = rawCipherText || directContent;
    if (!cipherText) {
        throw new Error('Encrypted private chat payload is required');
    }
    const shouldDecrypt = Boolean(rawCipherText) || looksLikeEncryptedPrivateContent(directContent);
    if (!shouldDecrypt) {
        return {
            fromGlobalMetaId: normalizeText(input.payload.fromGlobalMetaId),
            replyPinId: normalizeText(input.payload.replyPinId),
            plaintext: directContent,
            plaintextJson: tryParsePlaintextJson(directContent),
            sharedSecret: '',
            secretVariant: 'sha256',
        };
    }
    let sharedSecretSha256;
    let sharedSecretRaw;
    try {
        sharedSecretSha256 = computeEcdhSharedSecretSha256(localPrivateKey, peerPublicKey);
        sharedSecretRaw = computeEcdhSharedSecret(localPrivateKey, peerPublicKey);
    }
    catch (error) {
        throw new Error(`Peer chat public key is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
    const plainBySha256 = tryDecryptWithSecret(cipherText, sharedSecretSha256);
    if (plainBySha256 != null) {
        return {
            fromGlobalMetaId: normalizeText(input.payload.fromGlobalMetaId),
            replyPinId: normalizeText(input.payload.replyPinId),
            plaintext: plainBySha256,
            plaintextJson: tryParsePlaintextJson(plainBySha256),
            sharedSecret: sharedSecretSha256,
            secretVariant: 'sha256',
        };
    }
    const plainByRaw = tryDecryptWithSecret(cipherText, sharedSecretRaw);
    if (plainByRaw != null) {
        return {
            fromGlobalMetaId: normalizeText(input.payload.fromGlobalMetaId),
            replyPinId: normalizeText(input.payload.replyPinId),
            plaintext: plainByRaw,
            plaintextJson: tryParsePlaintextJson(plainByRaw),
            sharedSecret: sharedSecretRaw,
            secretVariant: 'raw',
        };
    }
    throw new Error('Failed to decrypt private chat payload');
}
