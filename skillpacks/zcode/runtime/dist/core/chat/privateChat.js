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
exports.PRIVATE_FILE_MAX_BYTES = exports.PRIVATE_FILE_MSG_PATH = void 0;
exports.sendPrivateChat = sendPrivateChat;
exports.encryptPrivateFileHex = encryptPrivateFileHex;
exports.decryptPrivateFileHex = decryptPrivateFileHex;
exports.parseMetafileAttachmentUri = parseMetafileAttachmentUri;
exports.parsePrivateFileChatContent = parsePrivateFileChatContent;
exports.sendPrivateFileChat = sendPrivateFileChat;
exports.buildPrivateFileMsgPayload = buildPrivateFileMsgPayload;
exports.attachmentUriFromFileWrite = attachmentUriFromFileWrite;
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
        // IDBots parity: private-chat bodies are markdown; receivers (including
        // the IDBots app and the DSH plugin) gate markdown rendering on this
        // value. text/plain bodies would render verbatim with raw asterisks.
        contentType: 'text/markdown',
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
    if (!plain
        || plain === cipherText
        || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(plain))
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
/** @internal */
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
// ---- Private file messages (/protocols/simplefilemsg, IDBots parity) ----
// The message body is plaintext JSON carrying a `metafile://` attachment
// pointer; the FILE itself is pinned encrypted under /file with a raw
// AES-CBC cipher (fixed IV, raw-hex ciphertext) — deliberately NOT the
// OpenSSL-format cipher used for text, to stay wire-compatible with the
// IDBots chat app on the other side.
exports.PRIVATE_FILE_MSG_PATH = '/protocols/simplefilemsg';
exports.PRIVATE_FILE_MAX_BYTES = 1024 * 1024;
const FILE_CIPHER_IV = crypto_js_1.enc.Utf8.parse('0000000000000000');
/** @internal */
function encryptPrivateFileHex(fileHex, sharedSecretHex) {
    const encrypted = crypto_js_1.AES.encrypt(crypto_js_1.enc.Hex.parse(String(fileHex ?? '')), crypto_js_1.enc.Hex.parse(String(sharedSecretHex ?? '')), {
        mode: crypto_js_1.mode.CBC,
        padding: crypto_js_1.pad.Pkcs7,
        iv: FILE_CIPHER_IV,
    });
    return encrypted.ciphertext.toString(crypto_js_1.enc.Hex);
}
/** @internal */
function decryptPrivateFileHex(cipherHex, sharedSecretHex) {
    try {
        const cipherParams = crypto_js_1.default.lib.CipherParams.create({ ciphertext: crypto_js_1.enc.Hex.parse(String(cipherHex ?? '')) });
        const plainHex = crypto_js_1.AES.decrypt(cipherParams, crypto_js_1.enc.Hex.parse(String(sharedSecretHex ?? '')), {
            mode: crypto_js_1.mode.CBC,
            padding: crypto_js_1.pad.Pkcs7,
            iv: FILE_CIPHER_IV,
        }).toString(crypto_js_1.enc.Hex);
        if (!plainHex || !/^[0-9a-f]*$/iu.test(plainHex) || plainHex.length % 2 !== 0) {
            return null;
        }
        return Buffer.from(plainHex, 'hex');
    }
    catch {
        return null;
    }
}
const METAFILE_ATTACHMENT_PATTERN = /^metafile:\/\/([0-9a-f]{64}i0)(?:\.([a-z0-9][a-z0-9+-]{0,31}))?$/iu;
/** Extracts the pin id and extension from a `metafile://<pinId>.<ext>` URI. */
function parseMetafileAttachmentUri(value) {
    const match = normalizeText(value).match(METAFILE_ATTACHMENT_PATTERN);
    return match ? { pinId: match[1], extension: match[2] ?? '' } : null;
}
/**
 * Parses an inbound simplefilemsg body (`{"to","encrypt","attachment",
 * "fileType","timestamp","replyPin"}`). Returns null for anything else so
 * callers can treat it as regular text chat.
 */
function parsePrivateFileChatContent(content) {
    const normalized = normalizeText(content);
    if (!normalized.startsWith('{'))
        return null;
    try {
        const parsed = JSON.parse(normalized);
        const attachment = typeof parsed.attachment === 'string' ? normalizeText(parsed.attachment) : '';
        if (!attachment || !parseMetafileAttachmentUri(attachment))
            return null;
        if (typeof parsed.content === 'string')
            return null;
        return {
            attachment,
            fileType: typeof parsed.fileType === 'string' && normalizeText(parsed.fileType) ? normalizeText(parsed.fileType) : 'application/octet-stream',
            timestamp: Number.isFinite(Number(parsed.timestamp)) ? Number(parsed.timestamp) : 0,
            replyPin: typeof parsed.replyPin === 'string' ? normalizeText(parsed.replyPin) || null : null,
        };
    }
    catch {
        return null;
    }
}
/** @internal */
function sendPrivateFileChat(input) {
    const peerPublicKey = requirePeerChatPublicKey(input.peerChatPublicKey);
    const toGlobalMetaId = normalizeText(input.toGlobalMetaId);
    if (!toGlobalMetaId) {
        throw new Error('Target globalMetaId is required');
    }
    const fileBuffer = Buffer.from(String(input.fileDataBase64 ?? ''), 'base64');
    if (!fileBuffer.length || fileBuffer.length > exports.PRIVATE_FILE_MAX_BYTES) {
        throw new Error(`Private file messages require 1-${exports.PRIVATE_FILE_MAX_BYTES} bytes of file data`);
    }
    const fileType = normalizeText(input.fileType) || 'application/octet-stream';
    const sharedSecret = normalizeText(input.sharedSecretOverride)
        || computeEcdhSharedSecretSha256(requirePrivateKeyBuffer(input.fromIdentity, 'Local private key'), peerPublicKey);
    const encryptedFileHex = encryptPrivateFileHex(fileBuffer.toString('hex'), sharedSecret);
    const msgWrite = {
        operation: 'create',
        path: exports.PRIVATE_FILE_MSG_PATH,
        encryption: '0',
        version: '1.0.0',
        contentType: 'application/json',
        payload: '',
        encoding: 'utf-8',
    };
    // The attachment pin id comes from the /file write result, so the message
    // payload is filled by the caller once that lands.
    return {
        fileWrite: {
            operation: 'create',
            path: '/file',
            encryption: '0',
            contentType: fileType,
            payload: encryptedFileHex,
            encoding: 'hex',
        },
        msgWrite,
        attachment: '',
        sharedSecret,
    };
}
/** Builds the simplefilemsg payload once the /file pin id is known. */
function buildPrivateFileMsgPayload(input) {
    return JSON.stringify({
        to: input.toGlobalMetaId,
        encrypt: 'ecdh',
        attachment: input.attachment,
        fileType: input.fileType,
        timestamp: Number.isFinite(input.timestamp) ? Math.floor(input.timestamp) : Math.floor(Date.now() / 1000),
        replyPin: normalizeText(input.replyPinId),
    });
}
/** Derives the display attachment URI from a /file write result. */
function attachmentUriFromFileWrite(fileWrite, fileType) {
    const pinId = normalizeText(fileWrite.pinId);
    if (pinId) {
        return `metafile://${pinId}${extensionForFileType(fileType)}`;
    }
    const txids = Array.isArray(fileWrite.txids)
        ? fileWrite.txids.map((entry) => normalizeText(entry)).filter(Boolean)
        : [];
    if (txids[0]) {
        return `metafile://${txids[0]}i0${extensionForFileType(fileType)}`;
    }
    return null;
}
function extensionForFileType(fileType) {
    const normalized = normalizeText(fileType).toLowerCase().split(';')[0]?.trim() ?? '';
    const extension = EXTENSION_BY_FILE_TYPE[normalized];
    return extension ? `.${extension}` : '';
}
const EXTENSION_BY_FILE_TYPE = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
    'application/pdf': 'pdf',
    'text/plain': 'txt',
};
/** @internal */
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
