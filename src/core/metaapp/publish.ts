import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  commandAwaitingConfirmation,
  commandFailed,
  commandManualActionRequired,
  commandSuccess,
  type MetabotCommandResult,
} from '../contracts/commandResult';
import { buildMetaAppManifestDraft } from './manifest';
import { assertMetaAppPinId } from './pinId';
import { inspectMetaAppProject } from './projectInspector';
import {
  buildMetaAppBuzzRequest,
  buildMetaAppCanonicalUrl,
  buildMetaAppCommentWrite,
  buildMetaAppShareBundle,
} from './share';
import type {
  MetaAppGalleryRecord,
  MetaAppManifestInput,
  MetaAppPreviewPlan,
  MetaAppWarning,
} from './types';
import { writeMetaAppZipArchive } from './zipArchive';

const METAAPP_RUNTIME_URI_PREVIEW = 'metafile://<uploaded-metaapp-zip-pin>';

export interface UploadLikeResult {
  pinId?: string;
  txids?: string[];
  network?: string;
  filePath?: string;
  contentType?: string;
  bytes?: number;
  metafileUri?: string;
  globalMetaId?: string;
  [key: string]: unknown;
}

export interface ChainLikeResult {
  pinId?: string;
  firstPinId?: string;
  txids?: string[];
  totalCost?: number;
  network?: string;
  operation?: string;
  path?: string;
  contentType?: string;
  globalMetaId?: string;
  mvcAddress?: string;
  [key: string]: unknown;
}

export interface BuzzLikeResult {
  pinId?: string;
  txids?: string[];
  network?: string;
  content?: string;
  contentType?: string;
  quotePin?: string;
  globalMetaId?: string;
  [key: string]: unknown;
}

export interface MetaAppPublishDependencies {
  uploadFile: (input: { filePath: string; contentType?: string; network?: string }) => Promise<UploadLikeResult>;
  writeChain: (input: Record<string, unknown>) => Promise<ChainLikeResult>;
  upsertLocal: (record: MetaAppGalleryRecord) => Promise<unknown>;
  postBuzz?: (input: Record<string, unknown>) => Promise<BuzzLikeResult>;
  createPreviewSession?: (input: { artifactDir: string; indexFile: string }) => {
    previewId: string;
    localPreviewUrl: string;
  };
  readExistingMetaApp?: (pinId: string) => Promise<MetaAppGalleryRecord | null>;
  now?: () => number;
  makeTempDir?: () => Promise<string>;
}

export type MetaAppPreviewDependencies = Partial<Pick<
  MetaAppPublishDependencies,
  'createPreviewSession'
>>;

export type MetaAppAnnounceDependencies = Partial<Pick<
  MetaAppPublishDependencies,
  'postBuzz'
>>;

export type MetaAppCommentDependencies = Partial<Pick<
  MetaAppPublishDependencies,
  'writeChain'
>>;

export interface MetaAppProjectInput {
  cwd?: string;
  projectDir: string;
  manifestFile?: string;
  open?: boolean;
}

export interface MetaAppPublishInput extends MetaAppProjectInput {
  confirm?: boolean;
  network?: string;
  compatibilityMirrorContent?: boolean;
}

export interface MetaAppUpdateInput extends MetaAppPublishInput {
  targetPinId: string;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function stripZipSuffixFromMetafileUri(value: string): string {
  const normalized = normalizeText(value);
  if (!/^metafile:\/\//iu.test(normalized)) {
    return normalized;
  }
  return normalized.replace(/\.zip(?=([?#].*)?$)/iu, '');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function slugFromProjectDir(projectDir: string): string {
  const baseName = path.basename(projectDir) || 'metaapp';
  const slug = baseName.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'metaapp';
}

function setIfDefined(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

function cleanManifestForPayload(manifest: MetaAppManifestInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const key of [
    'title',
    'appName',
    'prompt',
    'icon',
    'coverImg',
    'introImgs',
    'intro',
    'runtime',
    'indexFile',
    'version',
    'contentType',
    'content',
    'code',
    'contentHash',
    'metadata',
    'tags',
    'disabled',
    'codeType',
  ]) {
    setIfDefined(payload, key, (manifest as Record<string, unknown>)[key]);
  }
  return payload;
}

function applyPreviousMetaAppInheritance(
  draft: MetaAppManifestInput,
  plan: MetaAppPreviewPlan,
  previous: MetaAppGalleryRecord,
): MetaAppManifestInput {
  const explicit = plan.manifest as Record<string, unknown>;
  const inherited = { ...draft };
  const previousRecord = previous as MetaAppGalleryRecord & MetaAppManifestInput;

  for (const field of ['title', 'appName', 'intro', 'icon', 'coverImg', 'runtime', 'indexFile'] as const) {
    const value = normalizeText(previousRecord[field]);
    if (explicit[field] === undefined && value) {
      inherited[field] = value;
    }
  }

  if (explicit.tags === undefined && previous.tags.length > 0) {
    inherited.tags = [...previous.tags];
  }

  return inherited;
}

function finalizeManifestForWrite(input: {
  plan: MetaAppPreviewPlan;
  manifest: MetaAppManifestInput;
  artifactUri: string;
  contentHash: string;
  compatibilityMirrorContent?: boolean;
}): MetaAppManifestInput {
  const fallbackAppName = slugFromProjectDir(input.plan.projectDir);
  const title = normalizeText(input.manifest.title) || normalizeText(input.manifest.appName) || fallbackAppName;
  const appName = normalizeText(input.manifest.appName) || slugFromProjectDir(title);
  const artifactUri = stripZipSuffixFromMetafileUri(input.artifactUri);
  const explicitCode = stripZipSuffixFromMetafileUri(normalizeText(input.manifest.code));
  const code = explicitCode || (
    input.plan.projectType === 'static' || input.compatibilityMirrorContent
      ? artifactUri
      : ''
  );

  return {
    ...input.manifest,
    title,
    appName,
    runtime: normalizeText(input.manifest.runtime) || 'browser',
    version: normalizeText(input.manifest.version) || '1.0.0',
    indexFile: normalizeText(input.manifest.indexFile) || input.plan.indexFile,
    contentType: normalizeText(input.manifest.contentType) || 'application/zip',
    codeType: normalizeText(input.manifest.codeType) || 'application/zip',
    code,
    content: artifactUri,
    contentHash: input.contentHash,
  };
}

function buildLocalUiUrl(pinId: string): string {
  return `/ui/metaapps?pinId=${encodeURIComponent(pinId)}`;
}

function buildGalleryRecord(input: {
  operation: 'create' | 'modify';
  pinId: string;
  firstPinId: string;
  manifest: MetaAppManifestInput;
  chainWrite: ChainLikeResult;
  upload: UploadLikeResult;
  now: number;
}): MetaAppGalleryRecord {
  return {
    pinId: input.pinId,
    firstPinId: input.firstPinId,
    operation: input.operation,
    title: normalizeText(input.manifest.title) || input.pinId,
    appName: normalizeText(input.manifest.appName) || input.pinId,
    prompt: normalizeText(input.manifest.prompt) || undefined,
    icon: normalizeText(input.manifest.icon) || undefined,
    coverImg: normalizeText(input.manifest.coverImg) || undefined,
    introImgs: normalizeStringArray(input.manifest.introImgs),
    intro: normalizeText(input.manifest.intro) || undefined,
    version: normalizeText(input.manifest.version) || '1.0.0',
    runtime: normalizeText(input.manifest.runtime) || 'browser',
    indexFile: normalizeText(input.manifest.indexFile) || 'index.html',
    code: normalizeText(input.manifest.code),
    content: normalizeText(input.manifest.content),
    contentType: normalizeText(input.manifest.contentType) || 'application/zip',
    codeType: normalizeText(input.manifest.codeType) || 'application/zip',
    tags: normalizeStringArray(input.manifest.tags),
    ownerGlobalMetaId: normalizeText(input.chainWrite.globalMetaId ?? input.upload.globalMetaId),
    ownerAddress: normalizeText(input.chainWrite.mvcAddress),
    network: normalizeText(input.chainWrite.network ?? input.upload.network) || 'mvc',
    metawebUrl: buildMetaAppCanonicalUrl(input.pinId),
    localUiUrl: buildLocalUiUrl(input.pinId),
    updatedAt: input.now,
    source: 'local',
    raw: {
      chainWrite: input.chainWrite,
      upload: input.upload,
    },
  };
}

async function inspectAndDraft(input: MetaAppProjectInput): Promise<{
  plan: MetaAppPreviewPlan;
  manifest: MetaAppManifestInput;
}> {
  const plan = await inspectMetaAppProject({
    cwd: input.cwd,
    projectDir: input.projectDir,
    manifestFile: input.manifestFile,
  });
  return {
    plan,
    manifest: buildMetaAppManifestDraft(plan),
  };
}

function createPreviewData(
  input: MetaAppProjectInput,
  deps: MetaAppPreviewDependencies,
  plan: MetaAppPreviewPlan,
  manifest: MetaAppManifestInput,
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    plan,
    manifest,
  };

  if (plan.artifactDir && deps.createPreviewSession) {
    const previewSession = deps.createPreviewSession({
      artifactDir: plan.artifactDir,
      indexFile: normalizeText(manifest.indexFile) || plan.indexFile,
    });
    data.previewId = previewSession.previewId;
    data.localPreviewUrl = previewSession.localPreviewUrl;
    if (input.open) {
      data.localUiUrl = previewSession.localPreviewUrl;
    }
  }

  return data;
}

function manualActionResult(plan: MetaAppPreviewPlan, manifest: MetaAppManifestInput): MetabotCommandResult<never> {
  const manualAction = plan.manualAction ?? {
    code: 'metaapp_artifact_missing',
    message: 'The project does not have a detected runtime artifact directory.',
  };
  return commandManualActionRequired(manualAction.code, manualAction.message, {
    data: {
      plan,
      manifest,
    },
  });
}

async function makeArchive(input: {
  deps: MetaAppPublishDependencies;
  artifactDir: string;
}): Promise<{ filePath: string; bytes: number; sha256: string; entries: string[] }> {
  const tempDir = input.deps.makeTempDir
    ? await input.deps.makeTempDir()
    : await fs.mkdtemp(path.join(os.tmpdir(), 'metabot-metaapp-'));
  return writeMetaAppZipArchive({
    sourceDir: input.artifactDir,
    outFile: path.join(tempDir, 'metaapp.zip'),
  });
}

async function createConfirmationData(
  input: MetaAppPublishInput,
  deps: MetaAppPublishDependencies,
  plan: MetaAppPreviewPlan,
  manifest: MetaAppManifestInput,
): Promise<Record<string, unknown>> {
  const data = createPreviewData(input, deps, plan, manifest);
  if (!plan.artifactDir) {
    return data;
  }

  const archive = await makeArchive({ deps, artifactDir: plan.artifactDir });
  data.archivePreview = {
    bytes: archive.bytes,
    sha256: archive.sha256,
    entries: archive.entries,
  };
  data.payloadPreview = cleanManifestForPayload(finalizeManifestForWrite({
    plan,
    manifest,
    artifactUri: METAAPP_RUNTIME_URI_PREVIEW,
    contentHash: archive.sha256,
    compatibilityMirrorContent: input.compatibilityMirrorContent,
  }));
  return data;
}

function uploadArtifactUri(upload: UploadLikeResult): string {
  const metafileUri = normalizeText(upload.metafileUri);
  if (metafileUri) {
    return stripZipSuffixFromMetafileUri(metafileUri);
  }
  const pinId = normalizeText(upload.pinId);
  if (pinId) {
    return `metafile://${pinId}`;
  }
  throw new Error('Upload result did not include a metafile URI or pinId.');
}

async function writePublishedMetaApp(input: {
  operation: 'create' | 'modify';
  path: string;
  plan: MetaAppPreviewPlan;
  manifest: MetaAppManifestInput;
  targetPinId?: string;
  network?: string;
  compatibilityMirrorContent?: boolean;
  deps: MetaAppPublishDependencies;
  warnings: MetaAppWarning[];
}): Promise<MetabotCommandResult<Record<string, unknown>>> {
  if (!input.plan.artifactDir) {
    return manualActionResult(input.plan, input.manifest);
  }
  if (!input.deps.uploadFile) {
    return commandFailed('metaapp_upload_failed', 'MetaApp publish requires an upload dependency.');
  }
  if (!input.deps.writeChain) {
    return commandFailed('metaapp_publish_failed', 'MetaApp publish requires a chain write dependency.');
  }
  if (!input.deps.upsertLocal) {
    return commandFailed('metaapp_cache_unavailable', 'MetaApp publish requires a local cache dependency before writing on-chain.');
  }

  const archive = await makeArchive({
    deps: input.deps,
    artifactDir: input.plan.artifactDir,
  });

  let upload: UploadLikeResult;
  try {
    upload = await input.deps.uploadFile({
      filePath: archive.filePath,
      contentType: 'application/zip',
      network: input.network,
    });
  } catch (error) {
    return commandFailed('metaapp_upload_failed', `Unable to upload MetaApp archive: ${errorMessage(error)}`, {
      data: { archive },
    });
  }

  const artifactUri = uploadArtifactUri(upload);
  const manifest = finalizeManifestForWrite({
    plan: input.plan,
    manifest: input.manifest,
    artifactUri,
    contentHash: archive.sha256,
    compatibilityMirrorContent: input.compatibilityMirrorContent,
  });
  const payload = cleanManifestForPayload(manifest);

  let chainWrite: ChainLikeResult;
  try {
    chainWrite = await input.deps.writeChain({
      operation: input.operation,
      path: input.path,
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      network: input.network,
    });
  } catch (error) {
    return commandFailed('metaapp_publish_failed', `Unable to write MetaApp protocol payload: ${errorMessage(error)}`, {
      data: {
        archive,
        upload,
        payload,
      },
    });
  }

  const pinId = assertMetaAppPinId(chainWrite.pinId, 'chain write pinId');
  const firstPinId = input.operation === 'modify'
    ? normalizeText(chainWrite.firstPinId) || input.targetPinId || pinId
    : normalizeText(chainWrite.firstPinId) || pinId;
  const now = input.deps.now ? input.deps.now() : Date.now();
  const record = buildGalleryRecord({
    operation: input.operation,
    pinId,
    firstPinId,
    manifest,
    chainWrite,
    upload,
    now,
  });

  const warnings = [...input.warnings];
  try {
    await input.deps.upsertLocal(record);
  } catch (error) {
    warnings.push({
      code: 'metaapp_local_cache_upsert_failed',
      message: `Unable to update local MetaApp cache: ${errorMessage(error)}`,
    });
  }

  return commandSuccess({
    pinId,
    firstPinId,
    metawebUrl: buildMetaAppCanonicalUrl(pinId),
    localUiUrl: buildLocalUiUrl(pinId),
    archive,
    upload,
    chainWrite,
    record,
    warnings,
  });
}

export async function previewMetaAppProject(
  input: MetaAppProjectInput,
  deps: MetaAppPreviewDependencies = {},
): Promise<MetabotCommandResult<Record<string, unknown>> & { localUiUrl?: string }> {
  const { plan, manifest } = await inspectAndDraft(input);
  if (plan.manualAction || !plan.artifactDir) {
    return manualActionResult(plan, manifest);
  }

  const data = createPreviewData(input, deps, plan, manifest);
  const result = commandSuccess(data) as MetabotCommandResult<Record<string, unknown>> & { localUiUrl?: string };
  if (input.open && typeof data.localPreviewUrl === 'string') {
    result.localUiUrl = data.localPreviewUrl;
  }
  return result;
}

export async function publishMetaApp(
  input: MetaAppPublishInput,
  deps: MetaAppPublishDependencies,
): Promise<MetabotCommandResult<Record<string, unknown>>> {
  const { plan, manifest } = await inspectAndDraft(input);
  if (plan.manualAction || !plan.artifactDir) {
    return manualActionResult(plan, manifest);
  }

  if (!input.confirm) {
    return commandAwaitingConfirmation(await createConfirmationData(input, deps, plan, manifest));
  }

  return writePublishedMetaApp({
    operation: 'create',
    path: '/protocols/metaapp',
    plan,
    manifest,
    network: input.network,
    compatibilityMirrorContent: input.compatibilityMirrorContent,
    deps,
    warnings: [],
  });
}

export async function updateMetaApp(
  input: MetaAppUpdateInput,
  deps: MetaAppPublishDependencies,
): Promise<MetabotCommandResult<Record<string, unknown>>> {
  const targetPinId = assertMetaAppPinId(input.targetPinId, 'targetPinId');
  const warnings: MetaAppWarning[] = [];
  const { plan, manifest: draftManifest } = await inspectAndDraft(input);
  let manifest = draftManifest;

  if (deps.readExistingMetaApp) {
    try {
      const previous = await deps.readExistingMetaApp(targetPinId);
      if (previous) {
        manifest = applyPreviousMetaAppInheritance(draftManifest, plan, previous);
      }
    } catch (error) {
      warnings.push({
        code: 'metaapp_previous_lookup_failed',
        message: `Unable to inherit previous MetaApp metadata: ${errorMessage(error)}`,
      });
    }
  }

  if (plan.manualAction || !plan.artifactDir) {
    return manualActionResult(plan, manifest);
  }

  if (!input.confirm) {
    const preview = await createConfirmationData(input, deps, plan, manifest);
    preview.targetPinId = targetPinId;
    preview.warnings = warnings;
    return commandAwaitingConfirmation(preview);
  }

  return writePublishedMetaApp({
    operation: 'modify',
    path: `@${targetPinId}`,
    plan,
    manifest,
    targetPinId,
    network: input.network,
    compatibilityMirrorContent: input.compatibilityMirrorContent,
    deps,
    warnings,
  });
}

export async function shareMetaApp(
  input: { pinId: string },
  _deps?: unknown,
): Promise<MetabotCommandResult<Record<string, unknown>>> {
  return commandSuccess(buildMetaAppShareBundle(input.pinId));
}

export async function announceMetaAppShare(
  input: { pinId: string; message?: string; network?: string },
  deps: MetaAppAnnounceDependencies,
): Promise<MetabotCommandResult<Record<string, unknown>>> {
  const share = buildMetaAppShareBundle(input.pinId);
  if (!deps.postBuzz) {
    return commandFailed('metaapp_share_announcement_failed', 'MetaApp share announcement requires a buzz dependency.', {
      data: { share },
    });
  }

  const request = buildMetaAppBuzzRequest(input);
  try {
    const announcement = await deps.postBuzz({
      ...request,
      network: input.network,
    });
    return commandSuccess({
      share,
      announcement,
    });
  } catch (error) {
    return commandFailed('metaapp_share_announcement_failed', `Unable to announce MetaApp share: ${errorMessage(error)}`, {
      data: { share },
    });
  }
}

export async function commentMetaApp(
  input: { pinId: string; comment: string; network?: string },
  deps: MetaAppCommentDependencies,
): Promise<MetabotCommandResult<Record<string, unknown>>> {
  if (!deps.writeChain) {
    return commandFailed('metaapp_comment_failed', 'MetaApp comment requires a chain write dependency.');
  }

  const write = buildMetaAppCommentWrite(input);
  try {
    const chainWrite = await deps.writeChain({
      ...write,
      network: input.network,
    });
    const commentPinId = assertMetaAppPinId(chainWrite.pinId, 'comment pinId');
    return commandSuccess({
      commentPinId,
      commentTo: assertMetaAppPinId(input.pinId),
      network: normalizeText(chainWrite.network ?? input.network) || 'mvc',
      txids: Array.isArray(chainWrite.txids) ? chainWrite.txids : [],
      chainWrite,
    });
  } catch (error) {
    return commandFailed('metaapp_comment_failed', `Unable to comment on MetaApp: ${errorMessage(error)}`);
  }
}
