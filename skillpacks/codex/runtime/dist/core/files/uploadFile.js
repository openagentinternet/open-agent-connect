"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.inferUploadContentType = inferUploadContentType;
exports.uploadFileBufferToChain = uploadFileBufferToChain;
exports.uploadLocalFileToChain = uploadLocalFileToChain;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const metafileUri_1 = require("./metafileUri");
const MIME_MAP = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
    '.gz': 'application/gzip',
    '.tar': 'application/x-tar',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.md': 'text/markdown',
    '.csv': 'text/csv',
};
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function inferUploadContentType(filePath) {
    return MIME_MAP[node_path_1.default.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}
function inferMetafileExtension(fileExtension, contentType) {
    return (0, metafileUri_1.extensionFromContentType)(contentType) ?? (0, metafileUri_1.safeMetafileExtension)(fileExtension) ?? '';
}
async function uploadFileBufferToChain(input) {
    const fileName = node_path_1.default.basename(normalizeText(input.fileName) || 'upload.bin');
    const contentType = normalizeText(input.contentType) || inferUploadContentType(fileName);
    const extension = inferMetafileExtension(node_path_1.default.extname(fileName).toLowerCase(), contentType);
    const network = normalizeText(input.network) || 'mvc';
    if (network.toLowerCase() === 'doge') {
        throw new Error('DOGE is not supported for file upload. Use mvc, btc, or opcat.');
    }
    if (!input.data.length) {
        throw new Error('File upload requires non-empty file data.');
    }
    const chainWrite = await input.signer.writePin({
        path: '/file',
        payload: input.data,
        contentType,
        encoding: 'binary',
        network,
    });
    return {
        pinId: chainWrite.pinId,
        txids: chainWrite.txids,
        totalCost: chainWrite.totalCost,
        network: chainWrite.network,
        filePath: fileName,
        fileName,
        contentType,
        bytes: input.data.byteLength,
        extension,
        metafileUri: `metafile://${chainWrite.pinId}${extension}`,
        globalMetaId: chainWrite.globalMetaId,
    };
}
async function uploadLocalFileToChain(input) {
    const filePath = normalizeText(input.filePath);
    if (!filePath) {
        throw new Error('File upload requires a local filePath.');
    }
    const resolvedPath = node_path_1.default.resolve(filePath);
    const buffer = await node_fs_1.promises.readFile(resolvedPath);
    const contentType = normalizeText(input.contentType) || inferUploadContentType(resolvedPath);
    const extension = inferMetafileExtension(node_path_1.default.extname(resolvedPath).toLowerCase(), contentType);
    const network = normalizeText(input.network) || 'mvc';
    if (network.toLowerCase() === 'doge') {
        throw new Error('DOGE is not supported for file upload. Use mvc, btc, or opcat.');
    }
    const chainWrite = await input.signer.writePin({
        path: '/file',
        payload: buffer,
        contentType,
        encoding: 'binary',
        network,
    });
    return {
        pinId: chainWrite.pinId,
        txids: chainWrite.txids,
        totalCost: chainWrite.totalCost,
        network: chainWrite.network,
        filePath: resolvedPath,
        fileName: node_path_1.default.basename(resolvedPath),
        contentType,
        bytes: buffer.byteLength,
        extension,
        metafileUri: `metafile://${chainWrite.pinId}${extension}`,
        globalMetaId: chainWrite.globalMetaId,
    };
}
