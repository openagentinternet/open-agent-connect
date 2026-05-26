import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  normalizeMetaAppManifestInput,
  readMetaAppManifestFile,
} from './manifest';
import type {
  MetaAppManifestInput,
  MetaAppPackageManager,
  MetaAppPreviewPlan,
  MetaAppProjectType,
} from './types';

const OUTPUT_DIRS = ['dist', 'build', 'out', 'public'];
const LOCKFILES: Array<[string, MetaAppPackageManager]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
];

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function detectPackageManager(projectDir: string): Promise<MetaAppPackageManager | null> {
  for (const [fileName, packageManager] of LOCKFILES) {
    if (await pathExists(path.join(projectDir, fileName))) {
      return packageManager;
    }
  }
  return null;
}

async function detectOutputDir(projectDir: string): Promise<string | null> {
  for (const relativeDir of OUTPUT_DIRS) {
    const artifactDir = path.join(projectDir, relativeDir);
    if (await pathExists(path.join(artifactDir, 'index.html'))) {
      return artifactDir;
    }
  }
  if (await pathExists(path.join(projectDir, 'index.html'))) {
    return projectDir;
  }
  return null;
}

function detectIndexFile(projectDir: string, artifactDir: string | null, overrideIndexFile?: string): string {
  if (overrideIndexFile) {
    return overrideIndexFile;
  }
  if (artifactDir === projectDir || artifactDir === null) {
    return 'index.html';
  }
  return 'index.html';
}

function buildManualAction(code: string, message: string): MetaAppPreviewPlan['manualAction'] {
  return { code, message };
}

export async function inspectMetaAppProject(input: {
  cwd?: string;
  projectDir: string;
  manifestFile?: string;
}): Promise<MetaAppPreviewPlan> {
  const cwd = path.resolve(input.cwd ?? process.cwd());
  const projectDir = path.resolve(cwd, input.projectDir);
  const packageJsonPath = path.join(projectDir, 'package.json');
  const packageJson = (await readJsonFile(packageJsonPath)) ?? null;
  const hasPackageJson = Boolean(packageJson);
  const packageManager = hasPackageJson ? await detectPackageManager(projectDir) ?? 'npm' : null;
  const manifestOverridePath = input.manifestFile
    ? path.resolve(cwd, input.manifestFile)
    : (await pathExists(path.join(projectDir, '.metaapp.json')) ? path.join(projectDir, '.metaapp.json') : null);

  let manifest: MetaAppManifestInput = {};
  if (manifestOverridePath) {
    try {
      manifest = await readMetaAppManifestFile(manifestOverridePath);
    } catch {
      return {
        projectDir,
        projectType: 'manual',
        artifactDir: null,
        indexFile: 'index.html',
        buildCommand: null,
        packageManager,
        manifest: {},
        manualAction: buildManualAction(
          'metaapp_manifest_invalid',
          `Unable to read MetaApp manifest override at ${manifestOverridePath}.`,
        ),
      };
    }
  }

  const artifactDir = await detectOutputDir(projectDir);
  const indexFile = detectIndexFile(projectDir, artifactDir, typeof manifest.indexFile === 'string' ? manifest.indexFile : undefined);

  if (hasPackageJson) {
    const scripts = packageJson && typeof packageJson.scripts === 'object' && packageJson.scripts && !Array.isArray(packageJson.scripts)
      ? packageJson.scripts as Record<string, unknown>
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
        manifest: normalizeMetaAppManifestInput(manifest),
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
        manifest: normalizeMetaAppManifestInput(manifest),
        manualAction: buildManualAction(
          'metaapp_build_output_missing',
          'The project declares a build script but no known output directory with index.html was found.',
        ),
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
        manifest: normalizeMetaAppManifestInput(manifest),
      };
    }
    return {
      projectDir,
      projectType: 'manual',
      artifactDir: null,
      indexFile,
      buildCommand: null,
      packageManager,
      manifest: normalizeMetaAppManifestInput(manifest),
      manualAction: buildManualAction(
        'metaapp_project_unrecognized',
        'The project looks like a package but no browser-runnable entry or build output was detected.',
      ),
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
      manifest: normalizeMetaAppManifestInput(manifest),
    };
  }

  return {
    projectDir,
    projectType: 'manual',
    artifactDir: null,
    indexFile,
    buildCommand: null,
    packageManager: null,
    manifest: normalizeMetaAppManifestInput(manifest),
    manualAction: buildManualAction(
      'metaapp_project_unrecognized',
      'The project does not contain a browser-runnable entry point that MetaApp can package automatically.',
    ),
  };
}
