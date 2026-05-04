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
const SUPPORTED_HOSTS = ['codex', 'claude-code', 'openclaw'];
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
function isSupportedHost(value) {
    return SUPPORTED_HOSTS.includes(value);
}
function resolveRequestedHost(host) {
    const normalized = normalizeText(host);
    if (!normalized) {
        return null;
    }
    if (!isSupportedHost(normalized)) {
        throw new NpmInstallError('invalid_argument', `Unsupported --host value: ${normalized}. Supported values: ${SUPPORTED_HOSTS.join(', ')}.`);
    }
    return normalized;
}
function hostSignalPresent(env, host) {
    switch (host) {
        case 'codex':
            return Boolean(normalizeText(env.CODEX_HOME));
        case 'claude-code':
            return Boolean(normalizeText(env.CLAUDE_HOME));
        case 'openclaw':
            return Boolean(normalizeText(env.OPENCLAW_HOME));
    }
}
function detectHost(env) {
    const detected = SUPPORTED_HOSTS.filter((host) => hostSignalPresent(env, host));
    if (detected.length === 1) {
        return detected[0];
    }
    if (detected.length > 1) {
        throw new NpmInstallError('install_host_ambiguous', `Multiple host environments detected: ${detected.join(', ')}. Rerun with --host <codex|claude-code|openclaw>.`);
    }
    return 'codex';
}
function resolveHost(input, env) {
    return resolveRequestedHost(input.host) ?? detectHost(env);
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
async function writeMetabotShim(input) {
    const binRoot = node_path_1.default.join(input.systemHomeDir, '.metabot', 'bin');
    const metabotShimPath = node_path_1.default.join(binRoot, 'metabot');
    const cliEntry = node_path_1.default.join(input.packageRoot, 'dist', 'cli', 'main.js');
    await node_fs_1.promises.mkdir(binRoot, { recursive: true });
    await node_fs_1.promises.access(cliEntry);
    await node_fs_1.promises.writeFile(metabotShimPath, [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        `exec node ${JSON.stringify(cliEntry)} "$@"`,
        '',
    ].join('\n'), 'utf8');
    await node_fs_1.promises.chmod(metabotShimPath, 0o755);
    return metabotShimPath;
}
function resolveHostHomeDir(systemHomeDir, host, env) {
    switch (host) {
        case 'codex':
            return node_path_1.default.resolve(normalizeText(env.CODEX_HOME) || node_path_1.default.join(systemHomeDir, '.codex'));
        case 'claude-code':
            return node_path_1.default.resolve(normalizeText(env.CLAUDE_HOME) || node_path_1.default.join(systemHomeDir, '.claude'));
        case 'openclaw':
            return node_path_1.default.resolve(normalizeText(env.OPENCLAW_HOME) || node_path_1.default.join(systemHomeDir, '.openclaw'));
    }
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
async function verifyHostBindings(input) {
    const missing = [];
    const boundSkills = [];
    for (const skillName of input.installedSkills) {
        const hostSkillPath = node_path_1.default.join(input.hostSkillRoot, skillName);
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
    if (missing.length > 0) {
        throw new NpmInstallError('doctor_host_bindings_missing', `Missing host bindings for ${missing.join(', ')} under ${input.hostSkillRoot}. Run oac install --host <codex|claude-code|openclaw>.`);
    }
    return boundSkills;
}
async function verifyInstalledState(input) {
    const installedSkills = await listSourceSkills(input.packageRoot);
    const sharedSkillRoot = node_path_1.default.join(input.systemHomeDir, '.metabot', 'skills');
    const metabotShimPath = node_path_1.default.join(input.systemHomeDir, '.metabot', 'bin', 'metabot');
    const hostSkillRoot = node_path_1.default.join(resolveHostHomeDir(input.systemHomeDir, input.host, input.env), 'skills');
    for (const skillName of installedSkills) {
        await assertFileExists(node_path_1.default.join(sharedSkillRoot, skillName, 'SKILL.md'), 'doctor_shared_skills_missing', `Missing shared skill ${skillName} under ${sharedSkillRoot}. Run oac install --host <codex|claude-code|openclaw>.`);
    }
    await assertFileExists(metabotShimPath, 'doctor_metabot_shim_missing', `Missing metabot shim at ${metabotShimPath}. Run oac install --host <codex|claude-code|openclaw>.`);
    const boundSkills = await verifyHostBindings({
        hostSkillRoot,
        sharedSkillRoot,
        installedSkills,
    });
    return {
        host: input.host,
        packageRoot: input.packageRoot,
        sharedSkillRoot,
        metabotShimPath,
        installedSkills,
        hostSkillRoot,
        boundSkills,
        version: version_1.CLI_VERSION,
    };
}
async function runNpmInstall(input, context) {
    try {
        const host = resolveHost(input, context.env);
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
        const binding = await (0, hostSkillBinding_1.bindHostSkills)({
            systemHomeDir,
            host,
            env: context.env,
        });
        return (0, commandResult_1.commandSuccess)({
            host,
            packageRoot,
            sharedSkillRoot,
            metabotShimPath,
            installedSkills,
            hostSkillRoot: binding.hostSkillRoot,
            boundSkills: binding.boundSkills,
            version: version_1.CLI_VERSION,
        });
    }
    catch (error) {
        return (0, commandResult_1.commandFailed)(error instanceof NpmInstallError ? error.code : 'install_failed', error instanceof Error ? error.message : String(error));
    }
}
async function runNpmDoctor(input, context) {
    try {
        const host = resolveHost(input, context.env);
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
