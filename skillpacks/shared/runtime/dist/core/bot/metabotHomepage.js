"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeMetabotHomepage = normalizeMetabotHomepage;
exports.sameMetabotHomepage = sameMetabotHomepage;
exports.readMetabotHomepage = readMetabotHomepage;
exports.writeMetabotHomepage = writeMetabotHomepage;
exports.serializeMetabotHomepagePayload = serializeMetabotHomepagePayload;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const metafileUri_1 = require("../files/metafileUri");
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeRenderer(value, uri) {
    const renderer = normalizeText(value).toLowerCase();
    if (renderer === 'metaapp')
        return 'metaapp';
    if (renderer === 'auto')
        return 'auto';
    return uri.toLowerCase().startsWith('metaapp://') ? 'metaapp' : 'auto';
}
function defaultContentType(uri, renderer) {
    if (renderer === 'metaapp' || uri.toLowerCase().startsWith('metaapp://')) {
        return 'application/vnd.metaapp';
    }
    return 'application/octet-stream';
}
function validateHomepageUri(uri) {
    if (!uri) {
        throw new Error('Homepage uri is required.');
    }
    if (!/^metafile:\/\/\S+$/iu.test(uri) && !/^metaapp:\/\/\S+$/iu.test(uri)) {
        throw new Error('Homepage uri must start with metafile:// or metaapp:// and must not contain whitespace.');
    }
}
function withRecommendedMetafileExtension(homepage) {
    const extension = (0, metafileUri_1.extensionFromContentType)(homepage.contentType);
    if (!extension || !homepage.uri.toLowerCase().startsWith('metafile://')) {
        return homepage;
    }
    const uri = (0, metafileUri_1.appendMetafileUriExtension)(homepage.uri, extension);
    return uri === homepage.uri ? homepage : { ...homepage, uri };
}
function normalizeMetabotHomepage(value) {
    if (value === undefined)
        return undefined;
    if (value === null)
        return null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Homepage must be an object with uri, renderer, and contentType.');
    }
    const record = value;
    const uri = normalizeText(record.uri);
    validateHomepageUri(uri);
    const renderer = normalizeRenderer(record.renderer, uri);
    const contentType = normalizeText(record.contentType) || defaultContentType(uri, renderer);
    return withRecommendedMetafileExtension({ uri, renderer, contentType });
}
function sameMetabotHomepage(left, right) {
    if (!left && !right)
        return true;
    if (!left || !right)
        return false;
    return left.uri === right.uri
        && left.renderer === right.renderer
        && left.contentType === right.contentType;
}
async function readMetabotHomepage(filePath) {
    let raw = '';
    try {
        raw = await node_fs_1.promises.readFile(filePath, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return undefined;
        }
        throw error;
    }
    const trimmed = raw.trim();
    if (!trimmed)
        return undefined;
    try {
        return normalizeMetabotHomepage(JSON.parse(trimmed)) ?? undefined;
    }
    catch {
        return undefined;
    }
}
async function writeMetabotHomepage(filePath, homepage) {
    await node_fs_1.promises.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
    await node_fs_1.promises.writeFile(filePath, `${JSON.stringify(homepage, null, 2)}\n`, 'utf8');
}
function serializeMetabotHomepagePayload(homepage) {
    return JSON.stringify(withRecommendedMetafileExtension(homepage));
}
