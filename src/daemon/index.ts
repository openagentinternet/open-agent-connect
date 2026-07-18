import { promises as fs } from 'node:fs';
import type http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createHttpServer } from './httpServer';
import {
  resolveMetabotPaths,
  type MetabotDaemonPaths,
  type MetabotPaths,
} from '../core/state/paths';
import type { MetabotDaemonHttpHandlers } from './routes/types';

const DAEMON_LOCK_BASE_DELAY_MS = 50;
const DAEMON_LOCK_MAX_ATTEMPTS = 40;
const DAEMON_LOCK_STALE_WITHOUT_PID_MS = 5_000;

export interface MetabotDaemonAddress {
  host: string;
  port: number;
  baseUrl: string;
}

export interface MetabotDaemonInstance {
  ownerId: string;
  lockPath: string;
  start(port?: number, host?: string): Promise<MetabotDaemonAddress>;
  close(): Promise<void>;
}

export interface CreateMetabotDaemonOptions {
  homeDirOrPaths: string | MetabotPaths;
  daemonPaths?: MetabotDaemonPaths;
  handlers?: MetabotDaemonHttpHandlers;
  ownerId?: string;
}

function resolvePaths(input: string | MetabotPaths): MetabotPaths {
  return typeof input === 'string' ? resolveMetabotPaths(input) : input;
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

async function readLockInfo(filePath: string): Promise<{ ownerId?: string; pid?: number; acquiredAt?: number } | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as { ownerId?: unknown; pid?: unknown; acquiredAt?: unknown };
    return {
      ownerId: typeof parsed.ownerId === 'string' ? parsed.ownerId : undefined,
      pid: typeof parsed.pid === 'number' ? parsed.pid : undefined,
      acquiredAt: typeof parsed.acquiredAt === 'number' ? parsed.acquiredAt : undefined,
    };
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code !== 'ESRCH';
  }
}

async function quarantineStaleLock(lockPath: string): Promise<void> {
  const stalePath = `${lockPath}.stale-${Date.now()}`;
  try {
    await fs.rename(lockPath, stalePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw error;
    }
  }
}

async function recoverStaleLock(lockPath: string): Promise<boolean> {
  const stat = await fs.stat(lockPath);
  const lockInfo = await readLockInfo(lockPath);
  const lockPid = typeof lockInfo?.pid === 'number' ? lockInfo.pid : null;
  const acquiredAt = typeof lockInfo?.acquiredAt === 'number' ? lockInfo.acquiredAt : stat.mtimeMs;

  if (lockPid && !isProcessAlive(lockPid)) {
    await quarantineStaleLock(lockPath);
    return true;
  }

  if (!lockPid && Date.now() - acquiredAt > DAEMON_LOCK_STALE_WITHOUT_PID_MS) {
    await quarantineStaleLock(lockPath);
    return true;
  }

  return false;
}

async function closeServer(server: http.Server | null): Promise<void> {
  if (!server) return;
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
    if (typeof server.closeIdleConnections === 'function') {
      server.closeIdleConnections();
    }
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
  });
}

export function createMetabotDaemon(options: CreateMetabotDaemonOptions): MetabotDaemonInstance {
  const paths = resolvePaths(options.homeDirOrPaths);
  const ownerId = options.ownerId?.trim() || `metabot-daemon-${randomUUID()}`;
  const daemonPaths = options.daemonPaths;
  const locksRoot = daemonPaths?.locksRoot ?? paths.locksRoot;
  const lockPath = daemonPaths?.daemonLockPath ?? paths.daemonLockPath;
  const handlers = options.handlers ?? {};

  let server: http.Server | null = null;
  let startedAddress: MetabotDaemonAddress | null = null;
  let lockHeld = false;

  async function acquireLock(): Promise<void> {
    await fs.mkdir(locksRoot, { recursive: true });
    for (let attempt = 0; attempt < DAEMON_LOCK_MAX_ATTEMPTS; attempt += 1) {
      try {
        await fs.writeFile(lockPath, `${JSON.stringify({
          ownerId,
          pid: process.pid,
          acquiredAt: Date.now(),
        }, null, 2)}\n`, {
          encoding: 'utf8',
          flag: 'wx',
        });
        lockHeld = true;
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST') {
          throw error;
        }
        try {
          if (await recoverStaleLock(lockPath)) {
            continue;
          }
        } catch (recoverError) {
          const recoverCode = (recoverError as NodeJS.ErrnoException).code;
          if (recoverCode !== 'ENOENT') {
            throw recoverError;
          }
        }
        await sleep(Math.min(DAEMON_LOCK_BASE_DELAY_MS * (attempt + 1), 250));
      }
    }

    throw new Error(`Timed out acquiring daemon lock: ${lockPath}`);
  }

  async function releaseLock(): Promise<void> {
    if (!lockHeld) return;
    lockHeld = false;
    try {
      const lockInfo = await readLockInfo(lockPath);
      if (lockInfo?.ownerId === ownerId && lockInfo.pid === process.pid) {
        await fs.rm(lockPath);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        throw error;
      }
    }
  }

  return {
    ownerId,
    lockPath,
    async start(port = 0, host = '127.0.0.1') {
      if (startedAddress) {
        return startedAddress;
      }

      await acquireLock();

      try {
        server = createHttpServer(handlers);
        await new Promise<void>((resolve, reject) => {
          const handleError = (error: Error) => {
            server?.off('listening', handleListening);
            reject(error);
          };
          const handleListening = () => {
            server?.off('error', handleError);
            resolve();
          };
          server!.once('error', handleError);
          server!.once('listening', handleListening);
          server!.listen(port, host);
        });

        const address = server.address();
        if (!address || typeof address === 'string') {
          throw new Error('Expected daemon server to bind a TCP address.');
        }

        startedAddress = {
          host,
          port: address.port,
          baseUrl: `http://${host}:${address.port}`,
        };
        return startedAddress;
      } catch (error) {
        await closeServer(server);
        server = null;
        startedAddress = null;
        await releaseLock();
        throw error;
      }
    },
    async close() {
      await closeServer(server);
      server = null;
      startedAddress = null;
      await releaseLock();
    },
  };
}
