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

        const finish = (exitCode: number, stderrSuffix = '') => {
          if (settled) {
            return;
          }

          settled = true;
          const stdout = Buffer.concat(stdoutChunks).toString('utf8');
          const stderr = `${Buffer.concat(stderrChunks).toString('utf8')}${stderrSuffix}`;
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

        const timeout = input.timeoutMs && input.timeoutMs > 0
          ? setTimeout(() => {
            timedOut = true;
            child.kill();
            finish(124, `Command timed out after ${input.timeoutMs}ms.`);
          }, input.timeoutMs)
          : undefined;

        child.stdout.on('data', (chunk: Buffer) => {
          stdoutChunks.push(chunk);
        });

        child.stderr.on('data', (chunk: Buffer) => {
          stderrChunks.push(chunk);
        });

        child.on('error', (error) => {
          if (timeout) {
            clearTimeout(timeout);
          }
          finish(-1, error.message);
        });

        child.on('close', (code) => {
          if (timeout) {
            clearTimeout(timeout);
          }
          finish(timedOut ? 124 : code ?? -1);
        });
      });
    },
  };
}
