/**
 * On-chain skill package installation — OAC port of the IDBots
 * skillInstallService consumer half. A `metabot-skill` protocol pin points at
 * a zip package (`skill-file: metafile://<pinId>.zip`); this module downloads
 * that archive, extracts it safely, and installs it as a regular skill
 * directory under the shared skills root (`~/.metabot/skills/<name>/`),
 * recording provenance in the installed-skills registry so host skill
 * binding can pick it up like any local skill.
 *
 * Everything here is untrusted third-party input: the archive size is capped,
 * extraction reuses the zip-slip-guarded MetaApp extractor, and skill names
 * are validated before they become directory names.
 */

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { metaAppArchiveUrls } from '../metaapp/artifactDownload';
import { extractMetaAppZipArchive } from '../metaapp/zipArchive';

/** Parity with IDBots MAX_SKILL_PACKAGE_BYTES — the published zip must stay small. */
export const MAX_SKILL_PACKAGE_BYTES = 4 * 1024 * 1024;
const MAX_EXTRACTED_ENTRIES = 500;
const MAX_EXTRACTED_BYTES = 16 * 1024 * 1024;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30_000;

/** Registry file inside the shared skills root; one entry per chain-installed skill. */
export const SKILL_REGISTRY_FILENAME = 'installed-skills.json';

const SKILL_DOC_FILENAMES = ['SKILL.md', 'skill.md', 'Skill.md'];

export class SkillInstallError extends Error {
  code: 'invalid_source' | 'download_failed' | 'invalid_package' | 'name_conflict';

  constructor(
    code: 'invalid_source' | 'download_failed' | 'invalid_package' | 'name_conflict',
    message: string,
  ) {
    super(message);
    this.name = 'SkillInstallError';
    this.code = code;
  }
}

export interface InstalledSkillRecord {
  name: string;
  version: string;
  description: string;
  /** Publisher GlobalMetaID from the source pin; empty when unknown. */
  creatorMetaId: string;
  creatorName: string;
  /** The metabot-skill protocol pin that advertised this package. */
  sourcePinId: string;
  /** The package archive URI (metafile://…) that was downloaded. */
  skillFileUri: string;
  installedAt: number;
  updatedAt: number;
  enabled: boolean;
}

export interface InstalledSkillsRegistry {
  version: 1;
  skills: Record<string, InstalledSkillRecord>;
}

export interface SkillInstallSource {
  creatorMetaId?: string;
  creatorName?: string;
  sourcePinId?: string;
  skillFileUri?: string;
  /** Fallbacks when the package SKILL.md lacks frontmatter fields. */
  payloadName?: string;
  payloadVersion?: string;
  payloadDescription?: string;
}

export interface SkillInstallResult {
  name: string;
  version: string;
  description: string;
  skillDir: string;
  skillMdPath: string;
  replaced: boolean;
  previousVersion: string | null;
  files: string[];
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Directory-safe skill name: must round-trip as a single path segment. */
export function normalizeSkillName(value: unknown): string {
  const name = normalizeText(value);
  if (!name || name.length > 64) return '';
  if (name === '.' || name === '..' || name.startsWith('.')) return '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) return '';
  return name;
}

/**
 * Minimal YAML frontmatter scan for the fields installation needs. Skill
 * frontmatter in practice is flat scalars; nested keys are ignored rather
 * than mis-parsed.
 */
export function parseSkillFrontmatter(markdown: string): {
  name?: string;
  version?: string;
  description?: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (!match) return {};
  const fields: Record<string, string> = {};
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (!/^[A-Za-z0-9_-]+$/.test(key)) continue;
    if (/^["'](.*)["']$/.test(value) && value.length >= 2) {
      value = value.slice(1, -1);
    }
    if (value && !fields[key]) fields[key] = value;
  }
  const picked: { name?: string; version?: string; description?: string } = {};
  for (const key of ['name', 'version', 'description'] as const) {
    const value = normalizeText(fields[key]);
    if (value) picked[key] = value;
  }
  return picked;
}

/**
 * Read the install descriptor out of a `metabot-skill` protocol pin record
 * (as returned by the pin-read API). Accepts the payload field spellings
 * seen across publishers, matching the IDBots protocolPinContent parser.
 */
export function extractSkillPinDescriptor(pin: {
  payload?: unknown;
  creator?: { globalMetaId?: unknown; name?: unknown };
}): {
  name: string;
  description: string;
  version: string;
  skillFileUri: string;
} | null {
  const payload = pin.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const name = normalizeText(record.name ?? record.skillName ?? record.id);
  const skillFileUri = normalizeText(
    record['skill-file'] ?? record.skillFileUri ?? record.skill_file_uri ?? record.uri,
  );
  if (!name || !skillFileUri) return null;
  return {
    name,
    description: normalizeText(record.description),
    version: normalizeText(record.version ?? record.skillVersion) || '0',
    skillFileUri,
  };
}

/**
 * Download a skill package archive. `contentReference` is the pin payload's
 * package URI (`metafile://<pinId>[.zip]`) or a plain https URL; resolution
 * and URL fallbacks reuse the MetaApp artifact download path.
 */
export async function downloadSkillArchive(input: {
  contentReference: string;
  fetchImpl: typeof fetch;
  maxBytes?: number;
  timeoutMs?: number;
}): Promise<Buffer> {
  const reference = normalizeText(input.contentReference);
  const urls = metaAppArchiveUrls(reference);
  if (!urls.length) {
    throw new SkillInstallError(
      'invalid_source',
      `The skill package reference is not downloadable: ${reference || '(empty)'} — expected metafile://<pinId> or an https URL.`,
    );
  }
  const maxBytes = input.maxBytes ?? MAX_SKILL_PACKAGE_BYTES;
  const timeoutMs = input.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
  const failures: string[] = [];
  for (const url of urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await input.fetchImpl(url, { signal: controller.signal });
      if (!response?.ok) {
        failures.push(`${url} → HTTP ${response?.status ?? 'network error'}`);
        continue;
      }
      const declaredLength = Number(response.headers?.get?.('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        throw new SkillInstallError(
          'invalid_package',
          `Skill package exceeds the ${Math.round(maxBytes / 1024)} KB cap (${Math.round(declaredLength / 1024)} KB): ${reference}`,
        );
      }
      const archive = Buffer.from(await response.arrayBuffer());
      if (archive.byteLength === 0) {
        failures.push(`${url} → empty body`);
        continue;
      }
      if (archive.byteLength > maxBytes) {
        throw new SkillInstallError(
          'invalid_package',
          `Skill package exceeds the ${Math.round(maxBytes / 1024)} KB cap (${Math.round(archive.byteLength / 1024)} KB): ${reference}`,
        );
      }
      return archive;
    } catch (error) {
      if (error instanceof SkillInstallError) throw error;
      failures.push(`${url} → ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new SkillInstallError(
    'download_failed',
    `Skill package could not be downloaded (${reference}): ${failures.join('; ')}`,
  );
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

/** SKILL.md at the archive root, or exactly one wrapping directory, else the shallowest match anywhere. */
async function locateSkillDoc(rootDir: string): Promise<string | null> {
  for (const candidate of SKILL_DOC_FILENAMES) {
    if (await fileExists(path.join(rootDir, candidate))) {
      return path.join(rootDir, candidate);
    }
  }
  const entries = await fs.readdir(rootDir, { withFileTypes: true }).catch(() => []);
  const directories = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== '__MACOSX');
  if (directories.length === 1) {
    const nested = path.join(rootDir, directories[0].name);
    for (const candidate of SKILL_DOC_FILENAMES) {
      if (await fileExists(path.join(nested, candidate))) {
        return path.join(nested, candidate);
      }
    }
  }
  // Shallowest-first fallback for archives that nest deeper.
  let queue: string[] = [rootDir];
  while (queue.length) {
    const next: string[] = [];
    for (const dir of queue) {
      const inner = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of inner) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== '__MACOSX') {
          next.push(entryPath);
        } else if (entry.isFile() && SKILL_DOC_FILENAMES.includes(entry.name)) {
          return entryPath;
        }
      }
    }
    queue = next;
  }
  return null;
}

async function listFilesRelative(rootDir: string, dir = rootDir): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRelative(rootDir, entryPath));
    } else if (entry.isFile()) {
      files.push(path.relative(rootDir, entryPath).split(path.sep).join('/'));
    }
  }
  return files.sort();
}

function registryPath(skillsRoot: string): string {
  return path.join(skillsRoot, SKILL_REGISTRY_FILENAME);
}

export async function readInstalledSkillsRegistry(skillsRoot: string): Promise<InstalledSkillsRegistry> {
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(registryPath(skillsRoot), 'utf8'));
  } catch {
    return { version: 1, skills: {} };
  }
  const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const skillsInput = record.skills && typeof record.skills === 'object' && !Array.isArray(record.skills)
    ? record.skills as Record<string, unknown>
    : {};
  const skills: Record<string, InstalledSkillRecord> = {};
  for (const [key, value] of Object.entries(skillsInput)) {
    const entry = value && typeof value === 'object' ? value as Record<string, unknown> : null;
    const name = normalizeText(entry?.name) || key;
    if (!normalizeSkillName(name)) continue;
    skills[name] = {
      name,
      version: normalizeText(entry?.version),
      description: normalizeText(entry?.description),
      creatorMetaId: normalizeText(entry?.creatorMetaId),
      creatorName: normalizeText(entry?.creatorName),
      sourcePinId: normalizeText(entry?.sourcePinId),
      skillFileUri: normalizeText(entry?.skillFileUri),
      installedAt: Number(entry?.installedAt) || 0,
      updatedAt: Number(entry?.updatedAt) || 0,
      enabled: entry?.enabled !== false,
    };
  }
  return { version: 1, skills };
}

export async function writeInstalledSkillsRegistry(skillsRoot: string, registry: InstalledSkillsRegistry): Promise<void> {
  await fs.mkdir(skillsRoot, { recursive: true });
  await fs.writeFile(registryPath(skillsRoot), `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
}

/**
 * Install an already-downloaded skill package archive under the shared skills
 * root. Existing installations of the same name are replaced in place (same
 * publisher or explicit override); a name owned by a different publisher or
 * by a non-registry local skill is a conflict, not a clobber.
 */
export async function installSkillArchive(input: {
  skillsRoot: string;
  archive: Buffer;
  source?: SkillInstallSource;
  force?: boolean;
  now?: () => number;
}): Promise<SkillInstallResult> {
  const skillsRoot = path.resolve(input.skillsRoot);
  const now = input.now ?? Date.now;
  const stagingRoot = path.join(skillsRoot, `.skill-install-${randomUUID()}`);

  await fs.mkdir(skillsRoot, { recursive: true });
  let extracted: { entries: string[] };
  try {
    extracted = await extractMetaAppZipArchive({
      archive: input.archive,
      outDir: stagingRoot,
      maxEntries: MAX_EXTRACTED_ENTRIES,
      maxUncompressedBytes: MAX_EXTRACTED_BYTES,
    });
  } catch (error) {
    await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    throw new SkillInstallError(
      'invalid_package',
      `Skill package could not be extracted: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    const skillDocPath = await locateSkillDoc(stagingRoot);
    if (!skillDocPath) {
      throw new SkillInstallError(
        'invalid_package',
        'Skill package has no SKILL.md — not an installable metabot-skill package.',
      );
    }
    const packageRoot = path.dirname(skillDocPath);
    const markdown = await fs.readFile(skillDocPath, 'utf8');
    const frontmatter = parseSkillFrontmatter(markdown);
    const name = normalizeSkillName(frontmatter.name ?? input.source?.payloadName);
    if (!name) {
      throw new SkillInstallError(
        'invalid_package',
        'Skill package has no usable name (SKILL.md frontmatter `name` or pin payload `name` is required).',
      );
    }

    const registry = await readInstalledSkillsRegistry(skillsRoot);
    const existing = registry.skills[name];
    const targetDir = path.join(skillsRoot, name);
    const targetExists = await fs.stat(targetDir).then(() => true, () => false);

    const incomingCreator = normalizeText(input.source?.creatorMetaId);
    if (!input.force) {
      if (existing && incomingCreator && existing.creatorMetaId && existing.creatorMetaId !== incomingCreator) {
        throw new SkillInstallError(
          'name_conflict',
          `Skill "${name}" is already installed from a different publisher (${existing.creatorMetaId}); refusing to replace it. Uninstall it first or pass --force.`,
        );
      }
      if (targetExists && !existing) {
        throw new SkillInstallError(
          'name_conflict',
          `A local skill named "${name}" already exists at ${targetDir} and was not installed from MetaWeb; refusing to replace it. Remove it first or pass --force.`,
        );
      }
    }

    const version = normalizeText(frontmatter.version ?? input.source?.payloadVersion) || '0';
    const description = normalizeText(frontmatter.description ?? input.source?.payloadDescription);

    if (targetExists) {
      await fs.rm(targetDir, { recursive: true, force: true });
    }
    await fs.mkdir(skillsRoot, { recursive: true });
    await fs.rename(packageRoot, targetDir);

    const record: InstalledSkillRecord = {
      name,
      version,
      description,
      creatorMetaId: incomingCreator,
      creatorName: normalizeText(input.source?.creatorName),
      sourcePinId: normalizeText(input.source?.sourcePinId),
      skillFileUri: normalizeText(input.source?.skillFileUri),
      installedAt: existing?.installedAt || now(),
      updatedAt: now(),
      enabled: true,
    };
    registry.skills[name] = record;
    await writeInstalledSkillsRegistry(skillsRoot, registry);

    return {
      name,
      version,
      description,
      skillDir: targetDir,
      skillMdPath: path.join(targetDir, path.basename(skillDocPath)),
      replaced: Boolean(existing) || targetExists,
      previousVersion: existing?.version || null,
      files: await listFilesRelative(targetDir),
    };
  } finally {
    await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Full flow: download the package archive, then install it. */
export async function installSkillFromReference(input: {
  skillsRoot: string;
  contentReference: string;
  fetchImpl: typeof fetch;
  source?: SkillInstallSource;
  force?: boolean;
  maxBytes?: number;
  now?: () => number;
}): Promise<SkillInstallResult> {
  const archive = await downloadSkillArchive({
    contentReference: input.contentReference,
    fetchImpl: input.fetchImpl,
    maxBytes: input.maxBytes,
  });
  return installSkillArchive({
    skillsRoot: input.skillsRoot,
    archive,
    source: {
      ...input.source,
      skillFileUri: input.source?.skillFileUri || normalizeText(input.contentReference),
    },
    force: input.force,
    now: input.now,
  });
}

/** Registry view enriched with on-disk presence, for `skills list`. */
export async function listInstalledSkills(skillsRoot: string): Promise<Array<InstalledSkillRecord & { present: boolean }>> {
  const registry = await readInstalledSkillsRegistry(skillsRoot);
  const entries = Object.values(registry.skills).sort((left, right) => left.name.localeCompare(right.name));
  return Promise.all(entries.map(async (entry) => ({
    ...entry,
    present: await fileExists(path.join(skillsRoot, entry.name, 'SKILL.md'))
      || await fileExists(path.join(skillsRoot, entry.name, 'skill.md')),
  })));
}

/** Load one installed skill's SKILL.md and file listing, for `skills read`. */
export async function readInstalledSkill(input: {
  skillsRoot: string;
  name: string;
}): Promise<{
  name: string;
  skillDir: string;
  skillMdPath: string;
  skillMd: string;
  files: string[];
}> {
  const name = normalizeSkillName(input.name);
  if (!name) {
    throw new SkillInstallError('invalid_package', `Invalid skill name: ${input.name}`);
  }
  const skillDir = path.join(path.resolve(input.skillsRoot), name);
  for (const candidate of SKILL_DOC_FILENAMES) {
    const skillMdPath = path.join(skillDir, candidate);
    if (await fileExists(skillMdPath)) {
      return {
        name,
        skillDir,
        skillMdPath,
        skillMd: await fs.readFile(skillMdPath, 'utf8'),
        files: await listFilesRelative(skillDir),
      };
    }
  }
  throw new SkillInstallError(
    'invalid_package',
    `No SKILL.md found for skill "${name}" under ${path.resolve(input.skillsRoot)}.`,
  );
}

/** Remove one chain-installed skill (registry entry + directory). Built-in/local skills are refused. */
export async function uninstallInstalledSkill(input: {
  skillsRoot: string;
  name: string;
}): Promise<{ name: string; removedDir: boolean }> {
  const name = normalizeSkillName(input.name);
  if (!name) {
    throw new SkillInstallError('invalid_package', `Invalid skill name: ${input.name}`);
  }
  const registry = await readInstalledSkillsRegistry(input.skillsRoot);
  if (!registry.skills[name]) {
    throw new SkillInstallError(
      'name_conflict',
      `Skill "${name}" was not installed from MetaWeb (no registry entry); remove local skills manually.`,
    );
  }
  const skillDir = path.join(path.resolve(input.skillsRoot), name);
  const removedDir = await fs.stat(skillDir).then(() => true, () => false);
  if (removedDir) {
    await fs.rm(skillDir, { recursive: true, force: true });
  }
  delete registry.skills[name];
  await writeInstalledSkillsRegistry(input.skillsRoot, registry);
  return { name, removedDir };
}
