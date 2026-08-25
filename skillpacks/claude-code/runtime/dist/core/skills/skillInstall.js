"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SkillInstallError = exports.SKILL_REGISTRY_FILENAME = exports.MAX_SKILL_PACKAGE_BYTES = void 0;
exports.normalizeSkillName = normalizeSkillName;
exports.parseSkillFrontmatter = parseSkillFrontmatter;
exports.extractSkillPinDescriptor = extractSkillPinDescriptor;
exports.downloadSkillArchive = downloadSkillArchive;
exports.readInstalledSkillsRegistry = readInstalledSkillsRegistry;
exports.writeInstalledSkillsRegistry = writeInstalledSkillsRegistry;
exports.installSkillArchive = installSkillArchive;
exports.installSkillFromReference = installSkillFromReference;
exports.listInstalledSkills = listInstalledSkills;
exports.readInstalledSkill = readInstalledSkill;
exports.uninstallInstalledSkill = uninstallInstalledSkill;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const artifactDownload_1 = require("../metaapp/artifactDownload");
const zipArchive_1 = require("../metaapp/zipArchive");
/** Parity with IDBots MAX_SKILL_PACKAGE_BYTES — the published zip must stay small. */
exports.MAX_SKILL_PACKAGE_BYTES = 4 * 1024 * 1024;
const MAX_EXTRACTED_ENTRIES = 500;
const MAX_EXTRACTED_BYTES = 16 * 1024 * 1024;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30_000;
/** Registry file inside the shared skills root; one entry per chain-installed skill. */
exports.SKILL_REGISTRY_FILENAME = 'installed-skills.json';
const SKILL_DOC_FILENAMES = ['SKILL.md', 'skill.md', 'Skill.md'];
class SkillInstallError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'SkillInstallError';
        this.code = code;
    }
}
exports.SkillInstallError = SkillInstallError;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
/** Directory-safe skill name: must round-trip as a single path segment. */
function normalizeSkillName(value) {
    const name = normalizeText(value);
    if (!name || name.length > 64)
        return '';
    if (name === '.' || name === '..' || name.startsWith('.'))
        return '';
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name))
        return '';
    return name;
}
/**
 * Minimal YAML frontmatter scan for the fields installation needs. Skill
 * frontmatter in practice is flat scalars; nested keys are ignored rather
 * than mis-parsed.
 */
function parseSkillFrontmatter(markdown) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
    if (!match)
        return {};
    const fields = {};
    for (const rawLine of match[1].split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#'))
            continue;
        const separator = line.indexOf(':');
        if (separator <= 0)
            continue;
        const key = line.slice(0, separator).trim();
        let value = line.slice(separator + 1).trim();
        if (!/^[A-Za-z0-9_-]+$/.test(key))
            continue;
        if (/^["'](.*)["']$/.test(value) && value.length >= 2) {
            value = value.slice(1, -1);
        }
        if (value && !fields[key])
            fields[key] = value;
    }
    const picked = {};
    for (const key of ['name', 'version', 'description']) {
        const value = normalizeText(fields[key]);
        if (value)
            picked[key] = value;
    }
    return picked;
}
/**
 * Read the install descriptor out of a `metabot-skill` protocol pin record
 * (as returned by the pin-read API). Accepts the payload field spellings
 * seen across publishers, matching the IDBots protocolPinContent parser.
 */
function extractSkillPinDescriptor(pin) {
    const payload = pin.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        return null;
    const record = payload;
    const name = normalizeText(record.name ?? record.skillName ?? record.id);
    const skillFileUri = normalizeText(record['skill-file'] ?? record.skillFileUri ?? record.skill_file_uri ?? record.uri);
    if (!name || !skillFileUri)
        return null;
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
async function downloadSkillArchive(input) {
    const reference = normalizeText(input.contentReference);
    const urls = (0, artifactDownload_1.metaAppArchiveUrls)(reference);
    if (!urls.length) {
        throw new SkillInstallError('invalid_source', `The skill package reference is not downloadable: ${reference || '(empty)'} — expected metafile://<pinId> or an https URL.`);
    }
    const maxBytes = input.maxBytes ?? exports.MAX_SKILL_PACKAGE_BYTES;
    const timeoutMs = input.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
    const failures = [];
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
                throw new SkillInstallError('invalid_package', `Skill package exceeds the ${Math.round(maxBytes / 1024)} KB cap (${Math.round(declaredLength / 1024)} KB): ${reference}`);
            }
            const archive = Buffer.from(await response.arrayBuffer());
            if (archive.byteLength === 0) {
                failures.push(`${url} → empty body`);
                continue;
            }
            if (archive.byteLength > maxBytes) {
                throw new SkillInstallError('invalid_package', `Skill package exceeds the ${Math.round(maxBytes / 1024)} KB cap (${Math.round(archive.byteLength / 1024)} KB): ${reference}`);
            }
            return archive;
        }
        catch (error) {
            if (error instanceof SkillInstallError)
                throw error;
            failures.push(`${url} → ${error instanceof Error ? error.message : String(error)}`);
        }
        finally {
            clearTimeout(timer);
        }
    }
    throw new SkillInstallError('download_failed', `Skill package could not be downloaded (${reference}): ${failures.join('; ')}`);
}
async function fileExists(filePath) {
    try {
        const stat = await node_fs_1.promises.stat(filePath);
        return stat.isFile();
    }
    catch {
        return false;
    }
}
/** SKILL.md at the archive root, or exactly one wrapping directory, else the shallowest match anywhere. */
async function locateSkillDoc(rootDir) {
    for (const candidate of SKILL_DOC_FILENAMES) {
        if (await fileExists(node_path_1.default.join(rootDir, candidate))) {
            return node_path_1.default.join(rootDir, candidate);
        }
    }
    const entries = await node_fs_1.promises.readdir(rootDir, { withFileTypes: true }).catch(() => []);
    const directories = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== '__MACOSX');
    if (directories.length === 1) {
        const nested = node_path_1.default.join(rootDir, directories[0].name);
        for (const candidate of SKILL_DOC_FILENAMES) {
            if (await fileExists(node_path_1.default.join(nested, candidate))) {
                return node_path_1.default.join(nested, candidate);
            }
        }
    }
    // Shallowest-first fallback for archives that nest deeper.
    let queue = [rootDir];
    while (queue.length) {
        const next = [];
        for (const dir of queue) {
            const inner = await node_fs_1.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
            for (const entry of inner) {
                const entryPath = node_path_1.default.join(dir, entry.name);
                if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== '__MACOSX') {
                    next.push(entryPath);
                }
                else if (entry.isFile() && SKILL_DOC_FILENAMES.includes(entry.name)) {
                    return entryPath;
                }
            }
        }
        queue = next;
    }
    return null;
}
async function listFilesRelative(rootDir, dir = rootDir) {
    const entries = await node_fs_1.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
    const files = [];
    for (const entry of entries) {
        const entryPath = node_path_1.default.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...await listFilesRelative(rootDir, entryPath));
        }
        else if (entry.isFile()) {
            files.push(node_path_1.default.relative(rootDir, entryPath).split(node_path_1.default.sep).join('/'));
        }
    }
    return files.sort();
}
function registryPath(skillsRoot) {
    return node_path_1.default.join(skillsRoot, exports.SKILL_REGISTRY_FILENAME);
}
async function readInstalledSkillsRegistry(skillsRoot) {
    let raw;
    try {
        raw = JSON.parse(await node_fs_1.promises.readFile(registryPath(skillsRoot), 'utf8'));
    }
    catch {
        return { version: 1, skills: {} };
    }
    const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const skillsInput = record.skills && typeof record.skills === 'object' && !Array.isArray(record.skills)
        ? record.skills
        : {};
    const skills = {};
    for (const [key, value] of Object.entries(skillsInput)) {
        const entry = value && typeof value === 'object' ? value : null;
        const name = normalizeText(entry?.name) || key;
        if (!normalizeSkillName(name))
            continue;
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
async function writeInstalledSkillsRegistry(skillsRoot, registry) {
    await node_fs_1.promises.mkdir(skillsRoot, { recursive: true });
    await node_fs_1.promises.writeFile(registryPath(skillsRoot), `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
}
/**
 * Install an already-downloaded skill package archive under the shared skills
 * root. Existing installations of the same name are replaced in place (same
 * publisher or explicit override); a name owned by a different publisher or
 * by a non-registry local skill is a conflict, not a clobber.
 */
async function installSkillArchive(input) {
    const skillsRoot = node_path_1.default.resolve(input.skillsRoot);
    const now = input.now ?? Date.now;
    const stagingRoot = node_path_1.default.join(skillsRoot, `.skill-install-${(0, node_crypto_1.randomUUID)()}`);
    await node_fs_1.promises.mkdir(skillsRoot, { recursive: true });
    let extracted;
    try {
        extracted = await (0, zipArchive_1.extractMetaAppZipArchive)({
            archive: input.archive,
            outDir: stagingRoot,
            maxEntries: MAX_EXTRACTED_ENTRIES,
            maxUncompressedBytes: MAX_EXTRACTED_BYTES,
        });
    }
    catch (error) {
        await node_fs_1.promises.rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
        throw new SkillInstallError('invalid_package', `Skill package could not be extracted: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
        const skillDocPath = await locateSkillDoc(stagingRoot);
        if (!skillDocPath) {
            throw new SkillInstallError('invalid_package', 'Skill package has no SKILL.md — not an installable metabot-skill package.');
        }
        const packageRoot = node_path_1.default.dirname(skillDocPath);
        const markdown = await node_fs_1.promises.readFile(skillDocPath, 'utf8');
        const frontmatter = parseSkillFrontmatter(markdown);
        const name = normalizeSkillName(frontmatter.name ?? input.source?.payloadName);
        if (!name) {
            throw new SkillInstallError('invalid_package', 'Skill package has no usable name (SKILL.md frontmatter `name` or pin payload `name` is required).');
        }
        const registry = await readInstalledSkillsRegistry(skillsRoot);
        const existing = registry.skills[name];
        const targetDir = node_path_1.default.join(skillsRoot, name);
        const targetExists = await node_fs_1.promises.stat(targetDir).then(() => true, () => false);
        const incomingCreator = normalizeText(input.source?.creatorMetaId);
        if (!input.force) {
            if (existing && incomingCreator && existing.creatorMetaId && existing.creatorMetaId !== incomingCreator) {
                throw new SkillInstallError('name_conflict', `Skill "${name}" is already installed from a different publisher (${existing.creatorMetaId}); refusing to replace it. Uninstall it first or pass --force.`);
            }
            if (targetExists && !existing) {
                throw new SkillInstallError('name_conflict', `A local skill named "${name}" already exists at ${targetDir} and was not installed from MetaWeb; refusing to replace it. Remove it first or pass --force.`);
            }
        }
        const version = normalizeText(frontmatter.version ?? input.source?.payloadVersion) || '0';
        const description = normalizeText(frontmatter.description ?? input.source?.payloadDescription);
        if (targetExists) {
            await node_fs_1.promises.rm(targetDir, { recursive: true, force: true });
        }
        await node_fs_1.promises.mkdir(skillsRoot, { recursive: true });
        await node_fs_1.promises.rename(packageRoot, targetDir);
        const record = {
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
            skillMdPath: node_path_1.default.join(targetDir, node_path_1.default.basename(skillDocPath)),
            replaced: Boolean(existing) || targetExists,
            previousVersion: existing?.version || null,
            files: await listFilesRelative(targetDir),
        };
    }
    finally {
        await node_fs_1.promises.rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    }
}
/** Full flow: download the package archive, then install it. */
async function installSkillFromReference(input) {
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
async function listInstalledSkills(skillsRoot) {
    const registry = await readInstalledSkillsRegistry(skillsRoot);
    const entries = Object.values(registry.skills).sort((left, right) => left.name.localeCompare(right.name));
    return Promise.all(entries.map(async (entry) => ({
        ...entry,
        present: await fileExists(node_path_1.default.join(skillsRoot, entry.name, 'SKILL.md'))
            || await fileExists(node_path_1.default.join(skillsRoot, entry.name, 'skill.md')),
    })));
}
/** Load one installed skill's SKILL.md and file listing, for `skills read`. */
async function readInstalledSkill(input) {
    const name = normalizeSkillName(input.name);
    if (!name) {
        throw new SkillInstallError('invalid_package', `Invalid skill name: ${input.name}`);
    }
    const skillDir = node_path_1.default.join(node_path_1.default.resolve(input.skillsRoot), name);
    for (const candidate of SKILL_DOC_FILENAMES) {
        const skillMdPath = node_path_1.default.join(skillDir, candidate);
        if (await fileExists(skillMdPath)) {
            return {
                name,
                skillDir,
                skillMdPath,
                skillMd: await node_fs_1.promises.readFile(skillMdPath, 'utf8'),
                files: await listFilesRelative(skillDir),
            };
        }
    }
    throw new SkillInstallError('invalid_package', `No SKILL.md found for skill "${name}" under ${node_path_1.default.resolve(input.skillsRoot)}.`);
}
/** Remove one chain-installed skill (registry entry + directory). Built-in/local skills are refused. */
async function uninstallInstalledSkill(input) {
    const name = normalizeSkillName(input.name);
    if (!name) {
        throw new SkillInstallError('invalid_package', `Invalid skill name: ${input.name}`);
    }
    const registry = await readInstalledSkillsRegistry(input.skillsRoot);
    if (!registry.skills[name]) {
        throw new SkillInstallError('name_conflict', `Skill "${name}" was not installed from MetaWeb (no registry entry); remove local skills manually.`);
    }
    const skillDir = node_path_1.default.join(node_path_1.default.resolve(input.skillsRoot), name);
    const removedDir = await node_fs_1.promises.stat(skillDir).then(() => true, () => false);
    if (removedDir) {
        await node_fs_1.promises.rm(skillDir, { recursive: true, force: true });
    }
    delete registry.skills[name];
    await writeInstalledSkillsRegistry(input.skillsRoot, registry);
    return { name, removedDir };
}
