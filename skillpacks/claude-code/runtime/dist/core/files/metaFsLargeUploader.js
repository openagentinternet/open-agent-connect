"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_METAFS_UPLOADER_BASE_URL = void 0;
exports.createMetaFsLargeUploader = createMetaFsLargeUploader;
const node_fs_1 = require("node:fs");
const mvcLargeUploadFunding_1 = require("../chain/mvcLargeUploadFunding");
const mvcPendingUtxos_1 = require("../chain/mvcPendingUtxos");
const utxoBroadcastErrors_1 = require("../chain/utxoBroadcastErrors");
const spendQueue_1 = require("../wallet/spendQueue");
const metafileUrls_1 = require("./metafileUrls");
const metafileUri_1 = require("./metafileUri");
const uploadLargeFile_1 = require("./uploadLargeFile");
exports.DEFAULT_METAFS_UPLOADER_BASE_URL = 'https://file.metaid.io/metafile-uploader';
const METALET_HOST = 'https://www.metalet.space';
const MVC_NET = 'livenet';
const DEFAULT_CHUNK_SIZE_BYTES = 1024 * 1024;
const RETRYABLE_ATTEMPTS = 3;
const RETRYABLE_DELAY_MS = 750;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function getErrorMessage(value) {
    if (value instanceof Error)
        return value.message;
    return String(value ?? '').trim();
}
function codedError(code, message, cause) {
    const error = new Error(message);
    error.code = code;
    if (cause !== undefined)
        error.cause = cause;
    return error;
}
function isCodedError(value) {
    return value instanceof Error && typeof value.code === 'string';
}
function normalizeBaseUrl(value) {
    const normalized = normalizeText(value).replace(/\/+$/u, '');
    return normalized || exports.DEFAULT_METAFS_UPLOADER_BASE_URL;
}
function readPositiveInteger(value, fallback) {
    const numeric = Math.floor(Number(value));
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}
function readPositiveFeeRate(value) {
    const numeric = Math.floor(Number(value));
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 1;
}
function readServerMaxBytes(config) {
    return readPositiveInteger(config.chains?.mvc?.maxFileSize ?? config.maxFileSize, 0);
}
function sanitizeFileName(fileName) {
    return normalizeText(fileName).replace(/[^\w.-]/gu, '_') || 'file';
}
function buildMetaFsContentType(contentType) {
    const normalized = normalizeText(contentType) || 'application/octet-stream';
    const lower = normalized.toLowerCase();
    const baseType = lower.split(';', 1)[0].trim();
    if (baseType.startsWith('text/')
        || baseType === 'application/json'
        || baseType === 'application/javascript'
        || baseType === 'application/xml'
        || lower.split(';').map((part) => part.trim()).includes('binary')) {
        return normalized;
    }
    return `${normalized};binary`;
}
async function readJson(input) {
    let response;
    try {
        response = await input.fetchFn(input.url, input.init);
    }
    catch (error) {
        throw codedError(input.errorCode, `${input.fallbackMessage}: ${getErrorMessage(error)}`, error);
    }
    let text = '';
    try {
        text = await response.text();
    }
    catch (error) {
        throw codedError(input.errorCode, `${input.fallbackMessage}: ${getErrorMessage(error)}`, error);
    }
    let parsed = undefined;
    if (text.trim()) {
        try {
            parsed = JSON.parse(text);
        }
        catch (error) {
            throw codedError(input.errorCode, `${input.fallbackMessage}: invalid JSON response`, error);
        }
    }
    const envelope = parsed;
    if (!response.ok) {
        throw codedError(input.errorCode, normalizeText(envelope?.message) || text || `${input.fallbackMessage}: HTTP ${response.status}`);
    }
    if (envelope && typeof envelope === 'object' && envelope.code != null && envelope.code !== 0) {
        throw codedError(input.errorCode, normalizeText(envelope.message) || input.fallbackMessage);
    }
    if (envelope
        && typeof envelope === 'object'
        && envelope.code != null
        && Object.hasOwn(envelope, 'data')) {
        return envelope.data;
    }
    return parsed;
}
async function postMetaFsJson(input) {
    return readJson({
        fetchFn: input.fetchFn,
        url: `${input.baseUrl}${input.path}`,
        init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input.body),
        },
        errorCode: 'large_file_upload_metafs_failed',
        fallbackMessage: `MetaFS request failed for ${input.path}`,
    });
}
async function uploadMultipartStorage(input) {
    const initiate = await postMetaFsJson({
        fetchFn: input.fetchFn,
        baseUrl: input.baseUrl,
        path: '/api/v1/files/multipart/initiate',
        body: {
            fileName: input.fileName,
            fileSize: input.fileSize,
            metaId: input.metaId,
            address: input.address,
        },
    });
    const uploadId = normalizeText(initiate?.uploadId);
    const key = normalizeText(initiate?.key);
    if (!uploadId || !key) {
        throw codedError('large_file_upload_metafs_failed', 'MetaFS multipart initiate did not return uploadId/key.');
    }
    const parts = [];
    let partNumber = 1;
    for await (const chunk of (0, node_fs_1.createReadStream)(input.filePath, { highWaterMark: input.chunkSize })) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const part = await postMetaFsJson({
            fetchFn: input.fetchFn,
            baseUrl: input.baseUrl,
            path: '/api/v1/files/multipart/upload-part',
            body: {
                uploadId,
                key,
                partNumber,
                content: buffer.toString('base64'),
            },
        });
        const etag = normalizeText(part?.etag);
        if (!etag) {
            throw codedError('large_file_upload_metafs_failed', `MetaFS multipart upload-part ${partNumber} did not return etag.`);
        }
        parts.push({ partNumber, etag, size: buffer.byteLength });
        partNumber += 1;
    }
    const complete = await postMetaFsJson({
        fetchFn: input.fetchFn,
        baseUrl: input.baseUrl,
        path: '/api/v1/files/multipart/complete',
        body: {
            uploadId,
            key,
            parts,
        },
    });
    return normalizeText(complete?.key) || key;
}
async function fetchMvcFundingUtxos(input) {
    const all = [];
    let flag;
    while (true) {
        const params = new URLSearchParams({ address: input.address, net: MVC_NET });
        if (flag)
            params.set('flag', flag);
        const json = await readJson({
            fetchFn: input.fetchFn,
            url: `${METALET_HOST}/wallet-api/v4/mvc/address/utxo-list?${params.toString()}`,
            errorCode: 'large_file_upload_funding_failed',
            fallbackMessage: 'Failed to fetch MVC UTXOs for large upload funding',
        });
        const list = json?.list ?? json?.data?.list ?? [];
        if (!list.length)
            break;
        for (const utxo of list) {
            const satoshis = Math.floor(Number(utxo.value));
            const outputIndex = Math.floor(Number(utxo.outIndex));
            const txId = normalizeText(utxo.txid);
            if (!txId || !Number.isInteger(outputIndex) || outputIndex < 0 || !Number.isInteger(satoshis) || satoshis < 600) {
                continue;
            }
            all.push({
                txId,
                outputIndex,
                satoshis,
                address: input.address,
                height: Math.floor(Number(utxo.height ?? 0)) || 0,
            });
        }
        flag = normalizeText(list[list.length - 1]?.flag) || undefined;
        if (!flag)
            break;
    }
    return all;
}
function isRetryableLargeUploadError(error) {
    if ((0, utxoBroadcastErrors_1.isRetryableUtxoFundingError)(error))
        return true;
    const message = getErrorMessage(error).toLowerCase();
    return (message.includes('failed to broadcast merge transaction')
        && (message.includes('missing')
            || message.includes('spent')
            || message.includes('mempool')
            || message.includes('conflict')));
}
function calculateTotalCost(funding) {
    const spent = funding.spentUtxos.reduce((sum, utxo) => sum + utxo.satoshis, 0);
    const change = funding.changeUtxo?.satoshis ?? 0;
    return Math.max(0, spent - change);
}
function inferMetafileExtension(input) {
    return (0, metafileUri_1.extensionFromContentType)(input.contentType) ?? (0, metafileUri_1.safeMetafileExtension)(input.extension) ?? '';
}
function buildResult(input) {
    const pinId = `${input.indexTxId}i0`;
    const urls = (0, metafileUrls_1.buildMetafileContentUrls)(pinId);
    const extension = inferMetafileExtension(input.uploadInput);
    return {
        pinId,
        txids: [input.indexTxId],
        totalCost: input.totalCost,
        network: 'mvc',
        filePath: input.uploadInput.filePath,
        fileName: input.uploadInput.fileName,
        contentType: input.uploadInput.contentType,
        bytes: input.uploadInput.bytes,
        extension,
        metafileUri: `metafile://${pinId}${extension}`,
        previewUrl: urls.previewUrl,
        downloadUrl: urls.downloadUrl,
        globalMetaId: input.globalMetaId,
        uploadMode: 'chunked',
    };
}
function ensureFundingError(error, fallbackMessage) {
    if (isCodedError(error))
        throw error;
    throw codedError('large_file_upload_funding_failed', `${fallbackMessage}: ${getErrorMessage(error)}`, error);
}
function createMetaFsLargeUploader(options = {}) {
    const baseUrl = normalizeBaseUrl(options.baseUrl || process.env.METABOT_METAFS_UPLOADER_BASE_URL || exports.DEFAULT_METAFS_UPLOADER_BASE_URL);
    const fetchFn = options.fetchFn ?? fetch;
    const buildFunding = options.buildFunding ?? mvcLargeUploadFunding_1.buildMvcLargeUploadFunding;
    const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const localMaxBytes = readPositiveInteger(options.maxBytes, uploadLargeFile_1.LARGE_UPLOAD_MAX_BYTES);
    return {
        async upload(input) {
            if (normalizeText(input.network).toLowerCase() !== 'mvc') {
                throw codedError('large_file_upload_chain_unsupported', 'Production MetaFS large upload supports MVC only.');
            }
            let identity;
            try {
                identity = await input.signer.getIdentity();
            }
            catch (error) {
                ensureFundingError(error, 'Failed to resolve signer identity for large upload');
            }
            const address = normalizeText(identity.addresses?.mvc) || normalizeText(identity.mvcAddress);
            const metaId = normalizeText(identity.metaId);
            const globalMetaId = normalizeText(identity.globalMetaId);
            if (!address || !metaId || !globalMetaId) {
                throw codedError('large_file_upload_funding_failed', 'Large file upload requires MVC address, metaId, and globalMetaId.');
            }
            const config = await readJson({
                fetchFn,
                url: `${baseUrl}/api/v1/config`,
                errorCode: 'large_file_upload_metafs_failed',
                fallbackMessage: 'Failed to fetch MetaFS uploader config',
            });
            const serverMaxBytes = readServerMaxBytes(config ?? {});
            const effectiveMaxBytes = serverMaxBytes > 0
                ? Math.min(localMaxBytes, serverMaxBytes)
                : localMaxBytes;
            if (effectiveMaxBytes > 0 && input.bytes > effectiveMaxBytes) {
                throw codedError('large_file_upload_too_large', `File exceeds maximum MetaFS large upload size of ${effectiveMaxBytes} bytes.`);
            }
            const mvcConfig = config?.chains?.mvc ?? {};
            const chunkSize = readPositiveInteger(mvcConfig.chunkSize, DEFAULT_CHUNK_SIZE_BYTES);
            const feeRate = readPositiveFeeRate(mvcConfig.feeRate);
            const uploadPath = `/file/${sanitizeFileName(input.fileName)}`;
            const metaFsContentType = buildMetaFsContentType(input.contentType);
            const storageKey = await uploadMultipartStorage({
                fetchFn,
                baseUrl,
                filePath: input.filePath,
                fileName: input.fileName,
                fileSize: input.bytes,
                metaId,
                address,
                chunkSize,
            });
            const estimate = await postMetaFsJson({
                fetchFn,
                baseUrl,
                path: '/api/v1/files/estimate-chunked-upload',
                body: {
                    fileName: input.fileName,
                    path: uploadPath,
                    contentType: metaFsContentType,
                    feeRate,
                    storageKey,
                },
            });
            const chunkPreTxFee = readPositiveInteger(estimate?.chunkPreTxFee, 0);
            const indexPreTxFee = readPositiveInteger(estimate?.indexPreTxFee, 0);
            if (!chunkPreTxFee || !indexPreTxFee) {
                throw codedError('large_file_upload_metafs_failed', 'MetaFS estimate did not return valid chunkPreTxFee/indexPreTxFee.');
            }
            let queueKey;
            try {
                queueKey = await (0, spendQueue_1.resolveWalletSpendQueueKey)({
                    adapter: {
                        network: 'mvc',
                        deriveAddress: async () => address,
                    },
                    mnemonic: identity.mnemonic,
                    path: identity.path,
                    fallbackAddress: address,
                });
            }
            catch (error) {
                ensureFundingError(error, 'Failed to resolve wallet spend queue for large upload');
            }
            try {
                return await (0, spendQueue_1.withWalletSpendQueue)(queueKey, async () => {
                    const excludedOutpoints = new Set();
                    let lastError = null;
                    for (let attempt = 1; attempt <= RETRYABLE_ATTEMPTS; attempt += 1) {
                        let funding = null;
                        try {
                            const utxos = await fetchMvcFundingUtxos({ fetchFn, address });
                            try {
                                funding = await buildFunding({
                                    identity,
                                    address,
                                    feeRate,
                                    chunkPreTxFee,
                                    indexPreTxFee,
                                    utxos,
                                    excludedOutpoints,
                                });
                            }
                            catch (error) {
                                throw codedError('large_file_upload_funding_failed', getErrorMessage(error), error);
                            }
                            const uploadResult = await postMetaFsJson({
                                fetchFn,
                                baseUrl,
                                path: '/api/v1/files/chunked-upload',
                                body: {
                                    metaId,
                                    address,
                                    fileName: input.fileName,
                                    path: uploadPath,
                                    operation: 'create',
                                    contentType: metaFsContentType,
                                    chunkPreTxHex: funding.chunkPreTxHex,
                                    indexPreTxHex: funding.indexPreTxHex,
                                    mergeTxHex: funding.mergeTxHex,
                                    feeRate,
                                    isBroadcast: true,
                                    storageKey,
                                },
                            });
                            if (uploadResult?.status && uploadResult.status !== 'success') {
                                throw codedError('large_file_upload_metafs_failed', normalizeText(uploadResult.message) || `MetaFS chunked upload returned status ${uploadResult.status}.`);
                            }
                            const indexTxId = normalizeText(uploadResult?.indexTxId) || normalizeText(uploadResult?.txId);
                            if (!indexTxId) {
                                throw codedError('large_file_upload_metafs_failed', 'MetaFS chunked upload did not return indexTxId/txId.');
                            }
                            (0, mvcPendingUtxos_1.rememberPendingMvcTransaction)({
                                address,
                                spentUtxos: funding.spentUtxos,
                                createdUtxos: funding.changeUtxo ? [funding.changeUtxo] : [],
                            });
                            return buildResult({
                                uploadInput: input,
                                indexTxId,
                                totalCost: calculateTotalCost(funding),
                                globalMetaId,
                            });
                        }
                        catch (error) {
                            lastError = error;
                            if (attempt < RETRYABLE_ATTEMPTS && isRetryableLargeUploadError(error)) {
                                for (const outpoint of funding?.spentOutpoints ?? []) {
                                    excludedOutpoints.add(normalizeText(outpoint).toLowerCase());
                                }
                                await sleep(RETRYABLE_DELAY_MS);
                                continue;
                            }
                            throw error;
                        }
                    }
                    if (lastError)
                        throw lastError;
                    throw codedError('large_file_upload_metafs_failed', 'MetaFS chunked upload failed.');
                });
            }
            catch (error) {
                if (isCodedError(error))
                    throw error;
                throw codedError('large_file_upload_funding_failed', getErrorMessage(error), error);
            }
        },
    };
}
