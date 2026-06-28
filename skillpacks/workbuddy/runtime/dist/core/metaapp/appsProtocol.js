"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.METAAPP_CODE_TYPE_OPTIONS = exports.METAAPP_CONTENT_TYPE_OPTIONS = exports.METAAPP_RUNTIME_OPTIONS = exports.METAAPP_PIN_ID_PATTERN = void 0;
exports.normalizeMetafileReference = normalizeMetafileReference;
exports.normalizeMetafileReferenceList = normalizeMetafileReferenceList;
exports.normalizeMetaAppImageReference = normalizeMetaAppImageReference;
exports.normalizeMetaAppImageReferenceList = normalizeMetaAppImageReferenceList;
exports.serializeMetaAppRuntime = serializeMetaAppRuntime;
exports.buildMetaAppProtocolPayload = buildMetaAppProtocolPayload;
exports.buildMetaAppCreateWrite = buildMetaAppCreateWrite;
exports.buildMetaAppModifyWrite = buildMetaAppModifyWrite;
exports.buildMetaAppRevokeWrite = buildMetaAppRevokeWrite;
exports.metaAppFormFailure = metaAppFormFailure;
exports.metaAppFormSuccess = metaAppFormSuccess;
const commandResult_1 = require("../contracts/commandResult");
exports.METAAPP_PIN_ID_PATTERN = /^[0-9a-f]{64}i0$/i;
exports.METAAPP_RUNTIME_OPTIONS = ['browser', 'android', 'ios', 'windows', 'macOS', 'linux'];
exports.METAAPP_CONTENT_TYPE_OPTIONS = [
    'application/zip',
    'application/x-tar',
    'application/x-7z-compressed',
    'application/x-rar-compressed',
    'application/gzip',
    'application/json',
    'application/xml',
    'text/plain',
    'text/html',
    'text/css',
    'application/javascript',
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/svg+xml',
    'image/webp',
    'video/mp4',
    'video/webm',
    'audio/mpeg',
    'audio/wav',
    'application/octet-stream',
];
exports.METAAPP_CODE_TYPE_OPTIONS = [
    'application/zip',
    'application/x-tar',
    'application/x-7z-compressed',
    'application/x-rar-compressed',
    'application/gzip',
    'application/json',
    'application/xml',
    'text/html',
    'text/css',
    'application/javascript',
];
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function stripMetafilePrefix(value) {
    return value.toLowerCase().startsWith('metafile://')
        ? value.slice('metafile://'.length)
        : value;
}
function isHttpUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    }
    catch {
        return false;
    }
}
function normalizeMetafileReference(value, fieldName) {
    const raw = normalizeText(value);
    const pinId = stripMetafilePrefix(raw).trim();
    if (!exports.METAAPP_PIN_ID_PATTERN.test(pinId)) {
        throw new Error(`${fieldName} must be a MetaID pin id or metafile:// pin id.`);
    }
    return `metafile://${pinId}`;
}
function normalizeMetafileReferenceList(value, fieldName) {
    const values = Array.isArray(value)
        ? value
        : normalizeText(value).split(/[\n,]/u);
    return values
        .map((item) => normalizeText(item))
        .filter(Boolean)
        .map((item) => normalizeMetafileReference(item, fieldName));
}
function normalizeMetaAppImageReference(value, fieldName) {
    const raw = normalizeText(value);
    if (isHttpUrl(raw))
        return raw;
    return normalizeMetafileReference(raw, fieldName);
}
function normalizeMetaAppImageReferenceList(value, fieldName) {
    const values = Array.isArray(value)
        ? value
        : normalizeText(value).split(/[\n,]/u);
    return values
        .map((item) => normalizeText(item))
        .filter(Boolean)
        .map((item) => normalizeMetaAppImageReference(item, fieldName));
}
function serializeMetaAppRuntime(value) {
    const values = Array.isArray(value)
        ? value.map((item) => normalizeText(item))
        : normalizeText(value).split('/').map((item) => item.trim());
    const allowed = new Set(exports.METAAPP_RUNTIME_OPTIONS);
    const nonEmpty = values.filter(Boolean);
    const unsupported = nonEmpty.filter((item) => !allowed.has(item));
    if (unsupported.length > 0) {
        const uniqueUnsupported = [...new Set(unsupported)];
        throw new Error(uniqueUnsupported.length === 1
            ? `runtime contains unsupported value: ${uniqueUnsupported[0]}.`
            : `runtime contains unsupported values: ${uniqueUnsupported.join(', ')}.`);
    }
    const selected = nonEmpty.filter((item) => allowed.has(item));
    if (selected.length === 0) {
        throw new Error('runtime requires at least one supported runtime.');
    }
    return [...new Set(selected)].join('/');
}
function normalizeOption(value, fieldName, allowedValues, fallback) {
    const text = normalizeText(value);
    if (!text)
        return fallback;
    if (!allowedValues.includes(text)) {
        throw new Error(`${fieldName} must be one of: ${allowedValues.join(', ')}.`);
    }
    return text;
}
function normalizeTags(value) {
    const values = Array.isArray(value)
        ? value
        : normalizeText(value).split(',');
    return [...new Set(values.map((item) => normalizeText(item)).filter(Boolean))];
}
function normalizeMetadata(value) {
    if (!value)
        return undefined;
    if (typeof value === 'object' && !Array.isArray(value)) {
        return value;
    }
    const text = normalizeText(value);
    if (!text)
        return undefined;
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('metadata must be a JSON object.');
    }
    return parsed;
}
function normalizeOptionalMetafile(value, fieldName) {
    return normalizeText(value) ? normalizeMetafileReference(value, fieldName) : undefined;
}
function buildMetaAppProtocolPayload(input) {
    const title = normalizeText(input.title);
    const appName = normalizeText(input.appName);
    if (!title)
        throw new Error('title is required.');
    if (!appName)
        throw new Error('appName is required.');
    return {
        title,
        appName,
        prompt: normalizeText(input.prompt) || undefined,
        icon: normalizeMetaAppImageReference(input.icon, 'icon'),
        coverImg: normalizeMetaAppImageReference(input.coverImg, 'coverImg'),
        introImgs: normalizeMetaAppImageReferenceList(input.introImgs, 'introImgs'),
        intro: normalizeText(input.intro) || undefined,
        runtime: serializeMetaAppRuntime(input.runtime),
        version: normalizeText(input.version) || undefined,
        contentType: normalizeOption(input.contentType, 'contentType', exports.METAAPP_CONTENT_TYPE_OPTIONS, 'application/zip'),
        content: normalizeOptionalMetafile(input.content, 'content'),
        indexFile: normalizeText(input.indexFile) || undefined,
        code: normalizeOptionalMetafile(input.code, 'code'),
        contentHash: normalizeText(input.contentHash) || undefined,
        metadata: normalizeMetadata(input.metadata),
        tags: normalizeTags(input.tags),
        disabled: input.disabled === true,
        codeType: normalizeOption(input.codeType, 'codeType', exports.METAAPP_CODE_TYPE_OPTIONS, undefined),
    };
}
function buildMetaAppCreateWrite(payload) {
    return {
        operation: 'create',
        path: '/protocols/metaapp',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
    };
}
function buildMetaAppModifyWrite(targetPinId, payload) {
    if (!exports.METAAPP_PIN_ID_PATTERN.test(targetPinId)) {
        throw new Error('targetPinId must be a MetaID pin id.');
    }
    return {
        operation: 'modify',
        path: `@${targetPinId}`,
        contentType: 'application/json',
        payload: JSON.stringify(payload),
    };
}
function buildMetaAppRevokeWrite(targetPinId) {
    if (!exports.METAAPP_PIN_ID_PATTERN.test(targetPinId)) {
        throw new Error('targetPinId must be a MetaID pin id.');
    }
    return {
        operation: 'revoke',
        path: `@${targetPinId}`,
    };
}
function metaAppFormFailure(error) {
    return (0, commandResult_1.commandFailed)('metaapp_apps_form_invalid', error instanceof Error ? error.message : String(error));
}
function metaAppFormSuccess(data) {
    return (0, commandResult_1.commandSuccess)(data);
}
