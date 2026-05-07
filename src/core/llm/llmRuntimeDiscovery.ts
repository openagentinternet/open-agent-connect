import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  getPlatformDefinition,
  getRuntimePlatforms,
  isPlatformId,
} from '../platform/platformRegistry';
import type { LlmRuntime, LlmProvider, LlmAuthState } from './llmTypes';

export interface DiscoveryInput {
  env?: NodeJS.ProcessEnv;
  createId?: () => string;
  now?: () => string;
}

export interface DiscoveryResult {
  runtimes: LlmRuntime[];
  errors: Array<{ provider: string; message: string }>;
}

function getPathEnv(env?: NodeJS.ProcessEnv): string {
  return (env ?? process.env).PATH ?? '';
}

function splitPath(pathEnv: string): string[] {
  const separator = process.platform === 'win32' ? ';' : ':';
  return pathEnv.split(separator).filter(Boolean);
}

export async function findExecutableInPath(name: string, pathDirs?: string[]): Promise<string | null> {
  const dirs = pathDirs ?? splitPath(getPathEnv());
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    try {
      await fs.access(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Not found / not executable.
    }
  }
  return null;
}

export async function readExecutableVersion(
  binaryPath: string,
  versionArgs: string[] = ['--version'],
  timeoutMs = 5_000,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn(binaryPath, versionArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      shell: false,
    });

    let output = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* best effort */ }
      resolve(undefined);
    }, timeoutMs);

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');

    child.stdout?.on('data', (chunk: string) => { output += chunk; });
    child.stderr?.on('data', (chunk: string) => { output += chunk; });

    child.on('close', () => {
      clearTimeout(timer);
      const trimmed = output.trim();
      if (!trimmed) {
        resolve(undefined);
        return;
      }
      const match = trimmed.match(/(\d+\.\d+\.\d+(?:[-+][^\s]+)?)/);
      resolve(match ? match[1] : trimmed.split(/\s+/).pop() ?? undefined);
    });

    child.on('error', () => {
      clearTimeout(timer);
      resolve(undefined);
    });
  });
}

function detectAuthState(authEnv: string[], env: NodeJS.ProcessEnv): LlmAuthState {
  if (authEnv.some((envVar) => Boolean(env[envVar]))) {
    return 'authenticated';
  }
  return 'unknown';
}

export async function discoverProvider(
  provider: LlmProvider,
  pathDirs: string[],
  options?: { createId?: () => string; now?: () => string; env?: NodeJS.ProcessEnv },
): Promise<LlmRuntime | null> {
  if (provider === 'custom') return null; // Custom runtimes are registered manually.
  if (!isPlatformId(provider)) return null;

  const platform = getPlatformDefinition(provider);
  let binaryPath: string | null = null;
  for (const binaryName of platform.runtime.binaryNames) {
    binaryPath = await findExecutableInPath(binaryName, pathDirs);
    if (binaryPath) break;
  }
  if (!binaryPath) return null;

  const env = options?.env ?? process.env;
  const version = await readExecutableVersion(
    binaryPath,
    platform.runtime.versionArgs.length ? platform.runtime.versionArgs : ['--version'],
    5_000,
    env,
  );
  const now = (options?.now ?? (() => new Date().toISOString()))();
  // Stable ID: same binary always gets same id, so rediscovery upserts instead of duplicating.
  const defaultId = `llm_${provider.replace(/-/g, '_')}_${binaryPath}`;
  const createId = options?.createId ?? (() => defaultId);
  const authState = detectAuthState(platform.runtime.authEnv, env);

  return {
    id: createId(),
    provider,
    displayName: platform.displayName,
    binaryPath,
    version,
    logoPath: platform.logoPath,
    authState,
    health: 'healthy',
    capabilities: [...platform.runtime.capabilities],
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

export async function discoverLlmRuntimes(input?: DiscoveryInput): Promise<DiscoveryResult> {
  const pathDirs = splitPath(getPathEnv(input?.env));
  const runtimes: LlmRuntime[] = [];
  const errors: Array<{ provider: string; message: string }> = [];

  // Discover each supported provider. Run in sequence to keep it simple;
  // the binary spawns are the slow part, and they're already async.
  for (const platform of getRuntimePlatforms()) {
    try {
      const runtime = await discoverProvider(platform.id, pathDirs, {
        createId: input?.createId,
        now: input?.now,
        env: input?.env ?? process.env,
      });
      if (runtime) {
        runtimes.push(runtime);
      }
    } catch (err) {
      errors.push({
        provider: platform.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { runtimes, errors };
}
