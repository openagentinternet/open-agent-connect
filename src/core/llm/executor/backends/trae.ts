import { spawn } from 'node:child_process';
import readline from 'node:readline';
import type { LlmExecutionRequest, LlmExecutionResult, LlmEventEmitter } from '../types';
import { buildProcessEnv, filterBlockedArgs, shutdownChildProcess, stringifyError, type LlmBackend, type LlmBackendFactory } from './backend';

function buildTraeArgs(request: LlmExecutionRequest): string[] {
  const args = ['chat', request.prompt, '--mode', 'agent', '--reuse-window'];
  args.push(...filterBlockedArgs(request.extraArgs, {
    '-m': { takesValue: true },
    '--mode': { takesValue: true },
    '-r': { takesValue: false },
    '--reuse-window': { takesValue: false },
    '-n': { takesValue: false },
    '--new-window': { takesValue: false },
  }));
  return args;
}

export function createTraeBackend(binaryPath: string, env?: Record<string, string>): LlmBackend {
  return {
    provider: 'trae',
    async execute(request: LlmExecutionRequest, emitter: LlmEventEmitter, signal: AbortSignal): Promise<LlmExecutionResult> {
      const startedAt = Date.now();
      const child = spawn(binaryPath, buildTraeArgs(request), {
        cwd: request.cwd,
        env: buildProcessEnv(env, request.env),
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let output = '';
      let stderrTail = '';
      let status: LlmExecutionResult['status'] = 'completed';
      let errorMessage: string | undefined;

      const childExit = new Promise<number | null>((resolve) => {
        child.on('close', (code) => resolve(code));
      });
      const childError = new Promise<Error>((resolve) => {
        child.once('error', (error) => resolve(error));
      });

      const stdoutDone = new Promise<void>((resolve) => {
        child.stdout.setEncoding('utf8');
        const rl = readline.createInterface({ input: child.stdout });
        rl.on('line', (line) => {
          const text = line.trimEnd();
          if (!text) return;
          output += output ? `\n${text}` : text;
          emitter.emit({ type: 'text', content: text });
        });
        rl.on('close', () => resolve());
      });

      const stderrDone = new Promise<void>((resolve) => {
        child.stderr.setEncoding('utf8');
        const rl = readline.createInterface({ input: child.stderr });
        rl.on('line', (line) => {
          const text = line.trimEnd();
          if (!text) return;
          stderrTail += `${text}\n`;
          if (stderrTail.length > 4096) stderrTail = stderrTail.slice(-4096);
          emitter.emit({ type: 'log', level: 'error', message: text });
        });
        rl.on('close', () => resolve());
      });

      const timeoutMs = request.timeout ?? 1_200_000;
      let timeoutHandle: NodeJS.Timeout | undefined;
      const timeout = new Promise<void>((resolve) => {
        timeoutHandle = setTimeout(() => {
          status = 'timeout';
          errorMessage = `trae timed out after ${timeoutMs}ms`;
          try {
            child.kill('SIGTERM');
          } catch {
            // Best effort.
          }
          resolve();
        }, timeoutMs);
      });

      const abort = new Promise<void>((resolve) => {
        if (signal.aborted) {
          status = 'cancelled';
          errorMessage = 'trae execution cancelled';
          resolve();
          return;
        }
        signal.addEventListener('abort', () => {
          status = 'cancelled';
          errorMessage = 'trae execution cancelled';
          try {
            child.kill('SIGTERM');
          } catch {
            // Best effort.
          }
          resolve();
        }, { once: true });
      });

      try {
        const completion = await Promise.race([
          Promise.all([stdoutDone, stderrDone, childExit]).then(([, , code]) => ({ type: 'exit' as const, code })),
          timeout.then(() => ({ type: 'terminal' as const })),
          abort.then(() => ({ type: 'terminal' as const })),
          childError.then((error) => ({ type: 'error' as const, error })),
        ]);
        if (completion.type === 'error') {
          status = 'failed';
          errorMessage = stringifyError(completion.error);
        } else if (completion.type === 'exit' && completion.code !== 0 && status === 'completed') {
          status = 'failed';
          errorMessage = `trae exited with code ${completion.code ?? 'unknown'}`;
        }
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        await shutdownChildProcess(child, childExit, {
          terminate: status !== 'completed',
          graceMs: status === 'completed' ? 2_000 : 250,
        });
      }

      if (stderrTail.trim() && status !== 'completed') {
        errorMessage = `${errorMessage ?? 'trae failed'}\n${stderrTail.trim()}`;
      }

      return {
        status,
        output,
        error: errorMessage,
        durationMs: Date.now() - startedAt,
      };
    },
  };
}

export const traeBackendFactory: LlmBackendFactory = createTraeBackend;
