"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSafeProviderSkillName = isSafeProviderSkillName;
exports.createPlatformSkillCatalog = createPlatformSkillCatalog;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const platformRegistry_1 = require("../platform/platformRegistry");
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function isSafeProviderSkillName(value) {
    const skillName = normalizeText(value);
    if (!skillName) {
        return false;
    }
    if (skillName.includes('/') || skillName.includes('\\') || skillName.includes('..')) {
        return false;
    }
    return node_path_1.default.basename(skillName) === skillName;
}
function selectPrimaryBinding(bindings, metaBotSlug) {
    const candidates = bindings
        .filter((binding) => (binding.metaBotSlug === metaBotSlug
        && binding.role === 'primary'
        && binding.enabled))
        .sort((left, right) => {
        if (left.priority !== right.priority) {
            return left.priority - right.priority;
        }
        if (left.updatedAt !== right.updatedAt) {
            return right.updatedAt.localeCompare(left.updatedAt);
        }
        return left.id.localeCompare(right.id);
    });
    return candidates[0] ?? null;
}
function resolveCatalogRoot(input) {
    if (input.root.kind === 'project') {
        return node_path_1.default.resolve(input.projectRoot, input.root.path);
    }
    return (0, platformRegistry_1.resolvePlatformSkillRootPath)(input.root, input.systemHomeDir, input.env);
}
function parseFrontMatterMetadata(body) {
    const trimmed = body.trimStart();
    if (!trimmed.startsWith('---')) {
        const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
        return heading ? { title: heading } : {};
    }
    const match = trimmed.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) {
        return {};
    }
    const metadata = {};
    for (const line of match[1].split(/\r?\n/)) {
        const separator = line.indexOf(':');
        if (separator <= 0) {
            continue;
        }
        const key = line.slice(0, separator).trim().toLowerCase();
        const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
        if (key === 'title' || key === 'name') {
            metadata.title = value || metadata.title;
        }
        if (key === 'description') {
            metadata.description = value;
        }
    }
    return metadata;
}
async function readSkillMetadata(skillDocumentPath) {
    try {
        return parseFrontMatterMetadata(await node_fs_1.promises.readFile(skillDocumentPath, 'utf8'));
    }
    catch {
        return {};
    }
}
async function scanRoot(input) {
    let entries;
    try {
        entries = await node_fs_1.promises.readdir(input.absolutePath, { withFileTypes: true });
    }
    catch (error) {
        const code = error.code;
        return {
            diagnostic: {
                rootId: input.root.id,
                kind: input.root.kind,
                absolutePath: input.absolutePath,
                status: code === 'ENOENT' ? 'missing' : 'unreadable',
                message: error instanceof Error ? error.message : String(error),
            },
            skills: [],
        };
    }
    const skills = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || !isSafeProviderSkillName(entry.name)) {
            continue;
        }
        const absolutePath = node_path_1.default.join(input.absolutePath, entry.name);
        const skillDocumentPath = node_path_1.default.join(absolutePath, 'SKILL.md');
        try {
            const stat = await node_fs_1.promises.stat(skillDocumentPath);
            if (!stat.isFile()) {
                continue;
            }
        }
        catch {
            continue;
        }
        const metadata = await readSkillMetadata(skillDocumentPath);
        skills.push({
            skillName: entry.name,
            title: metadata.title,
            description: metadata.description,
            platformId: input.platform.id,
            platformDisplayName: input.platform.displayName,
            rootId: input.root.id,
            rootKind: input.root.kind,
            absolutePath,
            skillDocumentPath,
        });
    }
    return {
        diagnostic: {
            rootId: input.root.id,
            kind: input.root.kind,
            absolutePath: input.absolutePath,
            status: 'readable',
        },
        skills,
    };
}
function createPlatformSkillCatalog(options) {
    const env = options.env ?? process.env;
    return {
        async listPrimaryRuntimeSkills(input) {
            const metaBotSlug = normalizeText(input.metaBotSlug);
            const [runtimeState, bindingState] = await Promise.all([
                options.runtimeStore.read(),
                options.bindingStore.read(),
            ]);
            const binding = selectPrimaryBinding(bindingState.bindings, metaBotSlug);
            if (!binding) {
                return {
                    ok: false,
                    code: 'primary_runtime_missing',
                    message: 'The selected MetaBot has no enabled primary runtime binding.',
                    metaBotSlug,
                    rootDiagnostics: [],
                };
            }
            const runtime = runtimeState.runtimes.find((entry) => entry.id === binding.llmRuntimeId);
            if (!runtime) {
                return {
                    ok: false,
                    code: 'primary_runtime_missing',
                    message: 'The selected MetaBot primary runtime binding points to a missing runtime.',
                    metaBotSlug,
                    binding,
                    rootDiagnostics: [],
                };
            }
            if (runtime.health === 'unavailable') {
                return {
                    ok: false,
                    code: 'primary_runtime_unavailable',
                    message: 'The selected MetaBot primary runtime is unavailable.',
                    metaBotSlug,
                    runtime,
                    binding,
                    rootDiagnostics: [],
                };
            }
            if (!(0, platformRegistry_1.isPlatformId)(runtime.provider)) {
                return {
                    ok: false,
                    code: 'primary_runtime_provider_unsupported',
                    message: 'The selected MetaBot primary runtime provider is not supported by the platform skill registry.',
                    metaBotSlug,
                    runtime,
                    binding,
                    rootDiagnostics: [],
                };
            }
            if (runtime.health !== 'healthy') {
                return {
                    ok: false,
                    code: 'primary_runtime_unavailable',
                    message: 'The selected MetaBot primary runtime is not healthy.',
                    metaBotSlug,
                    runtime,
                    binding,
                    rootDiagnostics: [],
                };
            }
            if (!normalizeText(runtime.binaryPath)) {
                return {
                    ok: false,
                    code: 'primary_runtime_unavailable',
                    message: 'The selected MetaBot primary runtime has no binary path.',
                    metaBotSlug,
                    runtime,
                    binding,
                    rootDiagnostics: [],
                };
            }
            const platform = (0, platformRegistry_1.getPlatformDefinition)(runtime.provider);
            const roots = (0, platformRegistry_1.getPlatformSkillRoots)(platform.id);
            const rootResults = await Promise.all(roots.map(async (root) => scanRoot({
                platform,
                root,
                absolutePath: resolveCatalogRoot({
                    root,
                    systemHomeDir: options.systemHomeDir,
                    projectRoot: options.projectRoot,
                    env,
                }),
            })));
            const byName = new Map();
            for (const result of rootResults) {
                for (const skill of result.skills) {
                    if (!byName.has(skill.skillName)) {
                        byName.set(skill.skillName, skill);
                    }
                }
            }
            return {
                ok: true,
                metaBotSlug,
                runtime,
                binding,
                platform: {
                    id: platform.id,
                    displayName: platform.displayName,
                    logoPath: platform.logoPath,
                },
                skills: [...byName.values()].sort((left, right) => left.skillName.localeCompare(right.skillName)),
                rootDiagnostics: rootResults.map((result) => result.diagnostic),
            };
        },
    };
}
