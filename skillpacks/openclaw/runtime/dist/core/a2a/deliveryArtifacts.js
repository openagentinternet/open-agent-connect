"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inferDeliveryArtifactKind = inferDeliveryArtifactKind;
exports.parseMetafileUri = parseMetafileUri;
exports.extractDeliveryArtifactsFromText = extractDeliveryArtifactsFromText;
exports.normalizeDeliveryArtifacts = normalizeDeliveryArtifacts;
exports.buildDeliveryArtifactSummary = buildDeliveryArtifactSummary;
exports.appendDeliveryArtifactSummaries = appendDeliveryArtifactSummaries;
const metafileUrls_1 = require("../files/metafileUrls");
const IMAGE_EXTENSIONS = new Set([
    '.apng',
    '.avif',
    '.bmp',
    '.gif',
    '.heic',
    '.heif',
    '.jpeg',
    '.jpg',
    '.png',
    '.svg',
    '.webp',
]);
const VIDEO_EXTENSIONS = new Set(['.m4v', '.mov', '.mp4', '.webm']);
const AUDIO_EXTENSIONS = new Set(['.flac', '.m4a', '.mp3', '.ogg', '.wav']);
const TRAILING_TEXT_PUNCTUATION = /[)\]}`.,;:!?]+$/;
const METAFILE_URI_PATTERN = /metafile:\/\/[^\s<>"']+/gi;
const UNSAFE_METAFILE_URI_CHARACTER = /[\s\x00-\x1f\x7f]/;
const UNSAFE_CONTENT_TYPE_CHARACTER = /[\x00-\x1f\x7f]/;
const CONTENT_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(?: *; *[a-z0-9][a-z0-9!#$&^_.+-]*=[a-z0-9][a-z0-9!#$&^_.+:-]*)*$/i;
function normalizeExtension(extension) {
    const trimmed = String(extension || '').trim();
    if (!trimmed) {
        return null;
    }
    const withDot = trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
    return withDot.toLowerCase();
}
function extensionFromPath(path) {
    const fileName = path;
    const lastDot = fileName.lastIndexOf('.');
    if (lastDot <= 0 || lastDot === fileName.length - 1) {
        return null;
    }
    return normalizeExtension(fileName.slice(lastDot));
}
function pinIdFromPath(path, extension) {
    const fileName = path;
    const pinId = extension ? fileName.slice(0, -extension.length) : fileName;
    const trimmed = pinId.trim();
    return trimmed ? trimmed : null;
}
function stripTrailingTextPunctuation(value) {
    let normalized = value.trim();
    while (TRAILING_TEXT_PUNCTUATION.test(normalized)) {
        normalized = normalized.replace(TRAILING_TEXT_PUNCTUATION, '');
    }
    return normalized;
}
function valueAsTrimmedString(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}
function valueAsSafeFileName(value) {
    const trimmed = valueAsTrimmedString(value);
    if (!trimmed) {
        return null;
    }
    const normalized = trimmed.replace(/\\/g, '/');
    const fileName = normalized
        .split('/')
        .filter(Boolean)
        .pop()
        ?.split(/[?#]/, 1)[0];
    return fileName || null;
}
function valueAsByteLength(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return null;
    }
    return value;
}
function valueAsSafeContentType(value) {
    if (typeof value !== 'string' || UNSAFE_CONTENT_TYPE_CHARACTER.test(value)) {
        return null;
    }
    const trimmed = valueAsTrimmedString(value);
    if (!trimmed ||
        trimmed.startsWith('/') ||
        trimmed.startsWith('./') ||
        trimmed.startsWith('../') ||
        trimmed.includes('\\') ||
        trimmed.includes('://') ||
        /^[a-z]:/i.test(trimmed) ||
        !CONTENT_TYPE_PATTERN.test(trimmed)) {
        return null;
    }
    return trimmed.toLowerCase();
}
function normalizeStructuredDeliveryArtifact(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const entry = value;
    const base = parseMetafileUri(valueAsTrimmedString(entry.uri) || '');
    if (!base) {
        return null;
    }
    const contentType = valueAsSafeContentType(entry.contentType);
    const fileName = valueAsSafeFileName(entry.fileName) || base.fileName;
    return {
        uri: base.uri,
        pinId: base.pinId,
        kind: inferDeliveryArtifactKind(base.extension, contentType),
        fileName,
        extension: base.extension,
        contentType,
        byteLength: valueAsByteLength(entry.byteLength),
        sourceUrl: base.sourceUrl,
        fallbackUrl: base.fallbackUrl,
        downloadUrl: base.downloadUrl,
    };
}
function addDeliveryArtifact(artifacts, seen, artifact) {
    if (!artifact || seen.has(artifact.uri)) {
        return;
    }
    seen.add(artifact.uri);
    artifacts.push(artifact);
}
function inferDeliveryArtifactKind(extension, contentType) {
    const normalizedContentType = String(contentType || '').trim().toLowerCase();
    if (normalizedContentType.startsWith('image/')) {
        return 'image';
    }
    if (normalizedContentType.startsWith('video/')) {
        return 'video';
    }
    if (normalizedContentType.startsWith('audio/')) {
        return 'audio';
    }
    const normalizedExtension = normalizeExtension(extension);
    if (normalizedExtension && IMAGE_EXTENSIONS.has(normalizedExtension)) {
        return 'image';
    }
    if (normalizedExtension && VIDEO_EXTENSIONS.has(normalizedExtension)) {
        return 'video';
    }
    if (normalizedExtension && AUDIO_EXTENSIONS.has(normalizedExtension)) {
        return 'audio';
    }
    return 'file';
}
function parseMetafileUri(rawUri) {
    const uri = stripTrailingTextPunctuation(rawUri);
    if (!uri || UNSAFE_METAFILE_URI_CHARACTER.test(uri) || !uri.toLowerCase().startsWith('metafile://')) {
        return null;
    }
    const withoutScheme = uri.slice('metafile://'.length);
    const path = withoutScheme.split(/[?#]/, 1)[0] || '';
    if (!path || path.includes('/') || path.includes('\\')) {
        return null;
    }
    const extension = extensionFromPath(path);
    const pinId = pinIdFromPath(path, extension);
    if (!pinId) {
        return null;
    }
    const urls = (0, metafileUrls_1.buildMetafileContentUrls)(pinId);
    return {
        uri: `metafile://${pinId}${extension || ''}`,
        pinId,
        kind: inferDeliveryArtifactKind(extension),
        fileName: extension ? `${pinId}${extension}` : null,
        extension,
        contentType: null,
        byteLength: null,
        sourceUrl: urls.accelerateUrl,
        fallbackUrl: urls.contentUrl,
        downloadUrl: urls.accelerateUrl,
    };
}
function extractDeliveryArtifactsFromText(text) {
    const seen = new Set();
    const artifacts = [];
    for (const match of String(text || '').matchAll(METAFILE_URI_PATTERN)) {
        const artifact = parseMetafileUri(match[0]);
        if (!artifact || seen.has(artifact.uri)) {
            continue;
        }
        seen.add(artifact.uri);
        artifacts.push(artifact);
    }
    return artifacts;
}
function normalizeDeliveryArtifacts(input) {
    const seen = new Set();
    const artifacts = [];
    const source = input && typeof input === 'object' && !Array.isArray(input)
        ? input
        : {};
    const structuredArtifacts = Array.isArray(source.artifacts) ? source.artifacts : [];
    for (const entry of structuredArtifacts) {
        addDeliveryArtifact(artifacts, seen, normalizeStructuredDeliveryArtifact(entry));
    }
    if (typeof source.resultText === 'string') {
        for (const artifact of extractDeliveryArtifactsFromText(source.resultText)) {
            addDeliveryArtifact(artifacts, seen, artifact);
        }
    }
    return artifacts;
}
function buildDeliveryArtifactSummary(artifact) {
    const base = parseMetafileUri(valueAsTrimmedString(artifact.uri) || '');
    if (!base) {
        return '';
    }
    const fileName = valueAsSafeFileName(artifact.fileName) || base.fileName;
    const contentType = valueAsSafeContentType(artifact.contentType);
    const byteLength = valueAsByteLength(artifact.byteLength);
    const lines = [`Artifact: ${base.uri}`, `PINID: ${base.pinId}`];
    if (fileName) {
        lines.push(`File: ${fileName}`);
    }
    if (contentType) {
        lines.push(`Content-Type: ${contentType}`);
    }
    if (byteLength !== null) {
        lines.push(`Size: ${byteLength} bytes`);
    }
    if (base.downloadUrl) {
        lines.push(`Download: ${base.downloadUrl}`);
    }
    return lines.join('\n');
}
function hasDeliveryArtifactSummaryBlock(responseText, artifact) {
    const base = parseMetafileUri(valueAsTrimmedString(artifact.uri) || '');
    if (!base) {
        return false;
    }
    const artifactLine = `Artifact: ${base.uri}`;
    const pinIdLine = `PINID: ${base.pinId}`;
    let hasArtifactLine = false;
    let hasPinIdLine = false;
    const flushBlock = () => {
        const matched = hasArtifactLine && hasPinIdLine;
        hasArtifactLine = false;
        hasPinIdLine = false;
        return matched;
    };
    for (const rawLine of String(responseText || '').split('\n')) {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        if (!line.trim()) {
            if (flushBlock()) {
                return true;
            }
            continue;
        }
        if (line === artifactLine) {
            hasArtifactLine = true;
        }
        else if (line === pinIdLine) {
            hasPinIdLine = true;
        }
    }
    return flushBlock();
}
function appendDeliveryArtifactSummaries(responseText, artifacts) {
    if (!artifacts.length) {
        return responseText;
    }
    const summaries = artifacts
        .map((artifact) => ({
        artifact,
        summary: buildDeliveryArtifactSummary(artifact),
    }))
        .filter(({ artifact, summary }) => summary && !hasDeliveryArtifactSummaryBlock(responseText, artifact))
        .map(({ summary }) => summary);
    if (!summaries.length) {
        return responseText;
    }
    const summaryText = summaries.join('\n\n');
    if (!responseText) {
        return summaryText;
    }
    return `${responseText}\n\n${summaryText}`;
}
