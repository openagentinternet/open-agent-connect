import { spawn } from 'node:child_process';
import type { LlmRuntime } from './llmTypes';

const DEFAULT_TIMEOUT_MS = 120_000;

export interface LlmExecuteInput {
  runtime: LlmRuntime;
  prompt: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export interface LlmExecuteResult {
  ok: boolean;
  output: string;
  exitCode: number;
}

function buildArgs(provider: string, prompt: string): { args: string[]; useStdin: boolean } {
  if (provider === 'claude-code') {
    if (prompt.length > 4000) {
      return { args: ['--print'], useStdin: true };
    }
    return { args: ['--print', prompt], useStdin: false };
  }

  if (provider === 'codex') {
    return { args: ['exec', prompt], useStdin: false };
  }

  // openclaw or custom: try generic --print pattern.
  if (prompt.length > 4000) {
    return { args: ['--print'], useStdin: true };
  }
  return { args: ['--print', prompt], useStdin: false };
}

export async function executeLlm(input: LlmExecuteInput): Promise<LlmExecuteResult> {
  const binaryPath = input.runtime.binaryPath;
  if (!binaryPath) {
    return { ok: false, output: '', exitCode: 1 };
  }

  const provider = input.runtime.provider;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { args, useStdin } = buildArgs(provider, input.prompt);

  return new Promise((resolve) => {
    const child = spawn(binaryPath, args, {
      stdio: [useStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      env: input.env ?? process.env,
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (exitCode: number) => {
      if (settled) return;
      settled = true;
      const output = stdout.trim() || stderr.trim();
      resolve({
        ok: exitCode === 0 && output.length > 0,
        output,
        exitCode,
      });
    };

    const timeoutHandle = setTimeout(() => {
      if (!settled) {
        try {
          child.kill('SIGTERM');
        } catch {
          // Best effort.
        }
        finish(124);
      }
    }, timeoutMs);

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');

    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });

    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', () => {
      clearTimeout(timeoutHandle);
      finish(1);
    });

    child.on('close', (code) => {
      clearTimeout(timeoutHandle);
      finish(code ?? 1);
    });

    if (useStdin && child.stdin) {
      child.stdin.write(input.prompt);
      child.stdin.end();
    }
  });
}
