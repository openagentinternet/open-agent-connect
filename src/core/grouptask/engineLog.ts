/**
 * Size-capped append-only log for the group task engine + OpenTeam intake.
 *
 * The engine runs inside the detached daemon whose stdio is ignored: without
 * this file every `ctx.log` failure line — expired invites, failed LLM turns,
 * indexer errors — evaporates. Writes are serialized and best-effort: a
 * logging failure must never break the 5s tick. One rolled generation
 * (`<file>.1`) keeps the on-disk footprint bounded.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const GROUP_TASK_ENGINE_LOG_FILE_NAME = 'grouptask-engine.log';
export const DEFAULT_GROUP_TASK_ENGINE_LOG_MAX_BYTES = 1024 * 1024;

export type GroupTaskEngineLogWriter = ((message: string) => void) & {
  /** Resolves once every line queued so far has been written (or dropped). */
  flush(): Promise<void>;
};

export function resolveGroupTaskEngineLogPath(logsRoot: string): string {
  return path.join(logsRoot, GROUP_TASK_ENGINE_LOG_FILE_NAME);
}

export function createGroupTaskEngineLogWriter(options: {
  logFile: string;
  maxBytes?: number;
}): GroupTaskEngineLogWriter {
  const maxBytes = options.maxBytes ?? DEFAULT_GROUP_TASK_ENGINE_LOG_MAX_BYTES;
  let queue: Promise<void> = Promise.resolve();

  const append = async (line: string): Promise<void> => {
    try {
      await fs.mkdir(path.dirname(options.logFile), { recursive: true });
      const size = await fs.stat(options.logFile).then(
        (stat) => stat.size,
        () => 0,
      );
      if (size > maxBytes) {
        await fs.rename(options.logFile, `${options.logFile}.1`).catch(() => undefined);
      }
      await fs.appendFile(options.logFile, line, 'utf8');
    } catch {
      // Logging must never break the engine tick.
    }
  };

  const write = ((message: string) => {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    queue = queue.then(() => append(line));
  }) as GroupTaskEngineLogWriter;
  write.flush = () => queue;
  return write;
}

/**
 * Read the trailing bytes of the engine log (plus its rolled generation when
 * the live file is shorter than requested). Best-effort: returns '' when the
 * log does not exist or cannot be read.
 */
export async function readGroupTaskEngineLogTail(
  logFile: string,
  tailBytes = 8192,
): Promise<string> {
  const readEnd = async (filePath: string, budget: number): Promise<string> => {
    if (budget <= 0) return '';
    try {
      const stat = await fs.stat(filePath);
      const start = Math.max(0, stat.size - budget);
      const handle = await fs.open(filePath, 'r');
      try {
        const buffer = Buffer.alloc(stat.size - start);
        await handle.read(buffer, 0, buffer.length, start);
        return buffer.toString('utf8');
      } finally {
        await handle.close();
      }
    } catch {
      return '';
    }
  };
  const live = await readEnd(logFile, tailBytes);
  if (live.length >= tailBytes) return live;
  const rolled = await readEnd(`${logFile}.1`, tailBytes - live.length);
  return rolled + live;
}
