import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  type SystemHost,
  SystemCommandError,
  type SystemUpdateInput,
  type SystemUpdateResult,
} from './types';

const NPM_PACKAGE_NAME = 'open-agent-connect';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNpmVersionSpecifier(version: string): string {
  const normalized = normalizeText(version);
  if (!normalized || normalized === 'latest') {
    return 'latest';
  }
  return /^v\d+\.\d+\.\d+(?:[-+].*)?$/.test(normalized) ? normalized.slice(1) : normalized;
}

function buildNpmPackageSpec(version: string): string {
  return `${NPM_PACKAGE_NAME}@${normalizeNpmVersionSpecifier(version)}`;
}

function buildReleaseDownloadUrl(host: SystemHost, version: string): string {
  const normalizedVersion = normalizeText(version);
  if (!normalizedVersion || normalizedVersion === 'latest') {
    return `https://github.com/openagentinternet/open-agent-connect/releases/latest/download/oac-${host}.tar.gz`;
  }
  return `https://github.com/openagentinternet/open-agent-connect/releases/download/${normalizedVersion}/oac-${host}.tar.gz`;
}

async function readInstalledVersion(systemHomeDir: string, host: SystemHost): Promise<string | null> {
  const compatibilityPath = path.join(
    systemHomeDir,
    '.metabot',
    'installpacks',
    host,
    'runtime',
    'compatibility.json',
  );
  try {
    const raw = await fs.readFile(compatibilityPath, 'utf8');
    const parsed = JSON.parse(raw) as { cli?: unknown };
    const cli = normalizeText(parsed?.cli);
    return cli || null;
  } catch {
    return null;
  }
}

async function runCommand(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: 'pipe',
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

async function readExtractedVersion(extractedHostDir: string): Promise<string | null> {
  const compatibilityPath = path.join(extractedHostDir, 'runtime', 'compatibility.json');
  try {
    const raw = await fs.readFile(compatibilityPath, 'utf8');
    const parsed = JSON.parse(raw) as { cli?: unknown };
    const cli = normalizeText(parsed?.cli);
    return cli || null;
  } catch {
    return null;
  }
}

export async function runSystemUpdate(input: SystemUpdateInput): Promise<SystemUpdateResult> {
  const requestedVersion = normalizeText(input.version) || 'latest';
  if (!input.host) {
    const packageSpec = buildNpmPackageSpec(requestedVersion);
    if (input.dryRun) {
      return {
        updateMode: 'npm',
        host: null,
        requestedVersion,
        resolvedVersion: null,
        previousVersion: null,
        outcome: 'no_update',
        packageSpec,
        dryRun: true,
      };
    }

    const updateEnv = {
      ...input.env,
      HOME: input.systemHomeDir,
    };
    try {
      await runCommand('npm', ['i', '-g', packageSpec], {
        cwd: input.systemHomeDir,
        env: updateEnv,
      });
      await runCommand('oac', ['install'], {
        cwd: input.systemHomeDir,
        env: updateEnv,
      });
      return {
        updateMode: 'npm',
        host: null,
        requestedVersion,
        resolvedVersion: null,
        previousVersion: null,
        outcome: 'updated',
        packageSpec,
        dryRun: false,
      };
    } catch (error) {
      throw new SystemCommandError(
        'install_failed',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const host = input.host;
  const downloadUrl = buildReleaseDownloadUrl(host, requestedVersion);
  const previousVersion = await readInstalledVersion(input.systemHomeDir, host);
  const installpackPath = path.join(input.systemHomeDir, '.metabot', 'installpacks', host);

  if (input.dryRun) {
    return {
      updateMode: 'release-pack',
      host,
      requestedVersion,
      resolvedVersion: previousVersion,
      previousVersion,
      outcome: 'no_update',
      downloadUrl,
      installpackPath,
      dryRun: true,
    };
  }

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'metabot-system-update-'));
  const archivePath = path.join(tmpRoot, `oac-${host}.tar.gz`);
  try {
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new SystemCommandError(
        'download_failed',
        `Failed to download update archive (${response.status} ${response.statusText}) from ${downloadUrl}.`,
      );
    }
    const body = await response.arrayBuffer();
    await fs.writeFile(archivePath, Buffer.from(body));

    await runCommand('tar', ['-xzf', archivePath, '-C', tmpRoot], {
      cwd: tmpRoot,
      env: input.env,
    });

    const extractedHostDir = path.join(tmpRoot, host);
    const installerPath = path.join(extractedHostDir, 'install.sh');
    const runtimeEntryPath = path.join(extractedHostDir, 'runtime', 'dist', 'cli', 'main.js');

    try {
      await fs.access(installerPath);
      await fs.access(runtimeEntryPath);
    } catch {
      throw new SystemCommandError(
        'install_artifact_invalid',
        `Invalid update artifact for host ${host}: missing install.sh or runtime CLI entry.`,
      );
    }

    await runCommand('bash', [installerPath], {
      cwd: extractedHostDir,
      env: {
        ...input.env,
        HOME: input.systemHomeDir,
      },
    });

    const resolvedVersion = await readExtractedVersion(extractedHostDir);
    const outcome = previousVersion && resolvedVersion && previousVersion === resolvedVersion
      ? 'no_update'
      : 'updated';

    return {
      updateMode: 'release-pack',
      host,
      requestedVersion,
      resolvedVersion,
      previousVersion,
      outcome,
      downloadUrl,
      installpackPath,
      dryRun: false,
    };
  } catch (error) {
    if (error instanceof SystemCommandError) {
      throw error;
    }
    throw new SystemCommandError(
      'install_failed',
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
}
