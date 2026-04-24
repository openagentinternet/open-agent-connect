"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.postBuzzToChain = postBuzzToChain;
const uploadFile_1 = require("../files/uploadFile");
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeStringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter((entry) => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean);
}
async function postBuzzToChain(input) {
    const content = normalizeText(input.content);
    if (!content) {
        throw new Error('Buzz post requires non-empty content.');
    }
    const contentType = normalizeText(input.contentType) || 'text/plain;utf-8';
    const network = normalizeText(input.network) || 'mvc';
    const quotePin = normalizeText(input.quotePin);
    const attachmentPaths = normalizeStringArray(input.attachments);
    const uploadedFiles = [];
    for (const attachmentPath of attachmentPaths) {
        uploadedFiles.push(await (0, uploadFile_1.uploadLocalFileToChain)({
            filePath: attachmentPath,
            network,
            signer: input.signer,
        }));
    }
    const attachments = uploadedFiles.map((entry) => entry.metafileUri);
    const chainWrite = await input.signer.writePin({
        path: '/protocols/simplebuzz',
        payload: JSON.stringify({
            content,
            contentType,
            attachments,
            quotePin,
        }),
        contentType: 'application/json',
        network,
    });
    return {
        pinId: chainWrite.pinId,
        txids: chainWrite.txids,
        totalCost: chainWrite.totalCost,
        network: chainWrite.network,
        content,
        contentType,
        attachments,
        uploadedFiles,
        globalMetaId: chainWrite.globalMetaId,
    };
}
