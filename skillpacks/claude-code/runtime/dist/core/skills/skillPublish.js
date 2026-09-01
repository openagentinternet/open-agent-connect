"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SkillPublishError = exports.SKILL_PROTOCOL_PATH = void 0;
exports.resolveSkillPackageRoot = resolveSkillPackageRoot;
exports.buildSkillPinPayload = buildSkillPinPayload;
exports.previewSkillProject = previewSkillProject;
exports.publishSkill = publishSkill;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const commandResult_1 = require("../contracts/commandResult");
const metafileUri_1 = require("../files/metafileUri");
const zipArchive_1 = require("../metaapp/zipArchive");
const skillInstall_1 = require("./skillInstall");
/** Parity with IDBots: the protocol path learners and indexers scan. */
exports.SKILL_PROTOCOL_PATH = '/protocols/metabot-skill';
const SKILL_DOC_FILENAMES = ['SKILL.md', 'skill.md', 'Skill.md'];
const PREVIEW_PACKAGE_URI = 'metafile://<uploaded-skill-zip-pin>.zip';
class SkillPublishError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'SkillPublishError';
        this.code = code;
    }
}
exports.SkillPublishError = SkillPublishError;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
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
async function findSkillDoc(dir) {
    for (const candidate of SKILL_DOC_FILENAMES) {
        if (await fileExists(node_path_1.default.join(dir, candidate))) {
            return node_path_1.default.join(dir, candidate);
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
async function resolveSkillPackageRoot(skillDir) {
    const resolved = node_path_1.default.resolve(skillDir);
    const stat = await node_fs_1.promises.stat(resolved).catch(() => null);
    if (!stat?.isDirectory()) {
        throw new SkillPublishError('invalid_project', `Skill directory not found: ${skillDir}`);
    }
    const direct = await findSkillDoc(resolved);
    if (direct) {
        return { packageRoot: resolved, skillMdPath: direct };
    }
    const entries = await node_fs_1.promises.readdir(resolved, { withFileTypes: true }).catch(() => []);
    const candidates = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === '__MACOSX')
            continue;
        const nestedRoot = node_path_1.default.join(resolved, entry.name);
        const nestedDoc = await findSkillDoc(nestedRoot);
        if (nestedDoc)
            candidates.push({ packageRoot: nestedRoot, skillMdPath: nestedDoc });
    }
    if (candidates.length === 1) {
        return candidates[0];
    }
    throw new SkillPublishError('invalid_project', candidates.length
        ? `Skill directory is ambiguous: multiple skill-bearing subdirectories under ${skillDir}.`
        : `No SKILL.md found in ${skillDir} — a metabot-skill package is a directory whose root (or single subdirectory) carries SKILL.md.`);
}
/** The canonical pin payload; only non-empty optional fields ride along. */
function buildSkillPinPayload(input) {
    const payload = {
        name: input.name,
        version: input.version,
        'skill-file': input.skillFileUri,
    };
    const description = normalizeText(input.description);
    if (description)
        payload.description = description;
    return payload;
}
async function buildPlan(input, makeTempDir) {
    const { packageRoot, skillMdPath } = await resolveSkillPackageRoot(input.skillDir);
    const frontmatter = (0, skillInstall_1.parseSkillFrontmatter)(await node_fs_1.promises.readFile(skillMdPath, 'utf8'));
    const warnings = [];
    if (packageRoot !== node_path_1.default.resolve(input.skillDir)) {
        warnings.push(`SKILL.md sits in the subdirectory ${node_path_1.default.basename(packageRoot)}; that subdirectory is packaged.`);
    }
    const name = (0, skillInstall_1.normalizeSkillName)(normalizeText(input.name) || frontmatter.name);
    if (!name) {
        throw new SkillPublishError('invalid_metadata', `Invalid skill name: ${normalizeText(input.name) || frontmatter.name || '(none)'} — 1-64 chars, starts alphanumeric, then [A-Za-z0-9._-].`);
    }
    const version = normalizeText(input.version) || normalizeText(frontmatter.version);
    if (!version) {
        throw new SkillPublishError('invalid_metadata', 'Skill version is required (SKILL.md frontmatter `version` or --version) — consumers keep the highest version per name.');
    }
    const description = normalizeText(input.description) || normalizeText(frontmatter.description);
    const tempDir = await makeTempDir();
    const archivePath = node_path_1.default.join(tempDir, `metabot-skill-${name}-${(0, node_crypto_1.randomUUID)()}.zip`);
    let archive;
    try {
        archive = await (0, zipArchive_1.writeMetaAppZipArchive)({ sourceDir: packageRoot, outFile: archivePath });
    }
    catch (error) {
        await node_fs_1.promises.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
        throw new SkillPublishError('invalid_project', `Skill package could not be built: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (archive.bytes > skillInstall_1.MAX_SKILL_PACKAGE_BYTES) {
        await node_fs_1.promises.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
        throw new SkillPublishError('package_too_large', `Skill package exceeds the ${Math.round(skillInstall_1.MAX_SKILL_PACKAGE_BYTES / 1024)} KB cap (${Math.round(archive.bytes / 1024)} KB).`);
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
            await node_fs_1.promises.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
        },
    };
}
function planSummary(plan) {
    return [
        `Publish skill "${plan.name}" v${plan.version}`,
        plan.description ? `Description: ${plan.description}` : '',
        `Package: ${plan.archive.bytes} bytes (sha256 ${plan.archive.sha256.slice(0, 12)}…), ${plan.archive.fileCount} files`,
        `Chain pin: ${exports.SKILL_PROTOCOL_PATH} on ${plan.network} (publisher = the signing bot)`,
    ].filter(Boolean).join('\n');
}
/**
 * Build the publish plan without writing anything: resolves the package root,
 * merges frontmatter with flag overrides, validates, and produces the real
 * archive so the confirmation shows actual bytes and checksum.
 */
async function previewSkillProject(input, deps) {
    const makeTempDir = deps?.makeTempDir ?? (() => node_fs_1.promises.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), 'metabot-skill-publish-')));
    const { plan, cleanup } = await buildPlan(input, makeTempDir);
    await cleanup();
    return plan;
}
/**
 * Publish a skill directory on-chain. Without `confirm`, returns the
 * awaiting-confirmation envelope carrying the plan; with it, uploads the
 * package and writes the metabot-skill protocol pin.
 */
async function publishSkill(input, deps) {
    const makeTempDir = deps.makeTempDir ?? (() => node_fs_1.promises.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), 'metabot-skill-publish-')));
    const { plan, archivePath, cleanup } = await buildPlan(input, makeTempDir);
    try {
        if (!input.confirm) {
            const formatted = `${planSummary(plan)}\nRe-run with --confirm to publish.`;
            return (0, commandResult_1.commandAwaitingConfirmation)({ plan, formatted });
        }
        let upload;
        let chainWrite;
        let payload;
        let skillFileUri;
        try {
            upload = await deps.uploadFile({
                filePath: archivePath,
                contentType: 'application/zip',
                network: plan.network,
            });
            const uploadedPinId = normalizeText(upload.pinId);
            skillFileUri = normalizeText(upload.metafileUri) || (uploadedPinId ? (0, metafileUri_1.metafileUriFromPinId)(uploadedPinId, '.zip') : '');
            if (!skillFileUri || !skillFileUri.toLowerCase().startsWith('metafile://')) {
                throw new SkillPublishError('publish_failed', `Skill package upload returned no metafile URI (pinId: ${uploadedPinId || '(none)'}).`);
            }
            payload = buildSkillPinPayload({ name: plan.name, version: plan.version, description: plan.description, skillFileUri });
            chainWrite = await deps.writeChain({
                operation: 'create',
                path: exports.SKILL_PROTOCOL_PATH,
                payload: JSON.stringify(payload),
                contentType: 'application/json',
                network: plan.network,
            });
            const pinId = normalizeText(chainWrite.pinId);
            if (!pinId) {
                throw new SkillPublishError('publish_failed', 'Protocol pin write returned no pinId.');
            }
            const result = {
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
            return (0, commandResult_1.commandSuccess)(result);
        }
        catch (error) {
            if (error instanceof SkillPublishError)
                throw error;
            throw new SkillPublishError('publish_failed', `Skill publish failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    finally {
        await cleanup();
    }
}
