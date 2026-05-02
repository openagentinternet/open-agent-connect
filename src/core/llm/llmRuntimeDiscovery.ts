import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  SUPPORTED_LLM_PROVIDERS,
  HOST_BINARY_MAP,
} from './llmTypes';
import type { LlmRuntime, LlmProvider } from './llmTypes';

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

export async function readExecutableVersion(binaryPath: string, timeoutMs = 5_000): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn(binaryPath, ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
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

export async function discoverProvider(
  provider: LlmProvider,
  pathDirs: string[],
  options?: { createId?: () => string; now?: () => string },
): Promise<LlmRuntime | null> {
  if (provider === 'custom') return null; // Custom runtimes are registered manually.

  const binaryName = HOST_BINARY_MAP[provider];
  if (!binaryName) return null;

  const binaryPath = await findExecutableInPath(binaryName, pathDirs);
  if (!binaryPath) return null;

  const version = await readExecutableVersion(binaryPath);
  const now = (options?.now ?? (() => new Date().toISOString()))();
  const createId = options?.createId ?? (() => `llm_${provider.replace('-', '_')}_${Date.now()}`);
  const env = process.env;
  const authState =
    (provider === 'claude-code' && env.ANTHROPIC_API_KEY) ? 'authenticated' :
    (provider === 'codex' && env.OPENAI_API_KEY) ? 'authenticated' :
    'unknown';

  const displayNames: Record<string, string> = {
    'claude-code': 'Claude Code',
    'codex': 'Codex',
    'openclaw': 'OpenClaw',
  };

  return {
    id: createId(),
    provider,
    displayName: displayNames[provider] ?? provider,
    binaryPath,
    version,
    authState,
    health: 'healthy',
    capabilities: ['tool-use'],
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
  for (const provider of SUPPORTED_LLM_PROVIDERS) {
    try {
      const runtime = await discoverProvider(provider, pathDirs, {
        createId: input?.createId,
        now: input?.now,
      });
      if (runtime) {
        runtimes.push(runtime);
      }
    } catch (err) {
      errors.push({
        provider,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { runtimes, errors };
}
