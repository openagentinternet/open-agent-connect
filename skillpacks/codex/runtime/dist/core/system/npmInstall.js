"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runNpmInstall = runNpmInstall;
exports.runNpmDoctor = runNpmDoctor;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const commandResult_1 = require("../contracts/commandResult");
const hostSkillBinding_1 = require("../host/hostSkillBinding");
const version_1 = require("../../cli/version");
const platformRegistry_1 = require("../platform/platformRegistry");
const platformRegistry_2 = require("../platform/platformRegistry");
const SUPPORTED_HOSTS = [...platformRegistry_1.SUPPORTED_PLATFORM_IDS];
class NpmInstallError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'NpmInstallError';
        this.code = code;
    }
}
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function resolveSystemHomeDir(env) {
    return node_path_1.default.resolve(normalizeText(env.HOME) || process.env.HOME || process.cwd());
}
function resolvePackageRoot(context) {
    return node_path_1.default.resolve(context.packageRoot ?? node_path_1.default.join(__dirname, '..', '..', '..'));
}
function resolveRequestedHost(host) {
    const normalized = normalizeText(host);
    if (!normalized) {
        return undefined;
    }
    if (!(0, platformRegistry_1.isPlatformId)(normalized)) {
        throw new NpmInstallError('invalid_argument', `Unsupported --host value: ${normalized}. Supported values: ${SUPPORTED_HOSTS.join(', ')}.`);
    }
    return normalized;
}
async function listSourceSkills(packageRoot) {
    const skillsRoot = node_path_1.default.join(packageRoot, 'SKILLs');
    const entries = await node_fs_1.promises.readdir(skillsRoot, { withFileTypes: true });
    return entries
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('metabot-'))
        .map((entry) => entry.name)
        .sort();
}
function replaceAll(source, replacements) {
    return Object.entries(replacements).reduce((text, [token, value]) => text.split(token).join(value), source);
}
async function renderSharedSkill(packageRoot, skillName) {
    const source = await node_fs_1.promises.readFile(node_path_1.default.join(packageRoot, 'SKILLs', skillName, 'SKILL.md'), 'utf8');
    const systemRouting = await node_fs_1.promises.readFile(node_path_1.default.join(packageRoot, 'skillpacks', 'common', 'templates', 'system-routing.md'), 'utf8');
    const confirmationContract = await node_fs_1.promises.readFile(node_path_1.default.join(packageRoot, 'skillpacks', 'common', 'templates', 'confirmation-contract.md'), 'utf8');
    return replaceAll(source, {
        '{{METABOT_CLI}}': 'metabot',
        '{{COMPATIBILITY_MANIFEST}}': 'release/compatibility.json',
        '{{HOST_ADAPTER_SECTION}}': '',
        '{{SYSTEM_ROUTING}}': replaceAll(systemRouting, {
            '{{METABOT_CLI}}': 'metabot',
        }),
        '{{CONFIRMATION_CONTRACT}}': replaceAll(confirmationContract, {
            '{{METABOT_CLI}}': 'metabot',
        }),
    });
}
async function copySharedSkills(input) {
    const sourceRoot = node_path_1.default.join(input.packageRoot, 'SKILLs');
    const sharedSkillRoot = node_path_1.default.join(input.systemHomeDir, '.metabot', 'skills');
    const installedSkills = await listSourceSkills(input.packageRoot);
    await node_fs_1.promises.mkdir(sharedSkillRoot, { recursive: true });
    for (const skillName of installedSkills) {
        const targetSkillRoot = node_path_1.default.join(sharedSkillRoot, skillName);
        const sourceSkillRoot = node_path_1.default.join(sourceRoot, skillName);
        await node_fs_1.promises.rm(targetSkillRoot, { recursive: true, force: true });
        await node_fs_1.promises.mkdir(targetSkillRoot, { recursive: true });
        await node_fs_1.promises.cp(sourceSkillRoot, targetSkillRoot, {
            recursive: true,
            filter: (sourcePath) => {
                const segments = node_path_1.default.relative(sourceSkillRoot, sourcePath).split(node_path_1.default.sep);
                return !segments.includes('evals') && node_path_1.default.basename(sourcePath) !== '.DS_Store';
            },
        });
        await node_fs_1.promises.writeFile(node_path_1.default.join(targetSkillRoot, 'SKILL.md'), await renderSharedSkill(input.packageRoot, skillName), 'utf8');
    }
    return { sharedSkillRoot, installedSkills };
}
function renderNodeResolverShellLines() {
    return [
        'resolve_node_bin() {',
        '  if [ -n "${METABOT_NODE:-}" ]; then',
        '    if [ -x "$METABOT_NODE" ]; then',
        '      printf \'%s\\n\' "$METABOT_NODE"',
        '      return 0',
        '    fi',
        '    echo "METABOT_NODE is set but is not executable: $METABOT_NODE" >&2',
        '    return 1',
        '  fi',
        '',
        '  for candidate in /opt/homebrew/opt/node@22/bin/node /usr/local/opt/node@22/bin/node /opt/homebrew/bin/node22 /usr/local/bin/node22; do',
        '    if [ -x "$candidate" ]; then',
        '      printf \'%s\\n\' "$candidate"',
        '      return 0',
        '    fi',
        '  done',
        '',
        '  if command -v node >/dev/null 2>&1; then',
        '    candidate="$(command -v node)"',
        '    major="$("$candidate" -p \'Number(process.versions.node.split(".")[0])\' 2>/dev/null || true)"',
        '    if [ -n "$major" ] && [ "$major" -ge 20 ] 2>/dev/null && [ "$major" -lt 25 ] 2>/dev/null; then',
        '      printf \'%s\\n\' "$candidate"',
        '      return 0',
        '    fi',
        '    version="$("$candidate" -v 2>/dev/null || printf unknown)"',
        '    echo "Unsupported Node.js version at $candidate ($version). Open Agent Connect requires Node.js >=20 <25. Install node@22 or set METABOT_NODE." >&2',
        '    return 1',
        '  fi',
        '',
        '  echo "Node.js >=20 <25 is required. Install node@22 or set METABOT_NODE." >&2',
        '  return 1',
        '}',
    ];
}
async function writeMetabotShim(input) {
    const binRoot = node_path_1.default.join(input.systemHomeDir, '.metabot', 'bin');
    const metabotShimPath = node_path_1.default.join(binRoot, 'metabot');
    const cliEntry = node_path_1.default.join(input.packageRoot, 'dist', 'cli', 'main.js');
    await node_fs_1.promises.mkdir(binRoot, { recursive: true });
    await node_fs_1.promises.access(cliEntry);
    await node_fs_1.promises.writeFile(metabotShimPath, [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        ...renderNodeResolverShellLines(),
        'NODE_BIN="$(resolve_node_bin)"',
        `exec "$NODE_BIN" ${JSON.stringify(cliEntry)} "$@"`,
        '',
    ].join('\n'), 'utf8');
    await node_fs_1.promises.chmod(metabotShimPath, 0o755);
    return metabotShimPath;
}
async function assertFileExists(filePath, code, message) {
    try {
        const stat = await node_fs_1.promises.stat(filePath);
        if (!stat.isFile()) {
            throw new Error('not a file');
        }
    }
    catch {
        throw new NpmInstallError(code, message);
    }
}
async function verifyRootBindings(input) {
    const missing = [];
    const boundSkills = [];
    for (const skillName of input.installedSkills) {
        const hostSkillPath = node_path_1.default.join(input.root.hostSkillRoot, skillName);
        const sharedSkillPath = node_path_1.default.join(input.sharedSkillRoot, skillName);
        try {
            const stat = await node_fs_1.promises.lstat(hostSkillPath);
            if (!stat.isSymbolicLink()) {
                missing.push(skillName);
                continue;
            }
            const target = await node_fs_1.promises.readlink(hostSkillPath);
            if (node_path_1.default.resolve(node_path_1.default.dirname(hostSkillPath), target) !== sharedSkillPath) {
                missing.push(skillName);
                continue;
            }
            boundSkills.push(skillName);
        }
        catch {
            missing.push(skillName);
        }
    }
    if (missing.length > 0 && input.forced) {
        throw new NpmInstallError('doctor_host_bindings_missing', `Missing host bindings for ${missing.join(', ')} under ${input.root.hostSkillRoot}. Run oac install --host <${SUPPORTED_HOSTS.join('|')}>.`);
    }
    if (missing.length > 0) {
        return { ...input.root, status: 'skipped', reason: 'bindings_missing', boundSkills: [] };
    }
    return { ...input.root, status: 'bound', boundSkills };
}
async function parentExists(hostSkillRoot) {
    try {
        const stat = await node_fs_1.promises.stat(node_path_1.default.dirname(hostSkillRoot));
        return stat.isDirectory();
    }
    catch {
        return false;
    }
}
async function expectedDoctorRoots(input) {
    const roots = input.host
        ? (0, platformRegistry_2.getPlatformSkillRoots)(input.host)
            .filter((root) => root.kind === 'global')
            .map((root) => ({ ...root, platformId: input.host }))
        : (0, platformRegistry_2.getInstallSkillRoots)();
    const results = [];
    for (const root of roots) {
        const hostSkillRoot = (0, platformRegistry_1.resolvePlatformSkillRootPath)(root, input.systemHomeDir, input.env);
        if (!input.host && root.autoBind === 'when-parent-exists' && !(await parentExists(hostSkillRoot))) {
            results.push({
                platformId: root.platformId,
                rootId: root.id,
                hostSkillRoot,
                status: 'skipped',
                reason: 'parent_missing',
                boundSkills: [],
                replacedEntries: [],
                unchangedEntries: [],
            });
            continue;
        }
        results.push({
            platformId: root.platformId,
            rootId: root.id,
            hostSkillRoot,
            status: 'bound',
            boundSkills: [],
            replacedEntries: [],
            unchangedEntries: [],
        });
    }
    return results;
}
async function verifyInstalledState(input) {
    const installedSkills = await listSourceSkills(input.packageRoot);
    const sharedSkillRoot = node_path_1.default.join(input.systemHomeDir, '.metabot', 'skills');
    const metabotShimPath = node_path_1.default.join(input.systemHomeDir, '.metabot', 'bin', 'metabot');
    for (const skillName of installedSkills) {
        await assertFileExists(node_path_1.default.join(sharedSkillRoot, skillName, 'SKILL.md'), 'doctor_shared_skills_missing', `Missing shared skill ${skillName} under ${sharedSkillRoot}. Run oac install.`);
    }
    await assertFileExists(metabotShimPath, 'doctor_metabot_shim_missing', `Missing metabot shim at ${metabotShimPath}. Run oac install.`);
    const roots = await expectedDoctorRoots({
        host: input.host,
        systemHomeDir: input.systemHomeDir,
        env: input.env,
    });
    const verifiedRoots = [];
    for (const root of roots) {
        if (root.status === 'skipped') {
            verifiedRoots.push(root);
            continue;
        }
        verifiedRoots.push(await verifyRootBindings({
            root,
            sharedSkillRoot,
            installedSkills,
            forced: Boolean(input.host) || root.platformId === 'shared-agents',
        }));
    }
    const boundRoots = verifiedRoots.filter((root) => root.status === 'bound');
    const skippedRoots = verifiedRoots.filter((root) => root.status === 'skipped');
    const hostPrimaryRoot = input.host ? boundRoots.find((root) => root.platformId === input.host) : undefined;
    return {
        host: input.host,
        packageRoot: input.packageRoot,
        sharedSkillRoot,
        metabotShimPath,
        installedSkills,
        boundRoots,
        skippedRoots,
        failedRoots: [],
        hostSkillRoot: hostPrimaryRoot?.hostSkillRoot,
        boundSkills: hostPrimaryRoot?.boundSkills,
        version: version_1.CLI_VERSION,
    };
}
function splitRootResults(results) {
    return {
        boundRoots: results.filter((root) => root.status === 'bound'),
        skippedRoots: results.filter((root) => root.status === 'skipped'),
        failedRoots: results.filter((root) => root.status === 'failed'),
    };
}
async function runNpmInstall(input, context) {
    try {
        const host = resolveRequestedHost(input.host);
        const systemHomeDir = resolveSystemHomeDir(context.env);
        const packageRoot = resolvePackageRoot(context);
        const { sharedSkillRoot, installedSkills } = await copySharedSkills({
            packageRoot,
            systemHomeDir,
        });
        const metabotShimPath = await writeMetabotShim({
            packageRoot,
            systemHomeDir,
        });
        const results = await (0, hostSkillBinding_1.bindPlatformSkills)({
            systemHomeDir,
            host,
            env: context.env,
            mode: host ? 'force-platform' : 'auto',
        });
        const split = splitRootResults(results);
        const hostPrimaryRoot = host ? split.boundRoots.find((root) => root.platformId === host) : undefined;
        return (0, commandResult_1.commandSuccess)({
            host,
            packageRoot,
            sharedSkillRoot,
            metabotShimPath,
            installedSkills,
            ...split,
            hostSkillRoot: hostPrimaryRoot?.hostSkillRoot,
            boundSkills: hostPrimaryRoot?.boundSkills,
            version: version_1.CLI_VERSION,
        });
    }
    catch (error) {
        return (0, commandResult_1.commandFailed)(error instanceof NpmInstallError ? error.code : 'install_failed', error instanceof Error ? error.message : String(error));
    }
}
async function runNpmDoctor(input, context) {
    try {
        const host = resolveRequestedHost(input.host);
        const systemHomeDir = resolveSystemHomeDir(context.env);
        const packageRoot = resolvePackageRoot(context);
        return (0, commandResult_1.commandSuccess)(await verifyInstalledState({
            host,
            packageRoot,
            systemHomeDir,
            env: context.env,
        }));
    }
    catch (error) {
        return (0, commandResult_1.commandFailed)(error instanceof NpmInstallError ? error.code : 'doctor_failed', error instanceof Error ? error.message : String(error));
    }
}
