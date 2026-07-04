"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProviderDeliveryArtifactError = void 0;
exports.classifyProviderOutputType = classifyProviderOutputType;
exports.isTextLikeProviderOutputType = isTextLikeProviderOutputType;
exports.resolveProviderDeliveryArtifacts = resolveProviderDeliveryArtifacts;
const node_fs_1 = require("node:fs");
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const deliveryArtifacts_1 = require("../deliveryArtifacts");
const metafileUri_1 = require("../../files/metafileUri");
const metafileUrls_1 = require("../../files/metafileUrls");
const metafileVerifier_1 = require("../../files/metafileVerifier");
const uploadLargeFile_1 = require("../../files/uploadLargeFile");
const uploadFile_1 = require("../../files/uploadFile");
const PROVIDER_ARTIFACT_MARKER_PATTERN = /^\s*(artifactPath|filePath|outputFile|outputPath|attachment)\s*:\s*(.+?)\s*$/i;
const UNSAFE_STRUCTURED_METADATA_CHARACTER = /[\x00-\x1f\x7f]/;
const SAFE_CONTENT_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(?: *; *[a-z0-9][a-z0-9!#$&^_.+-]*=[a-z0-9][a-z0-9!#$&^_.+:-]*)*$/i;
class ProviderDeliveryArtifactError extends Error {
    code;
    data;
    constructor(code, message, data) {
        super(`${code}: ${message}`);
        this.name = 'ProviderDeliveryArtifactError';
        this.code = code;
        if (data) {
            this.data = data;
        }
    }
}
exports.ProviderDeliveryArtifactError = ProviderDeliveryArtifactError;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function readUploadFailureData(error) {
    const data = error?.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return undefined;
    }
    const feeAssist = data.feeAssist;
    if (!feeAssist || typeof feeAssist !== 'object' || Array.isArray(feeAssist)) {
        return undefined;
    }
    return {
        feeAssist: feeAssist,
    };
}
function providerArtifactError(code, message, data) {
    return new ProviderDeliveryArtifactError(code, message, data);
}
function classifyProviderOutputType(outputType) {
    const normalized = normalizeText(outputType).toLowerCase();
    if (!normalized || normalized === 'text' || normalized === 'markdown') {
        return 'text';
    }
    if (normalized === 'image' || normalized.startsWith('image/')) {
        return 'image';
    }
    if (normalized === 'video' || normalized.startsWith('video/')) {
        return 'video';
    }
    if (normalized === 'audio' || normalized.startsWith('audio/')) {
        return 'audio';
    }
    return 'file';
}
function isTextLikeProviderOutputType(outputType) {
    return classifyProviderOutputType(outputType) === 'text';
}
function validateArtifactFamily(artifact, expectedFamily) {
    if (expectedFamily === 'text' || expectedFamily === 'file') {
        return;
    }
    if (artifact.kind !== expectedFamily) {
        throw providerArtifactError('provider_artifact_type_mismatch', `Expected a ${expectedFamily} artifact but resolved ${artifact.kind}.`);
    }
}
async function verifyReusableMetafile(artifact, verifyAvailability) {
    try {
        const verification = verifyAvailability
            ? await verifyAvailability(artifact.pinId)
            : await (0, metafileVerifier_1.verifyMetafileAvailability)({ pinId: artifact.pinId });
        if (!verification?.ok) {
            throw providerArtifactError('provider_artifact_unavailable', verification?.error || 'Metafile artifact is not available through the file indexer.');
        }
    }
    catch (error) {
        if (error instanceof ProviderDeliveryArtifactError) {
            throw error;
        }
        throw providerArtifactError('provider_artifact_unavailable', error instanceof Error ? error.message : 'Metafile artifact availability verification failed.');
    }
}
async function resolveExistingMetafileArtifacts(input) {
    const artifacts = (0, deliveryArtifacts_1.extractDeliveryArtifactsFromText)(input.responseText);
    if (!artifacts.length) {
        return [];
    }
    assertNoAbsoluteProviderLocalHints(input.responseText);
    for (const artifact of artifacts) {
        validateArtifactFamily(artifact, input.expectedFamily);
        await verifyReusableMetafile(artifact, input.verifyAvailability);
    }
    return artifacts;
}
function trimCandidatePath(value) {
    return value
        .trim()
        .replace(/^["'`]+/, '')
        .replace(/["'`]+$/, '')
        .trim();
}
function extractMarkerCandidates(responseText) {
    const candidates = [];
    const lines = String(responseText || '').split(/\r?\n/);
    lines.forEach((line, index) => {
        const match = PROVIDER_ARTIFACT_MARKER_PATTERN.exec(line);
        if (!match) {
            return;
        }
        const filePath = trimCandidatePath(match[2]);
        if (filePath) {
            candidates.push({ filePath, lineIndexes: [index] });
        }
    });
    return candidates;
}
function isPublicProviderArtifactReference(value) {
    const trimmed = trimCandidatePath(value);
    return trimmed.toLowerCase().startsWith('metafile://')
        || /^https?:\/\//i.test(trimmed);
}
function redactPublicArtifactReferences(value) {
    return String(value || '').replace(/\b(?:metafile:\/\/[^\s,;)\]}>"'`]+|https?:\/\/[^\s,;)\]}>"'`]+)/gi, '[public artifact]');
}
function stripProviderOnlyLocalHintLines(responseText) {
    return String(responseText || '')
        .split(/\r?\n/)
        .filter((line) => {
        const markerMatch = PROVIDER_ARTIFACT_MARKER_PATTERN.exec(line);
        if (markerMatch) {
            return isPublicProviderArtifactReference(markerMatch[2]);
        }
        const trimmed = trimCandidatePath(line);
        return !isSecretLikeFileName(trimmed);
    })
        .join('\n')
        .trim();
}
function looksLikeLocalPathLine(value) {
    const trimmed = trimCandidatePath(value);
    if (!trimmed || /\s/.test(trimmed) || /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
        return false;
    }
    if (trimmed.toLowerCase().startsWith('metafile://')) {
        return false;
    }
    if (isSecretLikeFileName(trimmed)) {
        return true;
    }
    return trimmed.startsWith('./')
        || trimmed.startsWith('../')
        || trimmed.startsWith('/')
        || /^[A-Za-z0-9_.-]+[\\/]/.test(trimmed);
}
async function extractExistingBarePathCandidates(responseText, executionCwd) {
    const candidates = [];
    const lines = String(responseText || '').split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
        const filePath = trimCandidatePath(lines[index]);
        if (!looksLikeLocalPathLine(filePath)) {
            continue;
        }
        if (isSecretLikeFileName(filePath)) {
            throw providerArtifactError('provider_artifact_secret_rejected', 'Provider artifact path looks like a secret file and cannot be delivered.');
        }
        const absolutePath = node_path_1.default.isAbsolute(filePath)
            ? filePath
            : node_path_1.default.resolve(executionCwd, filePath);
        try {
            const stat = await node_fs_1.promises.stat(absolutePath);
            if (stat.isFile()) {
                candidates.push({ filePath, lineIndexes: [index] });
            }
        }
        catch {
            continue;
        }
    }
    return candidates;
}
function isSecretLikeFileName(filePath) {
    const normalizedPath = filePath.replace(/[\\/]+/g, '/');
    const lowerPath = normalizedPath.toLowerCase();
    const segments = lowerPath.split('/').filter(Boolean);
    const base = node_path_1.default.basename(lowerPath);
    const extension = node_path_1.default.extname(base);
    const stem = extension ? base.slice(0, -extension.length) : base;
    const compact = base.replace(/[\s._-]+/g, '');
    const compactStem = stem.replace(/[\s._-]+/g, '');
    const compactPath = lowerPath.replace(/[\s._/-]+/g, '');
    const parent = segments.length > 1 ? segments[segments.length - 2] : '';
    const secretStems = new Set([
        'apikey',
        'apitoken',
        'authkey',
        'authtoken',
        'bearertoken',
        'clientsecret',
        'credential',
        'credentials',
        'keyfile',
        'password',
        'passwd',
        'secret',
        'token',
    ]);
    const secretFileNames = new Set([
        'api-key.json',
        'apikey.json',
        'api_key.json',
        'auth-token.json',
        'authtoken.json',
        'credentials.json',
        'password.txt',
        'secret.txt',
        'token.txt',
    ]);
    const configDirectorySecretNames = new Set([
        ...secretFileNames,
        'config.json',
        'settings.json',
    ]);
    return base === '.env'
        || base.startsWith('.env.')
        || base === '.npmrc'
        || base === '.pypirc'
        || base === '.netrc'
        || base === '.dockerconfigjson'
        || (parent === '.aws' && base === 'credentials')
        || parent === '.ssh'
        || base === 'id_rsa'
        || base.startsWith('id_rsa.')
        || base === 'id_ed25519'
        || base.startsWith('id_ed25519.')
        || base === 'id_dsa'
        || base.startsWith('id_dsa.')
        || base === 'id_ecdsa'
        || base.startsWith('id_ecdsa.')
        || base === 'wallet.json'
        || compact === 'walletjson'
        || secretStems.has(compactStem)
        || secretFileNames.has(base)
        || (segments.includes('.config') && configDirectorySecretNames.has(base))
        || compact.includes('privatekey')
        || compact.includes('mnemonic')
        || compact.includes('seedphrase')
        || compact.includes('accesstoken')
        || compact.includes('authtoken')
        || compactPath.includes('awscredentials')
        || compactPath.includes('privatekey')
        || compactPath.includes('seedphrase');
}
function hasHiddenDirectorySegment(filePath) {
    const segments = filePath.replace(/[\\/]+/g, '/').split('/').filter(Boolean);
    const directorySegments = segments.slice(0, -1);
    return directorySegments.some((segment) => segment !== '.' && segment !== '..' && segment.startsWith('.'));
}
function isRejectedProviderLocalHintPath(filePath) {
    return isSecretLikeFileName(filePath) || hasHiddenDirectorySegment(filePath);
}
function throwProviderSecretRejected() {
    throw providerArtifactError('provider_artifact_secret_rejected', 'Provider artifact path looks like a secret file and cannot be delivered.');
}
function looksLikeInlineFileHint(value) {
    const normalized = value.replace(/[\\/]+/g, '/');
    const base = node_path_1.default.basename(normalized);
    return normalized.includes('/')
        || value.includes('\\')
        || base.startsWith('.')
        || node_path_1.default.extname(base) !== '';
}
function absoluteProviderLocalHintPatterns() {
    return [
        /\bfile:[^\s,;)\]}>"'`]+/gi,
        /(?<![A-Za-z0-9_.:/\\-])\\\\[^\\/\s,;)\]}>"'`]+[\\/][^\s,;)\]}>"'`]+/g,
        /(?<![A-Za-z0-9_.:/\\-])[A-Za-z]:(?!\/\/)[^\s,;)\]}>"'`]+/g,
        /(?<![A-Za-z0-9_.:/\\-])\/[^\s,;)\]}>"'`]+/g,
    ];
}
function assertNoAbsoluteSecretLikeProviderHints(responseText) {
    const redactedText = redactPublicArtifactReferences(responseText);
    for (const pathHintPattern of absoluteProviderLocalHintPatterns()) {
        const matches = redactedText.matchAll(pathHintPattern);
        for (const match of matches) {
            if (isRejectedProviderLocalHintPath(match[0])) {
                throwProviderSecretRejected();
            }
        }
    }
}
function assertNoAbsoluteProviderLocalHints(responseText) {
    const redactedText = redactPublicArtifactReferences(responseText);
    for (const pathHintPattern of absoluteProviderLocalHintPatterns()) {
        if (pathHintPattern.test(redactedText)) {
            throwProviderSecretRejected();
        }
    }
}
function assertNoInlineSecretLikeProviderHints(responseText) {
    assertNoAbsoluteSecretLikeProviderHints(responseText);
    const redactedText = redactPublicArtifactReferences(responseText);
    const hintPattern = /(?<![A-Za-z0-9_./\\:-])(?:\.{1,2}[\\/])?(?:(?:\.?[A-Za-z0-9_-]+)[\\/])*(?:\.?[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)(?![A-Za-z0-9_/\\:-])/g;
    const matches = redactedText.matchAll(hintPattern);
    for (const match of matches) {
        const candidate = match[0];
        if (looksLikeInlineFileHint(candidate) && isRejectedProviderLocalHintPath(candidate)) {
            throwProviderSecretRejected();
        }
    }
}
function assertNoSecretLikeProviderLocalHints(responseText) {
    const lines = String(responseText || '').split(/\r?\n/);
    for (const line of lines) {
        const markerMatch = PROVIDER_ARTIFACT_MARKER_PATTERN.exec(line);
        if (markerMatch) {
            const markerPath = trimCandidatePath(markerMatch[2]);
            if (!isPublicProviderArtifactReference(markerPath) && isRejectedProviderLocalHintPath(markerPath)) {
                throwProviderSecretRejected();
            }
            continue;
        }
        const candidatePath = trimCandidatePath(line);
        if (looksLikeLocalPathLine(candidatePath) && isRejectedProviderLocalHintPath(candidatePath)) {
            throwProviderSecretRejected();
        }
    }
    assertNoInlineSecretLikeProviderHints(responseText);
}
function containsPath(root, candidate) {
    const relative = node_path_1.default.relative(root, candidate);
    return relative === '' || (!relative.startsWith('..') && !node_path_1.default.isAbsolute(relative));
}
function addPathScrubVariant(paths, value) {
    const trimmed = normalizeText(value);
    if (!trimmed) {
        return;
    }
    paths.add(trimmed);
    paths.add(trimmed.split(node_path_1.default.sep).join('/'));
    paths.add(trimmed.split(node_path_1.default.sep).join('\\'));
}
async function resolveWorkspaceDirectory(inputPath) {
    const normalized = normalizeText(inputPath);
    if (!normalized) {
        throw providerArtifactError('provider_artifact_workspace_required', 'Provider artifact resolution requires an execution workspace.');
    }
    try {
        const realPath = await node_fs_1.promises.realpath(node_path_1.default.resolve(normalized));
        const stat = await node_fs_1.promises.stat(realPath);
        if (!stat.isDirectory()) {
            throw new Error('workspace is not a directory');
        }
        return realPath;
    }
    catch {
        throw providerArtifactError('provider_artifact_workspace_required', 'Provider artifact resolution requires a readable execution workspace.');
    }
}
async function resolveLocalCandidate(input) {
    const candidatePath = trimCandidatePath(input.candidate.filePath);
    if (!candidatePath) {
        throw providerArtifactError('provider_artifact_missing', 'Provider artifact path is empty.');
    }
    if (isSecretLikeFileName(candidatePath)) {
        throw providerArtifactError('provider_artifact_secret_rejected', 'Provider artifact path looks like a secret file and cannot be delivered.');
    }
    if (hasHiddenDirectorySegment(candidatePath)) {
        throw providerArtifactError('provider_artifact_secret_rejected', 'Provider artifact path looks like a secret file and cannot be delivered.');
    }
    const absoluteCandidatePath = node_path_1.default.isAbsolute(candidatePath)
        ? node_path_1.default.resolve(candidatePath)
        : node_path_1.default.resolve(input.executionCwd, candidatePath);
    let realCandidatePath;
    try {
        realCandidatePath = await node_fs_1.promises.realpath(absoluteCandidatePath);
    }
    catch {
        throw providerArtifactError('provider_artifact_missing', 'Provider artifact file was not found.');
    }
    if (!containsPath(input.executionCwd, realCandidatePath)) {
        throw providerArtifactError('provider_artifact_outside_workspace', 'Provider artifact path resolves outside the execution workspace.');
    }
    if (!containsPath(input.workspaceRootCwd, realCandidatePath)) {
        throw providerArtifactError('provider_artifact_outside_workspace', 'Provider artifact path resolves outside the provider attempt workspace.');
    }
    const relativeSecretCheckPath = node_path_1.default.relative(input.executionCwd, realCandidatePath);
    if (isSecretLikeFileName(relativeSecretCheckPath)) {
        throw providerArtifactError('provider_artifact_secret_rejected', 'Provider artifact path looks like a secret file and cannot be delivered.');
    }
    if (hasHiddenDirectorySegment(relativeSecretCheckPath)) {
        throw providerArtifactError('provider_artifact_secret_rejected', 'Provider artifact path looks like a secret file and cannot be delivered.');
    }
    const fileName = node_path_1.default.basename(realCandidatePath);
    const stat = await node_fs_1.promises.stat(realCandidatePath);
    if (!stat.isFile()) {
        throw providerArtifactError('provider_artifact_missing', 'Provider artifact must be a regular file.');
    }
    if (stat.size > uploadLargeFile_1.LARGE_UPLOAD_MAX_BYTES) {
        throw providerArtifactError('provider_artifact_too_large', `Provider artifact exceeds the maximum upload size of ${uploadLargeFile_1.LARGE_UPLOAD_MAX_BYTES} bytes.`);
    }
    const extension = node_path_1.default.extname(realCandidatePath).toLowerCase() || null;
    const contentType = (0, uploadFile_1.inferUploadContentType)(realCandidatePath);
    const kind = (0, deliveryArtifacts_1.inferDeliveryArtifactKind)(extension, contentType);
    validateArtifactFamily({ uri: `file://${fileName}`, kind }, input.expectedFamily);
    const scrubPaths = new Set();
    addPathScrubVariant(scrubPaths, input.executionCwd);
    addPathScrubVariant(scrubPaths, input.workspaceRootCwd);
    addPathScrubVariant(scrubPaths, input.requestedExecutionCwd);
    addPathScrubVariant(scrubPaths, input.requestedWorkspaceRootCwd);
    addPathScrubVariant(scrubPaths, candidatePath);
    addPathScrubVariant(scrubPaths, absoluteCandidatePath);
    addPathScrubVariant(scrubPaths, realCandidatePath);
    const relativeCandidatePath = node_path_1.default.relative(input.executionCwd, realCandidatePath);
    addPathScrubVariant(scrubPaths, relativeCandidatePath);
    addPathScrubVariant(scrubPaths, relativeCandidatePath ? `.${node_path_1.default.sep}${relativeCandidatePath}` : null);
    addPathScrubVariant(scrubPaths, relativeCandidatePath
        ? node_path_1.default.join(input.requestedExecutionCwd, relativeCandidatePath)
        : null);
    addPathScrubVariant(scrubPaths, node_path_1.default.dirname(absoluteCandidatePath));
    addPathScrubVariant(scrubPaths, node_path_1.default.dirname(realCandidatePath));
    const relativeCandidateDirectory = node_path_1.default.dirname(relativeCandidatePath);
    addPathScrubVariant(scrubPaths, relativeCandidateDirectory === '.' ? null : relativeCandidateDirectory);
    addPathScrubVariant(scrubPaths, relativeCandidateDirectory === '.'
        ? null
        : node_path_1.default.join(input.requestedExecutionCwd, relativeCandidateDirectory));
    return {
        filePath: realCandidatePath,
        contentType,
        lineIndexes: input.candidate.lineIndexes,
        scrubPaths: [...scrubPaths],
        executionCwd: input.executionCwd,
        workspaceRootCwd: input.workspaceRootCwd,
        requestedExecutionCwd: input.requestedExecutionCwd,
        requestedWorkspaceRootCwd: input.requestedWorkspaceRootCwd,
    };
}
function shouldScanFile(filePath, expectedFamily) {
    if (isSecretLikeFileName(filePath)) {
        return false;
    }
    if (expectedFamily === 'file') {
        return true;
    }
    if (expectedFamily === 'text') {
        return false;
    }
    const extension = node_path_1.default.extname(filePath).toLowerCase() || null;
    const contentType = (0, uploadFile_1.inferUploadContentType)(filePath);
    return (0, deliveryArtifacts_1.inferDeliveryArtifactKind)(extension, contentType) === expectedFamily;
}
function shouldVisitScanDirectory(directoryName, ignoredDirectories) {
    if (ignoredDirectories.has(directoryName)) {
        return false;
    }
    return true;
}
async function scanWorkspaceForCandidates(executionCwd, expectedFamily) {
    if (expectedFamily === 'text') {
        return [];
    }
    const candidates = [];
    let secretLikeFileSeen = false;
    let hiddenDirectoryCandidateSeen = false;
    const ignoredDirectories = new Set(['.git', 'node_modules', 'dist']);
    async function visit(directory, inHiddenDirectory = false) {
        let entries;
        try {
            entries = await node_fs_1.promises.readdir(directory, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (entry.isDirectory()) {
                if (shouldVisitScanDirectory(entry.name, ignoredDirectories)) {
                    await visit(node_path_1.default.join(directory, entry.name), inHiddenDirectory || entry.name.startsWith('.'));
                }
                continue;
            }
            if (!entry.isFile()) {
                continue;
            }
            const filePath = node_path_1.default.join(directory, entry.name);
            if (isSecretLikeFileName(node_path_1.default.relative(executionCwd, filePath))) {
                secretLikeFileSeen = true;
                continue;
            }
            if ((inHiddenDirectory || hasHiddenDirectorySegment(node_path_1.default.relative(executionCwd, filePath)))
                && shouldScanFile(filePath, expectedFamily)) {
                hiddenDirectoryCandidateSeen = true;
                continue;
            }
            if (shouldScanFile(filePath, expectedFamily)) {
                candidates.push({ filePath, lineIndexes: [] });
            }
        }
    }
    await visit(executionCwd);
    if (secretLikeFileSeen) {
        throw providerArtifactError('provider_artifact_secret_rejected', 'Provider artifact path looks like a secret file and cannot be delivered.');
    }
    if (hiddenDirectoryCandidateSeen) {
        throw providerArtifactError('provider_artifact_secret_rejected', 'Provider artifact path looks like a secret file and cannot be delivered.');
    }
    return candidates;
}
async function resolveLocalArtifact(input) {
    const normalizedExecutionCwd = normalizeText(input.executionCwd);
    const explicitWorkspaceRootCwd = normalizeText(input.workspaceRootCwd);
    const normalizedWorkspaceRootCwd = explicitWorkspaceRootCwd || normalizedExecutionCwd;
    const realWorkspaceRootCwd = await resolveWorkspaceDirectory(normalizedWorkspaceRootCwd);
    const realExecutionCwd = await resolveWorkspaceDirectory(input.executionCwd);
    if (explicitWorkspaceRootCwd && node_path_1.default.resolve(explicitWorkspaceRootCwd) !== realWorkspaceRootCwd) {
        throw providerArtifactError('provider_artifact_outside_workspace', 'Provider attempt workspace no longer resolves to its original directory.');
    }
    if (!containsPath(realWorkspaceRootCwd, realExecutionCwd)) {
        throw providerArtifactError('provider_artifact_outside_workspace', 'Provider execution workspace resolves outside the provider attempt workspace.');
    }
    const requestedExecutionCwd = normalizedExecutionCwd
        ? node_path_1.default.resolve(normalizedExecutionCwd)
        : realExecutionCwd;
    const requestedWorkspaceRootCwd = normalizedWorkspaceRootCwd
        ? node_path_1.default.resolve(normalizedWorkspaceRootCwd)
        : realWorkspaceRootCwd;
    const markerCandidates = extractMarkerCandidates(input.responseText);
    if (markerCandidates.length > 1) {
        throw providerArtifactError('provider_artifact_ambiguous', 'Provider response contains multiple explicit artifact paths.');
    }
    if (markerCandidates.length === 1) {
        return resolveLocalCandidate({
            candidate: markerCandidates[0],
            executionCwd: realExecutionCwd,
            workspaceRootCwd: realWorkspaceRootCwd,
            requestedExecutionCwd,
            requestedWorkspaceRootCwd,
            expectedFamily: input.expectedFamily,
        });
    }
    const bareCandidates = await extractExistingBarePathCandidates(input.responseText, realExecutionCwd);
    if (bareCandidates.length > 1) {
        throw providerArtifactError('provider_artifact_ambiguous', 'Provider response contains multiple local artifact paths.');
    }
    if (bareCandidates.length === 1) {
        return resolveLocalCandidate({
            candidate: bareCandidates[0],
            executionCwd: realExecutionCwd,
            workspaceRootCwd: realWorkspaceRootCwd,
            requestedExecutionCwd,
            requestedWorkspaceRootCwd,
            expectedFamily: input.expectedFamily,
        });
    }
    const scannedCandidates = await scanWorkspaceForCandidates(realExecutionCwd, input.expectedFamily);
    if (scannedCandidates.length === 0) {
        throw providerArtifactError('provider_artifact_missing', 'Provider did not produce a resolvable delivery artifact.');
    }
    if (scannedCandidates.length > 1) {
        throw providerArtifactError('provider_artifact_ambiguous', 'Provider workspace contains multiple possible delivery artifacts.');
    }
    return resolveLocalCandidate({
        candidate: scannedCandidates[0],
        executionCwd: realExecutionCwd,
        workspaceRootCwd: realWorkspaceRootCwd,
        requestedExecutionCwd,
        requestedWorkspaceRootCwd,
        expectedFamily: input.expectedFamily,
    });
}
function parseVerifiedUploadMetafile(result) {
    const base = (0, deliveryArtifacts_1.parseMetafileUri)(normalizeText(result.metafileUri));
    if (!base) {
        throw providerArtifactError('provider_artifact_upload_invalid', 'Provider artifact upload returned an invalid metafile URI.');
    }
    if (normalizeText(result.pinId) !== base.pinId) {
        throw providerArtifactError('provider_artifact_upload_invalid', 'Provider artifact upload returned inconsistent metafile and PIN identifiers.');
    }
    return base;
}
function safeArtifactFileName(value, fallback) {
    if (typeof value !== 'string' || UNSAFE_STRUCTURED_METADATA_CHARACTER.test(value)) {
        return fallback;
    }
    const trimmed = value.trim();
    if (!trimmed
        || trimmed.includes('/')
        || trimmed.includes('\\')
        || trimmed.includes('://')
        || /^[a-z]:/i.test(trimmed)
        || isSecretLikeFileName(trimmed)) {
        return fallback;
    }
    return trimmed;
}
function safeArtifactContentType(value) {
    if (typeof value !== 'string' || UNSAFE_STRUCTURED_METADATA_CHARACTER.test(value)) {
        return null;
    }
    const trimmed = value.trim().toLowerCase();
    if (!trimmed
        || trimmed.startsWith('/')
        || trimmed.startsWith('./')
        || trimmed.startsWith('../')
        || trimmed.includes('\\')
        || trimmed.includes('://')
        || /^[a-z]:/i.test(trimmed)
        || !SAFE_CONTENT_TYPE_PATTERN.test(trimmed)) {
        return null;
    }
    return trimmed;
}
function safeArtifactExtension(value) {
    if (typeof value !== 'string' || UNSAFE_STRUCTURED_METADATA_CHARACTER.test(value)) {
        return null;
    }
    const trimmed = value.trim().toLowerCase();
    if (!trimmed
        || trimmed.includes('/')
        || trimmed.includes('\\')
        || trimmed.includes('://')
        || /^[a-z]:/i.test(trimmed)
        || isSecretLikeFileName(trimmed)
        || !/^\.[a-z0-9][a-z0-9+-]{0,31}$/.test(trimmed)) {
        return null;
    }
    return trimmed;
}
function uploadResultToArtifact(result) {
    const base = parseVerifiedUploadMetafile(result);
    const urls = (0, metafileUrls_1.buildMetafileContentUrls)(base.pinId);
    const contentType = safeArtifactContentType(result.contentType);
    const extension = base.extension ?? safeArtifactExtension(result.extension);
    const uri = extension ? (0, metafileUri_1.appendMetafileUriExtension)(base.uri, extension) : base.uri;
    const kind = (0, deliveryArtifacts_1.inferDeliveryArtifactKind)(extension, contentType);
    return {
        uri,
        pinId: base.pinId,
        kind,
        fileName: safeArtifactFileName(result.fileName, base.fileName),
        extension,
        contentType,
        byteLength: typeof result.bytes === 'number' && Number.isFinite(result.bytes) && result.bytes >= 0
            ? result.bytes
            : null,
        sourceUrl: urls.accelerateUrl,
        fallbackUrl: urls.contentUrl,
        downloadUrl: urls.accelerateUrl,
    };
}
function ensureUploadVerification(result) {
    parseVerifiedUploadMetafile(result);
    if (result.verification && !result.verification.ok) {
        throw providerArtifactError('provider_artifact_unavailable', result.verification.error || 'Uploaded artifact is not available through the file indexer.');
    }
}
function stripLocalCandidateLines(responseText, lineIndexes) {
    if (!lineIndexes.length) {
        return responseText;
    }
    const remove = new Set(lineIndexes);
    return String(responseText || '')
        .split(/\r?\n/)
        .filter((_, index) => !remove.has(index))
        .join('\n')
        .trim();
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function scrubFileUriLocalPathMentions(responseText, localPath) {
    if (!node_path_1.default.isAbsolute(localPath) && !/^[A-Za-z]:[\\/]/.test(localPath)) {
        return responseText;
    }
    let scrubbed = responseText;
    const slashPath = localPath.replace(/\\/g, '/');
    const variants = new Set([
        `file://${localPath}`,
        `file://${slashPath}`,
    ]);
    for (const variant of variants) {
        const pattern = `${escapeRegExp(variant)}(?:[\\\\/][^\\s;,)\\]}>"'\`]+)*(?=$|[^A-Za-z0-9_.\\\\/-])`;
        scrubbed = scrubbed.replace(new RegExp(pattern, 'g'), '[uploaded artifact]');
    }
    return scrubbed;
}
function scrubLocalPathMentions(responseText, scrubPaths) {
    let scrubbed = String(responseText || '');
    const sortedPaths = [...new Set(scrubPaths)]
        .filter(Boolean)
        .sort((left, right) => right.length - left.length);
    for (const localPath of sortedPaths) {
        scrubbed = scrubFileUriLocalPathMentions(scrubbed, localPath);
        const pattern = node_path_1.default.isAbsolute(localPath) || localPath.startsWith(`.${node_path_1.default.sep}`)
            ? escapeRegExp(localPath)
            : `(?<![A-Za-z0-9_.\\\\/-])${escapeRegExp(localPath)}`;
        scrubbed = scrubbed.replace(new RegExp(pattern, 'g'), '[uploaded artifact]');
    }
    return scrubbed.replace(/[ \t]+/g, ' ').trim();
}
function scrubAbsoluteProviderLocalHints(responseText) {
    let scrubbed = String(responseText || '');
    for (const pathHintPattern of absoluteProviderLocalHintPatterns()) {
        scrubbed = scrubbed.replace(pathHintPattern, '[uploaded artifact]');
    }
    return scrubbed.replace(/[ \t]+/g, ' ').trim();
}
async function collectRelativeExecutionPathMentions(responseText, executionCwd) {
    const mentions = new Set();
    const tokenPattern = /(?<![A-Za-z0-9_.:/\\-])(?:\.{1,2}[\\/])?[A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_.-]+)+(?![A-Za-z0-9_.:/\\-])/g;
    const matches = String(responseText || '').matchAll(tokenPattern);
    for (const match of matches) {
        const token = match[0];
        if (!token || node_path_1.default.isAbsolute(token)) {
            continue;
        }
        const absolutePath = node_path_1.default.resolve(executionCwd, token);
        let realPath;
        try {
            realPath = await node_fs_1.promises.realpath(absolutePath);
        }
        catch {
            mentions.add(token);
            continue;
        }
        if (containsPath(executionCwd, realPath)) {
            mentions.add(token);
        }
    }
    return [...mentions];
}
async function scrubExecutionWorkspacePathMentions(responseText, executionCwd) {
    const normalizedExecutionCwd = normalizeText(executionCwd);
    if (!normalizedExecutionCwd) {
        return responseText;
    }
    let realExecutionCwd;
    try {
        realExecutionCwd = await node_fs_1.promises.realpath(node_path_1.default.resolve(normalizedExecutionCwd));
    }
    catch {
        return responseText;
    }
    let scrubbed = String(responseText || '');
    const roots = new Set();
    addPathScrubVariant(roots, realExecutionCwd);
    addPathScrubVariant(roots, node_path_1.default.resolve(normalizedExecutionCwd));
    const sortedRoots = [...roots]
        .filter(Boolean)
        .sort((left, right) => right.length - left.length);
    for (const root of sortedRoots) {
        scrubbed = scrubFileUriLocalPathMentions(scrubbed, root);
        const pattern = `${escapeRegExp(root)}(?:[\\\\/][^\\s;,)\\]}>"'\`]+)*(?=$|[^A-Za-z0-9_.\\\\/-])`;
        scrubbed = scrubbed.replace(new RegExp(pattern, 'g'), '[uploaded artifact]');
    }
    const relativeMentions = await collectRelativeExecutionPathMentions(scrubbed, realExecutionCwd);
    return scrubLocalPathMentions(scrubbed, relativeMentions);
}
async function snapshotProviderArtifactForUpload(file) {
    let snapshotDirectory = null;
    let handle = null;
    try {
        snapshotDirectory = await node_fs_1.promises.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), 'oac-provider-artifact-upload-'));
        const snapshotPath = node_path_1.default.join(snapshotDirectory, node_path_1.default.basename(file.filePath));
        const noFollow = node_fs_1.constants.O_NOFOLLOW ?? 0;
        handle = await node_fs_1.promises.open(file.filePath, node_fs_1.constants.O_RDONLY | noFollow);
        const stat = await handle.stat();
        if (!stat.isFile()) {
            throw providerArtifactError('provider_artifact_missing', 'Provider artifact must be a regular file.');
        }
        if (stat.size > uploadLargeFile_1.LARGE_UPLOAD_MAX_BYTES) {
            throw providerArtifactError('provider_artifact_too_large', `Provider artifact exceeds the maximum upload size of ${uploadLargeFile_1.LARGE_UPLOAD_MAX_BYTES} bytes.`);
        }
        const currentRealPath = await node_fs_1.promises.realpath(file.filePath);
        if (!containsPath(file.executionCwd, currentRealPath)
            || !containsPath(file.workspaceRootCwd, currentRealPath)) {
            throw providerArtifactError('provider_artifact_outside_workspace', 'Provider artifact path resolves outside the provider attempt workspace.');
        }
        const artifactBytes = await handle.readFile();
        if (artifactBytes.byteLength > uploadLargeFile_1.LARGE_UPLOAD_MAX_BYTES) {
            throw providerArtifactError('provider_artifact_too_large', `Provider artifact exceeds the maximum upload size of ${uploadLargeFile_1.LARGE_UPLOAD_MAX_BYTES} bytes.`);
        }
        await node_fs_1.promises.writeFile(snapshotPath, artifactBytes, { mode: 0o600 });
        return {
            filePath: snapshotPath,
            directory: snapshotDirectory,
        };
    }
    catch (error) {
        if (handle) {
            await handle.close().catch(() => undefined);
            handle = null;
        }
        if (snapshotDirectory) {
            await node_fs_1.promises.rm(snapshotDirectory, { recursive: true, force: true }).catch(() => undefined);
        }
        if (error instanceof ProviderDeliveryArtifactError) {
            throw error;
        }
        throw providerArtifactError('provider_artifact_missing', 'Provider artifact file was not found.');
    }
    finally {
        if (handle) {
            await handle.close().catch(() => undefined);
        }
    }
}
async function uploadResolvedLocalArtifact(input) {
    const uploader = input.uploadLargeFile ?? uploadLargeFile_1.uploadLargeFileToChain;
    const snapshot = await snapshotProviderArtifactForUpload(input.file);
    let uploadResult;
    try {
        uploadResult = await uploader({
            filePath: snapshot.filePath,
            contentType: input.file.contentType,
            network: input.network ?? undefined,
            signer: input.signer,
            verify: true,
            verifyAvailability: input.verifyAvailability,
            largeUploader: input.largeUploader,
            mvcSponsorClient: input.mvcSponsorClient,
        });
    }
    catch (error) {
        const code = error instanceof Error ? error.code : undefined;
        if (code === 'large_file_upload_unavailable') {
            throw error;
        }
        const rawMessage = error instanceof Error ? error.message : 'Provider artifact upload failed.';
        const scrubbedMessage = await scrubExecutionWorkspacePathMentions(rawMessage, input.file.requestedExecutionCwd);
        const uploadSafeMessage = scrubLocalPathMentions(scrubbedMessage, [snapshot.filePath, snapshot.directory]);
        throw providerArtifactError('provider_artifact_upload_failed', uploadSafeMessage, readUploadFailureData(error));
    }
    finally {
        await node_fs_1.promises.rm(snapshot.directory, { recursive: true, force: true }).catch(() => undefined);
    }
    ensureUploadVerification(uploadResult);
    const artifact = uploadResultToArtifact(uploadResult);
    validateArtifactFamily(artifact, input.expectedFamily);
    return artifact;
}
async function resolveProviderDeliveryArtifacts(input) {
    const responseText = typeof input.responseText === 'string' ? input.responseText : '';
    const expectedFamily = classifyProviderOutputType(input.outputType);
    if (expectedFamily === 'text') {
        return { responseText, artifacts: [] };
    }
    assertNoSecretLikeProviderLocalHints(responseText);
    const existingArtifacts = await resolveExistingMetafileArtifacts({
        responseText,
        expectedFamily,
        verifyAvailability: input.verifyAvailability,
    });
    if (existingArtifacts.length > 0) {
        const providerSafeResponseText = stripProviderOnlyLocalHintLines(responseText);
        const workspaceSafeResponseText = await scrubExecutionWorkspacePathMentions(providerSafeResponseText, input.executionCwd);
        return {
            responseText: (0, deliveryArtifacts_1.appendDeliveryArtifactSummaries)(workspaceSafeResponseText, existingArtifacts),
            artifacts: existingArtifacts,
        };
    }
    const localFile = await resolveLocalArtifact({
        responseText,
        executionCwd: input.executionCwd,
        workspaceRootCwd: input.workspaceRootCwd,
        expectedFamily,
    });
    const artifact = await uploadResolvedLocalArtifact({
        file: localFile,
        expectedFamily,
        signer: input.signer,
        network: input.network,
        uploadLargeFile: input.uploadLargeFile,
        verifyAvailability: input.verifyAvailability,
        largeUploader: input.largeUploader,
        mvcSponsorClient: input.mvcSponsorClient,
    });
    const publicResponseText = stripLocalCandidateLines(responseText, localFile.lineIndexes);
    const workspaceScrubbedResponseText = await scrubExecutionWorkspacePathMentions(publicResponseText, input.executionCwd);
    const providerSafeResponseText = scrubLocalPathMentions(workspaceScrubbedResponseText, localFile.scrubPaths);
    const absoluteSafeResponseText = scrubAbsoluteProviderLocalHints(providerSafeResponseText);
    assertNoAbsoluteProviderLocalHints(absoluteSafeResponseText);
    return {
        responseText: (0, deliveryArtifacts_1.appendDeliveryArtifactSummaries)(absoluteSafeResponseText, [artifact]),
        artifacts: [artifact],
    };
}
