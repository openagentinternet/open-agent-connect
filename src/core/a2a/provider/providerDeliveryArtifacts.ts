import { constants as fsConstants, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendDeliveryArtifactSummaries,
  extractDeliveryArtifactsFromText,
  inferDeliveryArtifactKind,
  parseMetafileUri,
  type A2ADeliveryArtifact,
  type A2ADeliveryArtifactKind,
} from '../deliveryArtifacts';
import { appendMetafileUriExtension } from '../../files/metafileUri';
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
type MvcSponsorClient = Parameters<typeof uploadLargeFileToChain>[0]['mvcSponsorClient'];

export interface ResolveProviderDeliveryArtifactsInput {
  responseText: string;
  outputType: string | null | undefined;
  executionCwd?: string | null;
  workspaceRootCwd?: string | null;
  network?: string | null;
  signer: Signer;
  uploadLargeFile?: typeof uploadLargeFileToChain;
  verifyAvailability?: VerifyAvailability;
  largeUploader?: LargeUploader;
  mvcSponsorClient?: MvcSponsorClient;
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
  executionCwd: string;
  workspaceRootCwd: string;
  requestedExecutionCwd: string;
  requestedWorkspaceRootCwd: string;
}

interface ProviderArtifactUploadSnapshot {
  filePath: string;
  directory: string;
}

const PROVIDER_ARTIFACT_MARKER_PATTERN =
  /^\s*(artifactPath|filePath|outputFile|outputPath|attachment)\s*:\s*(.+?)\s*$/i;
const UNSAFE_STRUCTURED_METADATA_CHARACTER = /[\x00-\x1f\x7f]/;
const SAFE_CONTENT_TYPE_PATTERN =
  /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(?: *; *[a-z0-9][a-z0-9!#$&^_.+-]*=[a-z0-9][a-z0-9!#$&^_.+:-]*)*$/i;

export class ProviderDeliveryArtifactError extends Error {
  code: string;
  data?: Record<string, unknown>;

  constructor(code: string, message: string, data?: Record<string, unknown>) {
    super(`${code}: ${message}`);
    this.name = 'ProviderDeliveryArtifactError';
    this.code = code;
    if (data) {
      this.data = data;
    }
  }
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readUploadFailureData(error: unknown): Record<string, unknown> | undefined {
  const data = (error as { data?: unknown } | undefined)?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return undefined;
  }
  const feeAssist = (data as Record<string, unknown>).feeAssist;
  if (!feeAssist || typeof feeAssist !== 'object' || Array.isArray(feeAssist)) {
    return undefined;
  }
  return {
    feeAssist: feeAssist as Record<string, unknown>,
  };
}

function providerArtifactError(code: string, message: string, data?: Record<string, unknown>): ProviderDeliveryArtifactError {
  return new ProviderDeliveryArtifactError(code, message, data);
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

  assertNoAbsoluteProviderLocalHints(input.responseText);

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

function isPublicProviderArtifactReference(value: string): boolean {
  const trimmed = trimCandidatePath(value);
  return trimmed.toLowerCase().startsWith('metafile://')
    || /^https?:\/\//i.test(trimmed);
}

function redactPublicArtifactReferences(value: string): string {
  return String(value || '').replace(
    /\b(?:metafile:\/\/[^\s,;)\]}>"'`]+|https?:\/\/[^\s,;)\]}>"'`]+)/gi,
    '[public artifact]',
  );
}

function stripProviderOnlyLocalHintLines(responseText: string): string {
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
    if (isSecretLikeFileName(filePath)) {
      throw providerArtifactError(
        'provider_artifact_secret_rejected',
        'Provider artifact path looks like a secret file and cannot be delivered.',
      );
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
  const normalizedPath = filePath.replace(/[\\/]+/g, '/');
  const lowerPath = normalizedPath.toLowerCase();
  const segments = lowerPath.split('/').filter(Boolean);
  const base = path.basename(lowerPath);
  const extension = path.extname(base);
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

function hasHiddenDirectorySegment(filePath: string): boolean {
  const segments = filePath.replace(/[\\/]+/g, '/').split('/').filter(Boolean);
  const directorySegments = segments.slice(0, -1);
  return directorySegments.some((segment) => segment !== '.' && segment !== '..' && segment.startsWith('.'));
}

function isRejectedProviderLocalHintPath(filePath: string): boolean {
  return isSecretLikeFileName(filePath) || hasHiddenDirectorySegment(filePath);
}

function throwProviderSecretRejected(): never {
  throw providerArtifactError(
    'provider_artifact_secret_rejected',
    'Provider artifact path looks like a secret file and cannot be delivered.',
  );
}

function looksLikeInlineFileHint(value: string): boolean {
  const normalized = value.replace(/[\\/]+/g, '/');
  const base = path.basename(normalized);
  return normalized.includes('/')
    || value.includes('\\')
    || base.startsWith('.')
    || path.extname(base) !== '';
}

function absoluteProviderLocalHintPatterns(): RegExp[] {
  return [
    /\bfile:[^\s,;)\]}>"'`]+/gi,
    /(?<![A-Za-z0-9_.:/\\-])\\\\[^\\/\s,;)\]}>"'`]+[\\/][^\s,;)\]}>"'`]+/g,
    /(?<![A-Za-z0-9_.:/\\-])[A-Za-z]:(?!\/\/)[^\s,;)\]}>"'`]+/g,
    /(?<![A-Za-z0-9_.:/\\-])\/[^\s,;)\]}>"'`]+/g,
  ];
}

function assertNoAbsoluteSecretLikeProviderHints(responseText: string): void {
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

function assertNoAbsoluteProviderLocalHints(responseText: string): void {
  const redactedText = redactPublicArtifactReferences(responseText);

  for (const pathHintPattern of absoluteProviderLocalHintPatterns()) {
    if (pathHintPattern.test(redactedText)) {
      throwProviderSecretRejected();
    }
  }
}

function assertNoInlineSecretLikeProviderHints(responseText: string): void {
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

function assertNoSecretLikeProviderLocalHints(responseText: string): void {
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

async function resolveWorkspaceDirectory(inputPath: string | null | undefined): Promise<string> {
  const normalized = normalizeText(inputPath);
  if (!normalized) {
    throw providerArtifactError(
      'provider_artifact_workspace_required',
      'Provider artifact resolution requires an execution workspace.',
    );
  }
  try {
    const realPath = await fs.realpath(path.resolve(normalized));
    const stat = await fs.stat(realPath);
    if (!stat.isDirectory()) {
      throw new Error('workspace is not a directory');
    }
    return realPath;
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
  workspaceRootCwd: string;
  requestedExecutionCwd: string;
  requestedWorkspaceRootCwd: string;
  expectedFamily: ProviderExpectedArtifactFamily;
}): Promise<ResolvedProviderFile> {
  const candidatePath = trimCandidatePath(input.candidate.filePath);
  if (!candidatePath) {
    throw providerArtifactError('provider_artifact_missing', 'Provider artifact path is empty.');
  }
  if (isSecretLikeFileName(candidatePath)) {
    throw providerArtifactError(
      'provider_artifact_secret_rejected',
      'Provider artifact path looks like a secret file and cannot be delivered.',
    );
  }
  if (hasHiddenDirectorySegment(candidatePath)) {
    throw providerArtifactError(
      'provider_artifact_secret_rejected',
      'Provider artifact path looks like a secret file and cannot be delivered.',
    );
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
  if (!containsPath(input.workspaceRootCwd, realCandidatePath)) {
    throw providerArtifactError(
      'provider_artifact_outside_workspace',
      'Provider artifact path resolves outside the provider attempt workspace.',
    );
  }

  const relativeSecretCheckPath = path.relative(input.executionCwd, realCandidatePath);
  if (isSecretLikeFileName(relativeSecretCheckPath)) {
    throw providerArtifactError(
      'provider_artifact_secret_rejected',
      'Provider artifact path looks like a secret file and cannot be delivered.',
    );
  }
  if (hasHiddenDirectorySegment(relativeSecretCheckPath)) {
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
  addPathScrubVariant(scrubPaths, input.workspaceRootCwd);
  addPathScrubVariant(scrubPaths, input.requestedExecutionCwd);
  addPathScrubVariant(scrubPaths, input.requestedWorkspaceRootCwd);
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
    executionCwd: input.executionCwd,
    workspaceRootCwd: input.workspaceRootCwd,
    requestedExecutionCwd: input.requestedExecutionCwd,
    requestedWorkspaceRootCwd: input.requestedWorkspaceRootCwd,
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
  return true;
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
  let hiddenDirectoryCandidateSeen = false;
  const ignoredDirectories = new Set(['.git', 'node_modules', 'dist']);

  async function visit(directory: string, inHiddenDirectory = false): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (shouldVisitScanDirectory(entry.name, ignoredDirectories)) {
          await visit(path.join(directory, entry.name), inHiddenDirectory || entry.name.startsWith('.'));
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
      if ((inHiddenDirectory || hasHiddenDirectorySegment(path.relative(executionCwd, filePath)))
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
    throw providerArtifactError(
      'provider_artifact_secret_rejected',
      'Provider artifact path looks like a secret file and cannot be delivered.',
    );
  }
  if (hiddenDirectoryCandidateSeen) {
    throw providerArtifactError(
      'provider_artifact_secret_rejected',
      'Provider artifact path looks like a secret file and cannot be delivered.',
    );
  }
  return candidates;
}

/**
 * Tolerant variant of scanWorkspaceForCandidates for the provider execution
 * timeout fallback: it never throws, silently skips secret-like files and
 * hidden directories, and only returns a path when exactly one workspace file
 * matches the expected artifact family. Text-like output types have no
 * deliverable file artifact and always return null.
 */
export async function findProviderWorkspaceArtifactCandidate(input: {
  workspaceCwd: string | null | undefined;
  outputType: unknown;
}): Promise<string | null> {
  const expectedFamily = classifyProviderOutputType(input.outputType);
  if (expectedFamily === 'text') {
    return null;
  }
  const workspaceCwd = normalizeText(input.workspaceCwd);
  if (!workspaceCwd) {
    return null;
  }

  const candidates: string[] = [];
  const ignoredDirectories = new Set(['.git', 'node_modules', 'dist']);

  async function visit(directory: string, inHiddenDirectory = false): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name)) {
          continue;
        }
        await visit(path.join(directory, entry.name), inHiddenDirectory || entry.name.startsWith('.'));
        continue;
      }
      if (!entry.isFile() || inHiddenDirectory) {
        continue;
      }
      const filePath = path.join(directory, entry.name);
      if (isSecretLikeFileName(path.relative(workspaceCwd, filePath))) {
        continue;
      }
      if (shouldScanFile(filePath, expectedFamily)) {
        candidates.push(filePath);
      }
    }
  }

  await visit(workspaceCwd);
  return candidates.length === 1 ? candidates[0] : null;
}

async function resolveLocalArtifact(input: {
  responseText: string;
  executionCwd?: string | null;
  workspaceRootCwd?: string | null;
  expectedFamily: ProviderExpectedArtifactFamily;
}): Promise<ResolvedProviderFile> {
  const normalizedExecutionCwd = normalizeText(input.executionCwd);
  const explicitWorkspaceRootCwd = normalizeText(input.workspaceRootCwd);
  const normalizedWorkspaceRootCwd = explicitWorkspaceRootCwd || normalizedExecutionCwd;
  const realWorkspaceRootCwd = await resolveWorkspaceDirectory(normalizedWorkspaceRootCwd);
  const realExecutionCwd = await resolveWorkspaceDirectory(input.executionCwd);
  if (explicitWorkspaceRootCwd && path.resolve(explicitWorkspaceRootCwd) !== realWorkspaceRootCwd) {
    throw providerArtifactError(
      'provider_artifact_outside_workspace',
      'Provider attempt workspace no longer resolves to its original directory.',
    );
  }
  if (!containsPath(realWorkspaceRootCwd, realExecutionCwd)) {
    throw providerArtifactError(
      'provider_artifact_outside_workspace',
      'Provider execution workspace resolves outside the provider attempt workspace.',
    );
  }
  const requestedExecutionCwd = normalizedExecutionCwd
    ? path.resolve(normalizedExecutionCwd)
    : realExecutionCwd;
  const requestedWorkspaceRootCwd = normalizedWorkspaceRootCwd
    ? path.resolve(normalizedWorkspaceRootCwd)
    : realWorkspaceRootCwd;
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
      workspaceRootCwd: realWorkspaceRootCwd,
      requestedExecutionCwd,
      requestedWorkspaceRootCwd,
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
      workspaceRootCwd: realWorkspaceRootCwd,
      requestedExecutionCwd,
      requestedWorkspaceRootCwd,
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
    workspaceRootCwd: realWorkspaceRootCwd,
    requestedExecutionCwd,
    requestedWorkspaceRootCwd,
    expectedFamily: input.expectedFamily,
  });
}

function parseVerifiedUploadMetafile(result: UploadLargeFileResult): A2ADeliveryArtifact {
  const base = parseMetafileUri(normalizeText(result.metafileUri));
  if (!base) {
    throw providerArtifactError(
      'provider_artifact_upload_invalid',
      'Provider artifact upload returned an invalid metafile URI.',
    );
  }

  if (normalizeText(result.pinId) !== base.pinId) {
    throw providerArtifactError(
      'provider_artifact_upload_invalid',
      'Provider artifact upload returned inconsistent metafile and PIN identifiers.',
    );
  }

  return base;
}

function safeArtifactFileName(value: unknown, fallback: string | null): string | null {
  if (typeof value !== 'string' || UNSAFE_STRUCTURED_METADATA_CHARACTER.test(value)) {
    return fallback;
  }
  const trimmed = value.trim();
  if (
    !trimmed
    || trimmed.includes('/')
    || trimmed.includes('\\')
    || trimmed.includes('://')
    || /^[a-z]:/i.test(trimmed)
    || isSecretLikeFileName(trimmed)
  ) {
    return fallback;
  }
  return trimmed;
}

function safeArtifactContentType(value: unknown): string | null {
  if (typeof value !== 'string' || UNSAFE_STRUCTURED_METADATA_CHARACTER.test(value)) {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  if (
    !trimmed
    || trimmed.startsWith('/')
    || trimmed.startsWith('./')
    || trimmed.startsWith('../')
    || trimmed.includes('\\')
    || trimmed.includes('://')
    || /^[a-z]:/i.test(trimmed)
    || !SAFE_CONTENT_TYPE_PATTERN.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

function safeArtifactExtension(value: unknown): string | null {
  if (typeof value !== 'string' || UNSAFE_STRUCTURED_METADATA_CHARACTER.test(value)) {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  if (
    !trimmed
    || trimmed.includes('/')
    || trimmed.includes('\\')
    || trimmed.includes('://')
    || /^[a-z]:/i.test(trimmed)
    || isSecretLikeFileName(trimmed)
    || !/^\.[a-z0-9][a-z0-9+-]{0,31}$/.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

function uploadResultToArtifact(result: UploadLargeFileResult): A2ADeliveryArtifact {
  const base = parseVerifiedUploadMetafile(result);
  const urls = buildMetafileContentUrls(base.pinId);
  const contentType = safeArtifactContentType(result.contentType);
  const extension = base.extension ?? safeArtifactExtension(result.extension);
  const uri = extension ? appendMetafileUriExtension(base.uri, extension) : base.uri;
  const kind: A2ADeliveryArtifactKind = inferDeliveryArtifactKind(extension, contentType);

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

function ensureUploadVerification(result: UploadLargeFileResult): void {
  parseVerifiedUploadMetafile(result);
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

function scrubFileUriLocalPathMentions(responseText: string, localPath: string): string {
  if (!path.isAbsolute(localPath) && !/^[A-Za-z]:[\\/]/.test(localPath)) {
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

function scrubLocalPathMentions(responseText: string, scrubPaths: string[]): string {
  let scrubbed = String(responseText || '');
  const sortedPaths = [...new Set(scrubPaths)]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);

  for (const localPath of sortedPaths) {
    scrubbed = scrubFileUriLocalPathMentions(scrubbed, localPath);
    const pattern = path.isAbsolute(localPath) || localPath.startsWith(`.${path.sep}`)
      ? escapeRegExp(localPath)
      : `(?<![A-Za-z0-9_.\\\\/-])${escapeRegExp(localPath)}`;
    scrubbed = scrubbed.replace(new RegExp(pattern, 'g'), '[uploaded artifact]');
  }

  return scrubbed.replace(/[ \t]+/g, ' ').trim();
}

function scrubAbsoluteProviderLocalHints(responseText: string): string {
  let scrubbed = String(responseText || '');

  for (const pathHintPattern of absoluteProviderLocalHintPatterns()) {
    scrubbed = scrubbed.replace(pathHintPattern, '[uploaded artifact]');
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
      mentions.add(token);
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
    scrubbed = scrubFileUriLocalPathMentions(scrubbed, root);
    const pattern = `${escapeRegExp(root)}(?:[\\\\/][^\\s;,)\\]}>"'\`]+)*(?=$|[^A-Za-z0-9_.\\\\/-])`;
    scrubbed = scrubbed.replace(new RegExp(pattern, 'g'), '[uploaded artifact]');
  }

  const relativeMentions = await collectRelativeExecutionPathMentions(scrubbed, realExecutionCwd);
  return scrubLocalPathMentions(scrubbed, relativeMentions);
}

async function snapshotProviderArtifactForUpload(
  file: ResolvedProviderFile,
): Promise<ProviderArtifactUploadSnapshot> {
  let snapshotDirectory: string | null = null;
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;

  try {
    snapshotDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'oac-provider-artifact-upload-'));
    const snapshotPath = path.join(snapshotDirectory, path.basename(file.filePath));
    const noFollow = (fsConstants as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0;
    handle = await fs.open(file.filePath, fsConstants.O_RDONLY | noFollow);
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw providerArtifactError('provider_artifact_missing', 'Provider artifact must be a regular file.');
    }
    if (stat.size > LARGE_UPLOAD_MAX_BYTES) {
      throw providerArtifactError(
        'provider_artifact_too_large',
        `Provider artifact exceeds the maximum upload size of ${LARGE_UPLOAD_MAX_BYTES} bytes.`,
      );
    }

    const currentRealPath = await fs.realpath(file.filePath);
    if (
      !containsPath(file.executionCwd, currentRealPath)
      || !containsPath(file.workspaceRootCwd, currentRealPath)
    ) {
      throw providerArtifactError(
        'provider_artifact_outside_workspace',
        'Provider artifact path resolves outside the provider attempt workspace.',
      );
    }

    const artifactBytes = await handle.readFile();
    if (artifactBytes.byteLength > LARGE_UPLOAD_MAX_BYTES) {
      throw providerArtifactError(
        'provider_artifact_too_large',
        `Provider artifact exceeds the maximum upload size of ${LARGE_UPLOAD_MAX_BYTES} bytes.`,
      );
    }
    await fs.writeFile(snapshotPath, artifactBytes, { mode: 0o600 });
    return {
      filePath: snapshotPath,
      directory: snapshotDirectory,
    };
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => undefined);
      handle = null;
    }
    if (snapshotDirectory) {
      await fs.rm(snapshotDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
    if (error instanceof ProviderDeliveryArtifactError) {
      throw error;
    }
    throw providerArtifactError('provider_artifact_missing', 'Provider artifact file was not found.');
  } finally {
    if (handle) {
      await handle.close().catch(() => undefined);
    }
  }
}

async function uploadResolvedLocalArtifact(input: {
  file: ResolvedProviderFile;
  expectedFamily: ProviderExpectedArtifactFamily;
  signer: Signer;
  network?: string | null;
  uploadLargeFile?: typeof uploadLargeFileToChain;
  verifyAvailability?: VerifyAvailability;
  largeUploader?: LargeUploader;
  mvcSponsorClient?: MvcSponsorClient;
}): Promise<A2ADeliveryArtifact> {
  const uploader = input.uploadLargeFile ?? uploadLargeFileToChain;
  const snapshot = await snapshotProviderArtifactForUpload(input.file);

  let uploadResult: UploadLargeFileResult;
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
  } catch (error) {
    const code = error instanceof Error ? (error as Error & { code?: unknown }).code : undefined;
    if (code === 'large_file_upload_unavailable') {
      throw error;
    }
    const rawMessage = error instanceof Error ? error.message : 'Provider artifact upload failed.';
    const scrubbedMessage = await scrubExecutionWorkspacePathMentions(
      rawMessage,
      input.file.requestedExecutionCwd,
    );
    const uploadSafeMessage = scrubLocalPathMentions(
      scrubbedMessage,
      [snapshot.filePath, snapshot.directory],
    );
    throw providerArtifactError(
      'provider_artifact_upload_failed',
      uploadSafeMessage,
      readUploadFailureData(error),
    );
  } finally {
    await fs.rm(snapshot.directory, { recursive: true, force: true }).catch(() => undefined);
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

  assertNoSecretLikeProviderLocalHints(responseText);

  const existingArtifacts = await resolveExistingMetafileArtifacts({
    responseText,
    expectedFamily,
    verifyAvailability: input.verifyAvailability,
  });
  if (existingArtifacts.length > 0) {
    const providerSafeResponseText = stripProviderOnlyLocalHintLines(responseText);
    const workspaceSafeResponseText = await scrubExecutionWorkspacePathMentions(
      providerSafeResponseText,
      input.executionCwd,
    );
    return {
      responseText: appendDeliveryArtifactSummaries(workspaceSafeResponseText, existingArtifacts),
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
  const workspaceScrubbedResponseText = await scrubExecutionWorkspacePathMentions(
    publicResponseText,
    input.executionCwd,
  );
  const providerSafeResponseText = scrubLocalPathMentions(
    workspaceScrubbedResponseText,
    localFile.scrubPaths,
  );
  const absoluteSafeResponseText = scrubAbsoluteProviderLocalHints(providerSafeResponseText);
  assertNoAbsoluteProviderLocalHints(absoluteSafeResponseText);

  return {
    responseText: appendDeliveryArtifactSummaries(absoluteSafeResponseText, [artifact]),
    artifacts: [artifact],
  };
}
