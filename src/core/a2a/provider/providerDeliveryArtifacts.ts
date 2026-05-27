import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  appendDeliveryArtifactSummaries,
  extractDeliveryArtifactsFromText,
  inferDeliveryArtifactKind,
  parseMetafileUri,
  type A2ADeliveryArtifact,
  type A2ADeliveryArtifactKind,
} from '../deliveryArtifacts';
import { buildMetafileContentUrls } from '../../files/metafileUrls';
import { verifyMetafileAvailability } from '../../files/metafileVerifier';
import {
  LARGE_UPLOAD_MAX_BYTES,
  uploadLargeFileToChain,
  type UploadLargeFileResult,
} from '../../files/uploadLargeFile';
import { inferUploadContentType } from '../../files/uploadFile';
import type { Signer } from '../../signing/signer';

export type ProviderExpectedArtifactFamily = 'text' | 'image' | 'video' | 'audio' | 'file';

type VerifyAvailability = Parameters<typeof uploadLargeFileToChain>[0]['verifyAvailability'];
type LargeUploader = Parameters<typeof uploadLargeFileToChain>[0]['largeUploader'];

export interface ResolveProviderDeliveryArtifactsInput {
  responseText: string;
  outputType: string | null | undefined;
  executionCwd?: string | null;
  network?: string | null;
  signer: Signer;
  uploadLargeFile?: typeof uploadLargeFileToChain;
  verifyAvailability?: VerifyAvailability;
  largeUploader?: LargeUploader;
}

export interface ResolveProviderDeliveryArtifactsResult {
  responseText: string;
  artifacts: A2ADeliveryArtifact[];
}

interface ProviderLocalCandidate {
  filePath: string;
  lineIndexes: number[];
}

interface ResolvedProviderFile {
  filePath: string;
  contentType: string;
  lineIndexes: number[];
  scrubPaths: string[];
}

export class ProviderDeliveryArtifactError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'ProviderDeliveryArtifactError';
    this.code = code;
  }
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function providerArtifactError(code: string, message: string): ProviderDeliveryArtifactError {
  return new ProviderDeliveryArtifactError(code, message);
}

export function classifyProviderOutputType(outputType: unknown): ProviderExpectedArtifactFamily {
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

export function isTextLikeProviderOutputType(outputType: unknown): boolean {
  return classifyProviderOutputType(outputType) === 'text';
}

function validateArtifactFamily(
  artifact: Pick<A2ADeliveryArtifact, 'kind' | 'uri'>,
  expectedFamily: ProviderExpectedArtifactFamily,
): void {
  if (expectedFamily === 'text' || expectedFamily === 'file') {
    return;
  }
  if (artifact.kind !== expectedFamily) {
    throw providerArtifactError(
      'provider_artifact_type_mismatch',
      `Expected a ${expectedFamily} artifact but resolved ${artifact.kind}.`,
    );
  }
}

async function verifyReusableMetafile(
  artifact: A2ADeliveryArtifact,
  verifyAvailability?: VerifyAvailability,
): Promise<void> {
  try {
    const verification = verifyAvailability
      ? await verifyAvailability(artifact.pinId)
      : await verifyMetafileAvailability({ pinId: artifact.pinId });
    if (!verification?.ok) {
      throw providerArtifactError(
        'provider_artifact_unavailable',
        verification?.error || 'Metafile artifact is not available through the file indexer.',
      );
    }
  } catch (error) {
    if (error instanceof ProviderDeliveryArtifactError) {
      throw error;
    }
    throw providerArtifactError(
      'provider_artifact_unavailable',
      error instanceof Error ? error.message : 'Metafile artifact availability verification failed.',
    );
  }
}

async function resolveExistingMetafileArtifacts(input: {
  responseText: string;
  expectedFamily: ProviderExpectedArtifactFamily;
  verifyAvailability?: VerifyAvailability;
}): Promise<A2ADeliveryArtifact[]> {
  const artifacts = extractDeliveryArtifactsFromText(input.responseText);
  if (!artifacts.length) {
    return [];
  }

  for (const artifact of artifacts) {
    validateArtifactFamily(artifact, input.expectedFamily);
    await verifyReusableMetafile(artifact, input.verifyAvailability);
  }

  return artifacts;
}

function trimCandidatePath(value: string): string {
  return value
    .trim()
    .replace(/^["'`]+/, '')
    .replace(/["'`]+$/, '')
    .trim();
}

function extractMarkerCandidates(responseText: string): ProviderLocalCandidate[] {
  const candidates: ProviderLocalCandidate[] = [];
  const lines = String(responseText || '').split(/\r?\n/);
  const markerPattern = /^\s*(artifactPath|filePath|outputFile|outputPath|attachment)\s*:\s*(.+?)\s*$/i;

  lines.forEach((line, index) => {
    const match = markerPattern.exec(line);
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

function looksLikeLocalPathLine(value: string): boolean {
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

async function extractExistingBarePathCandidates(
  responseText: string,
  executionCwd: string,
): Promise<ProviderLocalCandidate[]> {
  const candidates: ProviderLocalCandidate[] = [];
  const lines = String(responseText || '').split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const filePath = trimCandidatePath(lines[index]);
    if (!looksLikeLocalPathLine(filePath)) {
      continue;
    }
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(executionCwd, filePath);
    try {
      const stat = await fs.stat(absolutePath);
      if (stat.isFile()) {
        candidates.push({ filePath, lineIndexes: [index] });
      }
    } catch {
      continue;
    }
  }

  return candidates;
}

function isSecretLikeFileName(filePath: string): boolean {
  const normalizedPath = filePath.split(path.sep).join('/');
  const lowerPath = normalizedPath.toLowerCase();
  const segments = lowerPath.split('/').filter(Boolean);
  const base = path.basename(lowerPath);
  const compact = base.replace(/[\s._-]+/g, '');
  const compactPath = lowerPath.replace(/[\s._/-]+/g, '');
  const parent = segments.length > 1 ? segments[segments.length - 2] : '';

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
    || compact.includes('privatekey')
    || compact.includes('mnemonic')
    || compact.includes('seedphrase')
    || compact.includes('accesstoken')
    || compact.includes('authtoken')
    || compactPath.includes('awscredentials')
    || compactPath.includes('privatekey')
    || compactPath.includes('seedphrase');
}

function containsPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function addPathScrubVariant(paths: Set<string>, value: string | null | undefined): void {
  const trimmed = normalizeText(value);
  if (!trimmed) {
    return;
  }
  paths.add(trimmed);
  paths.add(trimmed.split(path.sep).join('/'));
  paths.add(trimmed.split(path.sep).join('\\'));
}

async function resolveExecutionCwd(executionCwd?: string | null): Promise<string> {
  const normalized = normalizeText(executionCwd);
  if (!normalized) {
    throw providerArtifactError(
      'provider_artifact_workspace_required',
      'Provider artifact resolution requires an execution workspace.',
    );
  }
  try {
    return await fs.realpath(path.resolve(normalized));
  } catch {
    throw providerArtifactError(
      'provider_artifact_workspace_required',
      'Provider artifact resolution requires a readable execution workspace.',
    );
  }
}

async function resolveLocalCandidate(input: {
  candidate: ProviderLocalCandidate;
  executionCwd: string;
  requestedExecutionCwd: string;
  expectedFamily: ProviderExpectedArtifactFamily;
}): Promise<ResolvedProviderFile> {
  const candidatePath = trimCandidatePath(input.candidate.filePath);
  if (!candidatePath) {
    throw providerArtifactError('provider_artifact_missing', 'Provider artifact path is empty.');
  }

  const absoluteCandidatePath = path.isAbsolute(candidatePath)
    ? path.resolve(candidatePath)
    : path.resolve(input.executionCwd, candidatePath);
  let realCandidatePath: string;
  try {
    realCandidatePath = await fs.realpath(absoluteCandidatePath);
  } catch {
    throw providerArtifactError('provider_artifact_missing', 'Provider artifact file was not found.');
  }

  if (!containsPath(input.executionCwd, realCandidatePath)) {
    throw providerArtifactError(
      'provider_artifact_outside_workspace',
      'Provider artifact path resolves outside the execution workspace.',
    );
  }

  const relativeSecretCheckPath = path.relative(input.executionCwd, realCandidatePath);
  if (isSecretLikeFileName(relativeSecretCheckPath)) {
    throw providerArtifactError(
      'provider_artifact_secret_rejected',
      'Provider artifact path looks like a secret file and cannot be delivered.',
    );
  }

  const fileName = path.basename(realCandidatePath);
  const stat = await fs.stat(realCandidatePath);
  if (!stat.isFile()) {
    throw providerArtifactError('provider_artifact_missing', 'Provider artifact must be a regular file.');
  }
  if (stat.size > LARGE_UPLOAD_MAX_BYTES) {
    throw providerArtifactError(
      'provider_artifact_too_large',
      `Provider artifact exceeds the maximum upload size of ${LARGE_UPLOAD_MAX_BYTES} bytes.`,
    );
  }

  const extension = path.extname(realCandidatePath).toLowerCase() || null;
  const contentType = inferUploadContentType(realCandidatePath);
  const kind = inferDeliveryArtifactKind(extension, contentType);
  validateArtifactFamily({ uri: `file://${fileName}`, kind }, input.expectedFamily);

  const scrubPaths = new Set<string>();
  addPathScrubVariant(scrubPaths, input.executionCwd);
  addPathScrubVariant(scrubPaths, input.requestedExecutionCwd);
  addPathScrubVariant(scrubPaths, candidatePath);
  addPathScrubVariant(scrubPaths, absoluteCandidatePath);
  addPathScrubVariant(scrubPaths, realCandidatePath);
  const relativeCandidatePath = path.relative(input.executionCwd, realCandidatePath);
  addPathScrubVariant(scrubPaths, relativeCandidatePath);
  addPathScrubVariant(scrubPaths, relativeCandidatePath ? `.${path.sep}${relativeCandidatePath}` : null);
  addPathScrubVariant(scrubPaths, relativeCandidatePath
    ? path.join(input.requestedExecutionCwd, relativeCandidatePath)
    : null);
  addPathScrubVariant(scrubPaths, path.dirname(absoluteCandidatePath));
  addPathScrubVariant(scrubPaths, path.dirname(realCandidatePath));
  const relativeCandidateDirectory = path.dirname(relativeCandidatePath);
  addPathScrubVariant(scrubPaths, relativeCandidateDirectory === '.' ? null : relativeCandidateDirectory);
  addPathScrubVariant(scrubPaths, relativeCandidateDirectory === '.'
    ? null
    : path.join(input.requestedExecutionCwd, relativeCandidateDirectory));

  return {
    filePath: realCandidatePath,
    contentType,
    lineIndexes: input.candidate.lineIndexes,
    scrubPaths: [...scrubPaths],
  };
}

function shouldScanFile(
  filePath: string,
  expectedFamily: ProviderExpectedArtifactFamily,
): boolean {
  if (isSecretLikeFileName(filePath)) {
    return false;
  }

  if (expectedFamily === 'file') {
    return true;
  }
  if (expectedFamily === 'text') {
    return false;
  }

  const extension = path.extname(filePath).toLowerCase() || null;
  const contentType = inferUploadContentType(filePath);
  return inferDeliveryArtifactKind(extension, contentType) === expectedFamily;
}

function shouldVisitScanDirectory(directoryName: string, ignoredDirectories: Set<string>): boolean {
  if (ignoredDirectories.has(directoryName)) {
    return false;
  }
  if (!directoryName.startsWith('.')) {
    return true;
  }
  return directoryName === '.ssh' || directoryName === '.aws';
}

async function scanWorkspaceForCandidates(
  executionCwd: string,
  expectedFamily: ProviderExpectedArtifactFamily,
): Promise<ProviderLocalCandidate[]> {
  if (expectedFamily === 'text') {
    return [];
  }

  const candidates: ProviderLocalCandidate[] = [];
  let secretLikeFileSeen = false;
  const ignoredDirectories = new Set(['.git', 'node_modules', 'dist']);

  async function visit(directory: string): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (shouldVisitScanDirectory(entry.name, ignoredDirectories)) {
          await visit(path.join(directory, entry.name));
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      const filePath = path.join(directory, entry.name);
      if (isSecretLikeFileName(path.relative(executionCwd, filePath))) {
        secretLikeFileSeen = true;
        continue;
      }
      if (shouldScanFile(filePath, expectedFamily)) {
        candidates.push({ filePath, lineIndexes: [] });
      }
    }
  }

  await visit(executionCwd);
  if (secretLikeFileSeen) {
    throw providerArtifactError(
      'provider_artifact_secret_rejected',
      'Provider artifact path looks like a secret file and cannot be delivered.',
    );
  }
  return candidates;
}

async function resolveLocalArtifact(input: {
  responseText: string;
  executionCwd?: string | null;
  expectedFamily: ProviderExpectedArtifactFamily;
}): Promise<ResolvedProviderFile> {
  const normalizedExecutionCwd = normalizeText(input.executionCwd);
  const realExecutionCwd = await resolveExecutionCwd(input.executionCwd);
  const requestedExecutionCwd = normalizedExecutionCwd
    ? path.resolve(normalizedExecutionCwd)
    : realExecutionCwd;
  const markerCandidates = extractMarkerCandidates(input.responseText);
  if (markerCandidates.length > 1) {
    throw providerArtifactError(
      'provider_artifact_ambiguous',
      'Provider response contains multiple explicit artifact paths.',
    );
  }
  if (markerCandidates.length === 1) {
    return resolveLocalCandidate({
      candidate: markerCandidates[0],
      executionCwd: realExecutionCwd,
      requestedExecutionCwd,
      expectedFamily: input.expectedFamily,
    });
  }

  const bareCandidates = await extractExistingBarePathCandidates(input.responseText, realExecutionCwd);
  if (bareCandidates.length > 1) {
    throw providerArtifactError(
      'provider_artifact_ambiguous',
      'Provider response contains multiple local artifact paths.',
    );
  }
  if (bareCandidates.length === 1) {
    return resolveLocalCandidate({
      candidate: bareCandidates[0],
      executionCwd: realExecutionCwd,
      requestedExecutionCwd,
      expectedFamily: input.expectedFamily,
    });
  }

  const scannedCandidates = await scanWorkspaceForCandidates(realExecutionCwd, input.expectedFamily);
  if (scannedCandidates.length === 0) {
    throw providerArtifactError(
      'provider_artifact_missing',
      'Provider did not produce a resolvable delivery artifact.',
    );
  }
  if (scannedCandidates.length > 1) {
    throw providerArtifactError(
      'provider_artifact_ambiguous',
      'Provider workspace contains multiple possible delivery artifacts.',
    );
  }
  return resolveLocalCandidate({
    candidate: scannedCandidates[0],
    executionCwd: realExecutionCwd,
    requestedExecutionCwd,
    expectedFamily: input.expectedFamily,
  });
}

function uploadResultToArtifact(result: UploadLargeFileResult): A2ADeliveryArtifact {
  const base = parseMetafileUri(result.metafileUri)
    ?? parseMetafileUri(`metafile://${result.pinId}${result.extension || ''}`);
  if (!base) {
    throw providerArtifactError(
      'provider_artifact_upload_invalid',
      'Provider artifact upload returned an invalid metafile URI.',
    );
  }

  const urls = buildMetafileContentUrls(base.pinId);
  const contentType = normalizeText(result.contentType) || null;
  const extension = base.extension ?? (normalizeText(result.extension) || null);
  const kind: A2ADeliveryArtifactKind = inferDeliveryArtifactKind(extension, contentType);

  return {
    uri: base.uri,
    pinId: base.pinId,
    kind,
    fileName: normalizeText(result.fileName) || base.fileName,
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

function ensureUploadVerification(result: UploadLargeFileResult): void {
  if (result.verification && !result.verification.ok) {
    throw providerArtifactError(
      'provider_artifact_unavailable',
      result.verification.error || 'Uploaded artifact is not available through the file indexer.',
    );
  }
}

function stripLocalCandidateLines(responseText: string, lineIndexes: number[]): string {
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function scrubLocalPathMentions(responseText: string, scrubPaths: string[]): string {
  let scrubbed = String(responseText || '');
  const sortedPaths = [...new Set(scrubPaths)]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);

  for (const localPath of sortedPaths) {
    const pattern = path.isAbsolute(localPath) || localPath.startsWith(`.${path.sep}`)
      ? escapeRegExp(localPath)
      : `(?<![A-Za-z0-9_.\\\\/-])${escapeRegExp(localPath)}`;
    scrubbed = scrubbed.replace(new RegExp(pattern, 'g'), '[uploaded artifact]');
  }

  return scrubbed.replace(/[ \t]+/g, ' ').trim();
}

async function collectRelativeExecutionPathMentions(
  responseText: string,
  executionCwd: string,
): Promise<string[]> {
  const mentions = new Set<string>();
  const tokenPattern = /(?<![A-Za-z0-9_.:/\\-])(?:\.{1,2}[\\/])?[A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_.-]+)+(?![A-Za-z0-9_.:/\\-])/g;
  const matches = String(responseText || '').matchAll(tokenPattern);

  for (const match of matches) {
    const token = match[0];
    if (!token || path.isAbsolute(token)) {
      continue;
    }

    const absolutePath = path.resolve(executionCwd, token);
    let realPath: string;
    try {
      realPath = await fs.realpath(absolutePath);
    } catch {
      continue;
    }

    if (containsPath(executionCwd, realPath)) {
      mentions.add(token);
    }
  }

  return [...mentions];
}

async function scrubExecutionWorkspacePathMentions(
  responseText: string,
  executionCwd?: string | null,
): Promise<string> {
  const normalizedExecutionCwd = normalizeText(executionCwd);
  if (!normalizedExecutionCwd) {
    return responseText;
  }

  let realExecutionCwd: string;
  try {
    realExecutionCwd = await fs.realpath(path.resolve(normalizedExecutionCwd));
  } catch {
    return responseText;
  }

  let scrubbed = String(responseText || '');
  const roots = new Set<string>();
  addPathScrubVariant(roots, realExecutionCwd);
  addPathScrubVariant(roots, path.resolve(normalizedExecutionCwd));
  const sortedRoots = [...roots]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);

  for (const root of sortedRoots) {
    const pattern = `${escapeRegExp(root)}(?:[\\\\/][^\\s;,)\\]}>"'\`]+)*(?=$|[^A-Za-z0-9_.\\\\/-])`;
    scrubbed = scrubbed.replace(new RegExp(pattern, 'g'), '[uploaded artifact]');
  }

  const relativeMentions = await collectRelativeExecutionPathMentions(scrubbed, realExecutionCwd);
  return scrubLocalPathMentions(scrubbed, relativeMentions);
}

async function uploadResolvedLocalArtifact(input: {
  file: ResolvedProviderFile;
  expectedFamily: ProviderExpectedArtifactFamily;
  signer: Signer;
  network?: string | null;
  uploadLargeFile?: typeof uploadLargeFileToChain;
  verifyAvailability?: VerifyAvailability;
  largeUploader?: LargeUploader;
}): Promise<A2ADeliveryArtifact> {
  const uploader = input.uploadLargeFile ?? uploadLargeFileToChain;

  let uploadResult: UploadLargeFileResult;
  try {
    uploadResult = await uploader({
      filePath: input.file.filePath,
      contentType: input.file.contentType,
      network: input.network ?? undefined,
      signer: input.signer,
      verify: true,
      verifyAvailability: input.verifyAvailability,
      largeUploader: input.largeUploader,
    });
  } catch (error) {
    const code = error instanceof Error ? (error as Error & { code?: unknown }).code : undefined;
    if (code === 'large_file_upload_unavailable') {
      throw error;
    }
    throw providerArtifactError(
      'provider_artifact_upload_failed',
      error instanceof Error ? error.message : 'Provider artifact upload failed.',
    );
  }

  ensureUploadVerification(uploadResult);
  const artifact = uploadResultToArtifact(uploadResult);
  validateArtifactFamily(artifact, input.expectedFamily);
  return artifact;
}

export async function resolveProviderDeliveryArtifacts(
  input: ResolveProviderDeliveryArtifactsInput,
): Promise<ResolveProviderDeliveryArtifactsResult> {
  const responseText = typeof input.responseText === 'string' ? input.responseText : '';
  const expectedFamily = classifyProviderOutputType(input.outputType);
  if (expectedFamily === 'text') {
    return { responseText, artifacts: [] };
  }

  const existingArtifacts = await resolveExistingMetafileArtifacts({
    responseText,
    expectedFamily,
    verifyAvailability: input.verifyAvailability,
  });
  if (existingArtifacts.length > 0) {
    return {
      responseText: await scrubExecutionWorkspacePathMentions(responseText, input.executionCwd),
      artifacts: existingArtifacts,
    };
  }

  const localFile = await resolveLocalArtifact({
    responseText,
    executionCwd: input.executionCwd,
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
  });
  const publicResponseText = stripLocalCandidateLines(responseText, localFile.lineIndexes);
  const scrubbedResponseText = scrubLocalPathMentions(publicResponseText, localFile.scrubPaths);

  return {
    responseText: appendDeliveryArtifactSummaries(scrubbedResponseText, [artifact]),
    artifacts: [artifact],
  };
}
