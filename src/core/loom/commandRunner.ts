import { spawn } from 'node:child_process';

export interface LoomCommandRunInput {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  shell?: boolean;
}

export interface LoomCommandRunResult {
  command: string;
  args: string[];
  cwd?: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface LoomCommandRunner {
  run(input: LoomCommandRunInput): Promise<LoomCommandRunResult>;
}

export function createNodeLoomCommandRunner(): LoomCommandRunner {
  return {
    run(input) {
      const startedAt = Date.now();
      return new Promise<LoomCommandRunResult>((resolve) => {
        const child = spawn(input.command, input.args, {
          cwd: input.cwd,
          env: input.env,
          shell: input.shell ?? false,
        });
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        let settled = false;
        let timedOut = false;
        let timeoutMessage = '';
        let timeout: NodeJS.Timeout | undefined;
        let escalationTimeout: NodeJS.Timeout | undefined;

        const clearTimers = () => {
          if (timeout) {
            clearTimeout(timeout);
            timeout = undefined;
          }
          if (escalationTimeout) {
            clearTimeout(escalationTimeout);
            escalationTimeout = undefined;
          }
        };

        const appendStderr = (stderr: string, suffix: string) => {
          if (!suffix) {
            return stderr;
          }
          return stderr && !stderr.endsWith('\n') ? `${stderr}\n${suffix}` : `${stderr}${suffix}`;
        };

        const finish = (exitCode: number, stderrSuffix = '') => {
          if (settled) {
            return;
          }

          settled = true;
          clearTimers();
          const stdout = Buffer.concat(stdoutChunks).toString('utf8');
          let stderr = Buffer.concat(stderrChunks).toString('utf8');
          stderr = appendStderr(stderr, stderrSuffix);
          stderr = appendStderr(stderr, timedOut ? timeoutMessage : '');
          resolve({
            command: input.command,
            args: input.args,
            cwd: input.cwd,
            exitCode,
            stdout,
            stderr,
            durationMs: Date.now() - startedAt,
          });
        };

        const timeoutMs = input.timeoutMs && input.timeoutMs > 0 ? input.timeoutMs : undefined;
        timeout = timeoutMs
          ? setTimeout(() => {
            timedOut = true;
            timeoutMessage = `Command timed out after ${timeoutMs}ms.`;
            child.kill('SIGTERM');
            escalationTimeout = setTimeout(() => {
              child.kill('SIGKILL');
            }, Math.min(timeoutMs, 1000));
          }, timeoutMs)
          : undefined;

        child.stdout.on('data', (chunk: Buffer) => {
          stdoutChunks.push(chunk);
        });

        child.stderr.on('data', (chunk: Buffer) => {
          stderrChunks.push(chunk);
        });

        child.on('error', (error) => {
          finish(timedOut ? 124 : -1, error.message);
        });

        child.on('close', (code) => {
          finish(timedOut ? 124 : code ?? -1);
        });
      });
    },
  };
}
