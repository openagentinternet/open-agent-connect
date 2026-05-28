"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.inspectMetaAppProject = inspectMetaAppProject;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const manifest_1 = require("./manifest");
const OUTPUT_DIRS = ['dist', 'build', 'out', 'public'];
const LOCKFILES = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
    ['bun.lockb', 'bun'],
    ['bun.lock', 'bun'],
];
async function pathExists(filePath) {
    try {
        await node_fs_1.promises.access(filePath);
        return true;
    }
    catch {
        return false;
    }
}
async function readJsonFile(filePath) {
    try {
        const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    }
    catch {
        return null;
    }
}
async function detectPackageManager(projectDir) {
    for (const [fileName, packageManager] of LOCKFILES) {
        if (await pathExists(node_path_1.default.join(projectDir, fileName))) {
            return packageManager;
        }
    }
    return null;
}
async function detectOutputDir(projectDir) {
    for (const relativeDir of OUTPUT_DIRS) {
        const artifactDir = node_path_1.default.join(projectDir, relativeDir);
        if (await pathExists(node_path_1.default.join(artifactDir, 'index.html'))) {
            return artifactDir;
        }
    }
    if (await pathExists(node_path_1.default.join(projectDir, 'index.html'))) {
        return projectDir;
    }
    return null;
}
function detectIndexFile(projectDir, artifactDir, overrideIndexFile) {
    if (overrideIndexFile) {
        return overrideIndexFile;
    }
    if (artifactDir === projectDir || artifactDir === null) {
        return 'index.html';
    }
    return 'index.html';
}
function buildManualAction(code, message) {
    return { code, message };
}
async function inspectMetaAppProject(input) {
    const cwd = node_path_1.default.resolve(input.cwd ?? process.cwd());
    const projectDir = node_path_1.default.resolve(cwd, input.projectDir);
    const packageJsonPath = node_path_1.default.join(projectDir, 'package.json');
    const packageJson = (await readJsonFile(packageJsonPath)) ?? null;
    const hasPackageJson = Boolean(packageJson);
    const packageManager = hasPackageJson ? await detectPackageManager(projectDir) ?? 'npm' : null;
    const manifestOverridePath = input.manifestFile
        ? node_path_1.default.resolve(cwd, input.manifestFile)
        : (await pathExists(node_path_1.default.join(projectDir, '.metaapp.json')) ? node_path_1.default.join(projectDir, '.metaapp.json') : null);
    let manifest = {};
    if (manifestOverridePath) {
        try {
            manifest = await (0, manifest_1.readMetaAppManifestFile)(manifestOverridePath);
        }
        catch {
            return {
                projectDir,
                projectType: 'manual',
                artifactDir: null,
                indexFile: 'index.html',
                buildCommand: null,
                packageManager,
                manifest: {},
                manualAction: buildManualAction('metaapp_manifest_invalid', `Unable to read MetaApp manifest override at ${manifestOverridePath}.`),
            };
        }
    }
    const artifactDir = await detectOutputDir(projectDir);
    const indexFile = detectIndexFile(projectDir, artifactDir, typeof manifest.indexFile === 'string' ? manifest.indexFile : undefined);
    if (hasPackageJson) {
        const scripts = packageJson && typeof packageJson.scripts === 'object' && packageJson.scripts && !Array.isArray(packageJson.scripts)
            ? packageJson.scripts
            : {};
        const buildScript = typeof scripts.build === 'string' ? scripts.build.trim() : '';
        if (artifactDir) {
            return {
                projectDir,
                projectType: 'npm',
                artifactDir,
                indexFile,
                buildCommand: buildScript ? `${packageManager ?? 'npm'} run build` : null,
                packageManager,
                manifest: (0, manifest_1.normalizeMetaAppManifestInput)(manifest),
            };
        }
        if (buildScript) {
            return {
                projectDir,
                projectType: 'npm',
                artifactDir: null,
                indexFile,
                buildCommand: `${packageManager ?? 'npm'} run build`,
                packageManager,
                manifest: (0, manifest_1.normalizeMetaAppManifestInput)(manifest),
                manualAction: buildManualAction('metaapp_build_output_missing', 'The project declares a build script but no known output directory with index.html was found.'),
            };
        }
        if (artifactDir === projectDir) {
            return {
                projectDir,
                projectType: 'npm',
                artifactDir,
                indexFile,
                buildCommand: null,
                packageManager,
                manifest: (0, manifest_1.normalizeMetaAppManifestInput)(manifest),
            };
        }
        return {
            projectDir,
            projectType: 'manual',
            artifactDir: null,
            indexFile,
            buildCommand: null,
            packageManager,
            manifest: (0, manifest_1.normalizeMetaAppManifestInput)(manifest),
            manualAction: buildManualAction('metaapp_project_unrecognized', 'The project looks like a package but no browser-runnable entry or build output was detected.'),
        };
    }
    if (artifactDir) {
        return {
            projectDir,
            projectType: 'static',
            artifactDir,
            indexFile,
            buildCommand: null,
            packageManager: null,
            manifest: (0, manifest_1.normalizeMetaAppManifestInput)(manifest),
        };
    }
    return {
        projectDir,
        projectType: 'manual',
        artifactDir: null,
        indexFile,
        buildCommand: null,
        packageManager: null,
        manifest: (0, manifest_1.normalizeMetaAppManifestInput)(manifest),
        manualAction: buildManualAction('metaapp_project_unrecognized', 'The project does not contain a browser-runnable entry point that MetaApp can package automatically.'),
    };
}
