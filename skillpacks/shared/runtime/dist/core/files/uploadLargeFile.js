"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LARGE_UPLOAD_MAX_BYTES = exports.MVC_SPONSOR_DIRECT_UPLOAD_MAX_BYTES = exports.FILE_UPLOAD_LARGE_DIRECT_MAX_BYTES = exports.DIRECT_UPLOAD_MAX_BYTES = void 0;
exports.uploadLargeFileToChain = uploadLargeFileToChain;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const metafileUrls_1 = require("./metafileUrls");
const metafileVerifier_1 = require("./metafileVerifier");
const uploadFile_1 = require("./uploadFile");
const mvcSponsorDirectUpload_1 = require("./mvcSponsorDirectUpload");
exports.DIRECT_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
exports.FILE_UPLOAD_LARGE_DIRECT_MAX_BYTES = 5 * 1024 * 1024;
exports.MVC_SPONSOR_DIRECT_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
exports.LARGE_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizePositiveBytes(value, fallback) {
    const normalized = Math.floor(Number(value));
    return Number.isFinite(normalized) && normalized >= 0 ? normalized : fallback;
}
async function statUploadFile(resolvedPath) {
    try {
        const stat = await node_fs_1.promises.stat(resolvedPath);
        if (!stat.isFile()) {
            throw new Error(`Large file upload requires a regular file named "${node_path_1.default.basename(resolvedPath)}".`);
        }
        return stat;
    }
    catch (error) {
        if (error instanceof Error && error.message.includes('regular file')) {
            throw error;
        }
        const code = error?.code;
        if (code === 'ENOENT') {
            throw new Error(`File not found for upload: "${node_path_1.default.basename(resolvedPath)}".`);
        }
        throw new Error(`Unable to access file for upload: "${node_path_1.default.basename(resolvedPath)}".`);
    }
}
function requireProviderString(value, fieldName) {
    const normalized = normalizeText(value);
    if (!normalized) {
        throw new Error(`Large file uploader returned an invalid ${fieldName}.`);
    }
    return normalized;
}
function requireProviderTxids(value) {
    if (!Array.isArray(value)) {
        throw new Error('Large file uploader returned invalid txids.');
    }
    return value.map((txid) => requireProviderString(txid, 'txid'));
}
function requireProviderTotalCost(value) {
    const totalCost = Number(value);
    if (!Number.isFinite(totalCost) || totalCost < 0) {
        throw new Error('Large file uploader returned an invalid totalCost.');
    }
    return totalCost;
}
async function maybeVerify(input) {
    if (input.verifyAvailability) {
        return input.verifyAvailability(input.pinId);
    }
    if (input.verify) {
        return (0, metafileVerifier_1.verifyMetafileAvailability)({ pinId: input.pinId });
    }
    return undefined;
}
function withCanonicalUrls(result) {
    const urls = (0, metafileUrls_1.buildMetafileContentUrls)(result.pinId);
    return {
        ...result,
        metawebUrl: (0, metafileUrls_1.buildMetafileBrowserUrl)(result.pinId),
        previewUrl: urls.previewUrl,
        downloadUrl: urls.downloadUrl,
    };
}
async function uploadLargeFileToChain(input) {
    const filePath = normalizeText(input.filePath);
    if (!filePath) {
        throw new Error('Large file upload requires a local filePath.');
    }
    const resolvedPath = node_path_1.default.resolve(filePath);
    const stat = await statUploadFile(resolvedPath);
    const network = normalizeText(input.network) || 'mvc';
    if (network.toLowerCase() === 'doge') {
        throw new Error('DOGE is not supported for file upload. Use mvc, btc, or opcat.');
    }
    const directMaxBytes = normalizePositiveBytes(input.directMaxBytes, exports.DIRECT_UPLOAD_MAX_BYTES);
    const sponsorDirectMaxBytes = normalizePositiveBytes(input.sponsorDirectMaxBytes, exports.MVC_SPONSOR_DIRECT_UPLOAD_MAX_BYTES);
    const hardMaxBytes = normalizePositiveBytes(input.hardMaxBytes, exports.LARGE_UPLOAD_MAX_BYTES);
    if (stat.size > hardMaxBytes) {
        throw new Error(`File exceeds maximum upload size of ${hardMaxBytes} bytes.`);
    }
    const extension = node_path_1.default.extname(resolvedPath).toLowerCase();
    const contentType = normalizeText(input.contentType) || (0, uploadFile_1.inferUploadContentType)(resolvedPath);
    if (stat.size <= directMaxBytes) {
        const directResult = network.toLowerCase() === 'mvc'
            && input.mvcSponsorClient
            && stat.size <= sponsorDirectMaxBytes
            ? await (0, mvcSponsorDirectUpload_1.uploadMvcSponsorDirectFile)({
                filePath: resolvedPath,
                fileName: node_path_1.default.basename(resolvedPath),
                contentType,
                bytes: stat.size,
                extension,
                network,
                signer: input.signer,
                mvcSponsorClient: input.mvcSponsorClient,
            })
            : await (0, uploadFile_1.uploadLocalFileToChain)({
                filePath: resolvedPath,
                contentType,
                network,
                signer: input.signer,
            });
        const result = withCanonicalUrls({
            ...directResult,
            uploadMode: 'direct',
        });
        const verification = await maybeVerify({
            pinId: result.pinId,
            verify: input.verify,
            verifyAvailability: input.verifyAvailability,
        });
        return verification ? { ...result, verification } : result;
    }
    if (network.toLowerCase() !== 'mvc') {
        throw new Error('Large file upload currently supports MVC only.');
    }
    if (!input.largeUploader) {
        const error = new Error('large_file_upload_unavailable: Large file upload requires an injected largeUploader.');
        error.code = 'large_file_upload_unavailable';
        throw error;
    }
    const largeResult = await input.largeUploader.upload({
        filePath: resolvedPath,
        fileName: node_path_1.default.basename(resolvedPath),
        contentType,
        bytes: stat.size,
        extension,
        network,
        signer: input.signer,
    });
    const result = withCanonicalUrls({
        pinId: requireProviderString(largeResult.pinId, 'pinId'),
        txids: requireProviderTxids(largeResult.txids),
        totalCost: requireProviderTotalCost(largeResult.totalCost),
        network,
        fileName: node_path_1.default.basename(resolvedPath),
        contentType,
        bytes: stat.size,
        extension,
        metafileUri: requireProviderString(largeResult.metafileUri, 'metafileUri'),
        globalMetaId: requireProviderString(largeResult.globalMetaId, 'globalMetaId'),
        uploadMode: 'chunked',
    });
    const verification = await maybeVerify({
        pinId: result.pinId,
        verify: input.verify,
        verifyAvailability: input.verifyAvailability,
    });
    return verification ? { ...result, verification } : result;
}
