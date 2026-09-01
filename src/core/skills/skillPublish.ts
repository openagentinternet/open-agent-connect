/**
 * On-chain skill package publishing — OAC port of the IDBots
 * metabot-post-skill producer half, the mirror of skillInstall. Packages a
 * local skill directory as a metabot-skill zip, uploads it as a `/file` pin,
 * and writes the `/protocols/metabot-skill` JSON pin that advertises it to
 * learners (publisher identity comes from pin authorship, never the payload).
 *
 * Stricter than the IDBots script on the three points the install side
 * depends on: the payload name must satisfy normalizeSkillName (otherwise the
 * package cannot be installed by payload name), `version` is required with no
 * default (consumers dedupe by name and keep the highest version), and the
 * pinned metadata is derived from the package SKILL.md frontmatter so the two
 * can never disagree — flags may override, the merged result must validate.
 */

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { commandAwaitingConfirmation, commandSuccess, type MetabotCommandResult } from '../contracts/commandResult';
import { metafileUriFromPinId } from '../files/metafileUri';
import { writeMetaAppZipArchive } from '../metaapp/zipArchive';
import { MAX_SKILL_PACKAGE_BYTES, normalizeSkillName, parseSkillFrontmatter } from './skillInstall';

/** Parity with IDBots: the protocol path learners and indexers scan. */
export const SKILL_PROTOCOL_PATH = '/protocols/metabot-skill';

const SKILL_DOC_FILENAMES = ['SKILL.md', 'skill.md', 'Skill.md'];
const PREVIEW_PACKAGE_URI = 'metafile://<uploaded-skill-zip-pin>.zip';

export class SkillPublishError extends Error {
  code: 'invalid_project' | 'package_too_large' | 'invalid_metadata' | 'publish_failed';

  constructor(
    code: 'invalid_project' | 'package_too_large' | 'invalid_metadata' | 'publish_failed',
    message: string,
  ) {
    super(message);
    this.name = 'SkillPublishError';
    this.code = code;
  }
}

export interface SkillPublishUploadResult {
  pinId?: string;
  metafileUri?: string;
  txids?: string[];
  network?: string;
  [key: string]: unknown;
}

export interface SkillPublishChainResult {
  pinId?: string;
  firstPinId?: string;
  txids?: string[];
  totalCost?: number;
  network?: string;
  [key: string]: unknown;
}

export interface SkillPublishDependencies {
  uploadFile: (input: { filePath: string; contentType?: string; network?: string }) => Promise<SkillPublishUploadResult>;
  writeChain: (input: Record<string, unknown>) => Promise<SkillPublishChainResult>;
  makeTempDir?: () => Promise<string>;
}

export interface SkillPublishInput {
  skillDir: string;
  name?: string;
  version?: string;
  description?: string;
  network?: string;
  confirm?: boolean;
}

export interface SkillPublishPlan {
  skillDir: string;
  skillMdPath: string;
  name: string;
  version: string;
  description: string;
  network: string;
  archive: { bytes: number; sha256: string; fileCount: number };
  /** The pin payload as it will be written; `skill-file` is a placeholder until upload. */
  payload: Record<string, string>;
  warnings: string[];
}

export interface SkillPublishResult {
  name: string;
  version: string;
  description: string;
  pinId: string;
  skillFileUri: string;
  payload: Record<string, string>;
  archive: { bytes: number; sha256: string; fileCount: number };
  upload: SkillPublishUploadResult;
  chainWrite: SkillPublishChainResult;
  formatted: string;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function findSkillDoc(dir: string): Promise<string | null> {
  for (const candidate of SKILL_DOC_FILENAMES) {
    if (await fileExists(path.join(dir, candidate))) {
      return path.join(dir, candidate);
    }
  }
  return null;
}

/**
 * The directory to package: the given dir when it carries the SKILL.md, else
 * its single skill-bearing subdirectory (the "pointed at the parent" case),
 * mirroring install's unwrap tolerance. Deeper nesting is ambiguous and
 * refused.
 */
export async function resolveSkillPackageRoot(skillDir: string): Promise<{ packageRoot: string; skillMdPath: string }> {
  const resolved = path.resolve(skillDir);
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new SkillPublishError('invalid_project', `Skill directory not found: ${skillDir}`);
  }
  const direct = await findSkillDoc(resolved);
  if (direct) {
    return { packageRoot: resolved, skillMdPath: direct };
  }
  const entries = await fs.readdir(resolved, { withFileTypes: true }).catch(() => []);
  const candidates: Array<{ packageRoot: string; skillMdPath: string }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === '__MACOSX') continue;
    const nestedRoot = path.join(resolved, entry.name);
    const nestedDoc = await findSkillDoc(nestedRoot);
    if (nestedDoc) candidates.push({ packageRoot: nestedRoot, skillMdPath: nestedDoc });
  }
  if (candidates.length === 1) {
    return candidates[0];
  }
  throw new SkillPublishError(
    'invalid_project',
    candidates.length
      ? `Skill directory is ambiguous: multiple skill-bearing subdirectories under ${skillDir}.`
      : `No SKILL.md found in ${skillDir} — a metabot-skill package is a directory whose root (or single subdirectory) carries SKILL.md.`,
  );
}

/** The canonical pin payload; only non-empty optional fields ride along. */
export function buildSkillPinPayload(input: {
  name: string;
  version: string;
  description?: string;
  skillFileUri: string;
}): Record<string, string> {
  const payload: Record<string, string> = {
    name: input.name,
    version: input.version,
    'skill-file': input.skillFileUri,
  };
  const description = normalizeText(input.description);
  if (description) payload.description = description;
  return payload;
}

async function buildPlan(input: SkillPublishInput, makeTempDir: () => Promise<string>): Promise<{
  plan: SkillPublishPlan;
  archivePath: string;
  cleanup: () => Promise<void>;
}> {
  const { packageRoot, skillMdPath } = await resolveSkillPackageRoot(input.skillDir);
  const frontmatter = parseSkillFrontmatter(await fs.readFile(skillMdPath, 'utf8'));

  const warnings: string[] = [];
  if (packageRoot !== path.resolve(input.skillDir)) {
    warnings.push(`SKILL.md sits in the subdirectory ${path.basename(packageRoot)}; that subdirectory is packaged.`);
  }

  const name = normalizeSkillName(normalizeText(input.name) || frontmatter.name);
  if (!name) {
    throw new SkillPublishError(
      'invalid_metadata',
      `Invalid skill name: ${normalizeText(input.name) || frontmatter.name || '(none)'} — 1-64 chars, starts alphanumeric, then [A-Za-z0-9._-].`,
    );
  }
  const version = normalizeText(input.version) || normalizeText(frontmatter.version);
  if (!version) {
    throw new SkillPublishError(
      'invalid_metadata',
      'Skill version is required (SKILL.md frontmatter `version` or --version) — consumers keep the highest version per name.',
    );
  }
  const description = normalizeText(input.description) || normalizeText(frontmatter.description);

  const tempDir = await makeTempDir();
  const archivePath = path.join(tempDir, `metabot-skill-${name}-${randomUUID()}.zip`);
  let archive: { bytes: number; sha256: string; entries: string[] };
  try {
    archive = await writeMetaAppZipArchive({ sourceDir: packageRoot, outFile: archivePath });
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    throw new SkillPublishError(
      'invalid_project',
      `Skill package could not be built: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (archive.bytes > MAX_SKILL_PACKAGE_BYTES) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    throw new SkillPublishError(
      'package_too_large',
      `Skill package exceeds the ${Math.round(MAX_SKILL_PACKAGE_BYTES / 1024)} KB cap (${Math.round(archive.bytes / 1024)} KB).`,
    );
  }

  return {
    plan: {
      skillDir: packageRoot,
      skillMdPath,
      name,
      version,
      description,
      network: normalizeText(input.network).toLowerCase() || 'mvc',
      archive: { bytes: archive.bytes, sha256: archive.sha256, fileCount: archive.entries.length },
      payload: buildSkillPinPayload({ name, version, description, skillFileUri: PREVIEW_PACKAGE_URI }),
      warnings,
    },
    archivePath,
    cleanup: async () => {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

function planSummary(plan: SkillPublishPlan): string {
  return [
    `Publish skill "${plan.name}" v${plan.version}`,
    plan.description ? `Description: ${plan.description}` : '',
    `Package: ${plan.archive.bytes} bytes (sha256 ${plan.archive.sha256.slice(0, 12)}…), ${plan.archive.fileCount} files`,
    `Chain pin: ${SKILL_PROTOCOL_PATH} on ${plan.network} (publisher = the signing bot)`,
  ].filter(Boolean).join('\n');
}

/**
 * Build the publish plan without writing anything: resolves the package root,
 * merges frontmatter with flag overrides, validates, and produces the real
 * archive so the confirmation shows actual bytes and checksum.
 */
export async function previewSkillProject(
  input: SkillPublishInput,
  deps?: Pick<SkillPublishDependencies, 'makeTempDir'>,
): Promise<SkillPublishPlan> {
  const makeTempDir = deps?.makeTempDir ?? (() => fs.mkdtemp(path.join(os.tmpdir(), 'metabot-skill-publish-')));
  const { plan, cleanup } = await buildPlan(input, makeTempDir);
  await cleanup();
  return plan;
}

/**
 * Publish a skill directory on-chain. Without `confirm`, returns the
 * awaiting-confirmation envelope carrying the plan; with it, uploads the
 * package and writes the metabot-skill protocol pin.
 */
export async function publishSkill(
  input: SkillPublishInput,
  deps: SkillPublishDependencies,
): Promise<MetabotCommandResult<SkillPublishResult | { plan: SkillPublishPlan; formatted: string }>> {
  const makeTempDir = deps.makeTempDir ?? (() => fs.mkdtemp(path.join(os.tmpdir(), 'metabot-skill-publish-')));
  const { plan, archivePath, cleanup } = await buildPlan(input, makeTempDir);
  try {
    if (!input.confirm) {
      const formatted = `${planSummary(plan)}\nRe-run with --confirm to publish.`;
      return commandAwaitingConfirmation({ plan, formatted });
    }

    let upload: SkillPublishUploadResult;
    let chainWrite: SkillPublishChainResult;
    let payload: Record<string, string>;
    let skillFileUri: string;
    try {
      upload = await deps.uploadFile({
        filePath: archivePath,
        contentType: 'application/zip',
        network: plan.network,
      });
      const uploadedPinId = normalizeText(upload.pinId);
      skillFileUri = normalizeText(upload.metafileUri) || (uploadedPinId ? metafileUriFromPinId(uploadedPinId, '.zip') : '');
      if (!skillFileUri || !skillFileUri.toLowerCase().startsWith('metafile://')) {
        throw new SkillPublishError(
          'publish_failed',
          `Skill package upload returned no metafile URI (pinId: ${uploadedPinId || '(none)'}).`,
        );
      }
      payload = buildSkillPinPayload({ name: plan.name, version: plan.version, description: plan.description, skillFileUri });
      chainWrite = await deps.writeChain({
        operation: 'create',
        path: SKILL_PROTOCOL_PATH,
        payload: JSON.stringify(payload),
        contentType: 'application/json',
        network: plan.network,
      });
      const pinId = normalizeText(chainWrite.pinId);
      if (!pinId) {
        throw new SkillPublishError('publish_failed', 'Protocol pin write returned no pinId.');
      }
      const result: SkillPublishResult = {
        name: plan.name,
        version: plan.version,
        description: plan.description,
        pinId,
        skillFileUri,
        payload,
        archive: plan.archive,
        upload,
        chainWrite,
        formatted: [
          `Skill "${plan.name}" v${plan.version} published (pin ${pinId}).`,
          `Package: ${plan.archive.bytes} bytes, sha256 ${plan.archive.sha256.slice(0, 12)}… → ${skillFileUri}`,
          `Others can install it with: metabot skills install --pin ${pinId} --confirm`,
        ].join('\n'),
      };
      return commandSuccess(result);
    } catch (error) {
      if (error instanceof SkillPublishError) throw error;
      throw new SkillPublishError(
        'publish_failed',
        `Skill publish failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } finally {
    await cleanup();
  }
}
