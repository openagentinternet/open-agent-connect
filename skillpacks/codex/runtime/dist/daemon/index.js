"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMetabotDaemon = createMetabotDaemon;
const node_fs_1 = require("node:fs");
const node_crypto_1 = require("node:crypto");
const httpServer_1 = require("./httpServer");
const paths_1 = require("../core/state/paths");
const DAEMON_LOCK_BASE_DELAY_MS = 50;
const DAEMON_LOCK_MAX_ATTEMPTS = 40;
const DAEMON_LOCK_STALE_WITHOUT_PID_MS = 5_000;
function resolvePaths(input) {
    return typeof input === 'string' ? (0, paths_1.resolveMetabotPaths)(input) : input;
}
async function sleep(ms) {
    await new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}
async function readLockInfo(filePath) {
    try {
        const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        return {
            ownerId: typeof parsed.ownerId === 'string' ? parsed.ownerId : undefined,
            pid: typeof parsed.pid === 'number' ? parsed.pid : undefined,
            acquiredAt: typeof parsed.acquiredAt === 'number' ? parsed.acquiredAt : undefined,
        };
    }
    catch {
        return null;
    }
}
function isProcessAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) {
        return false;
    }
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        const code = error.code;
        return code !== 'ESRCH';
    }
}
async function quarantineStaleLock(lockPath) {
    const stalePath = `${lockPath}.stale-${Date.now()}`;
    try {
        await node_fs_1.promises.rename(lockPath, stalePath);
    }
    catch (error) {
        const code = error.code;
        if (code !== 'ENOENT') {
            throw error;
        }
    }
}
async function recoverStaleLock(lockPath) {
    const stat = await node_fs_1.promises.stat(lockPath);
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
async function closeServer(server) {
    if (!server)
        return;
    if (!server.listening) {
        return;
    }
    await new Promise((resolve, reject) => {
        server.close((error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}
function createMetabotDaemon(options) {
    const paths = resolvePaths(options.homeDirOrPaths);
    const ownerId = options.ownerId?.trim() || `metabot-daemon-${(0, node_crypto_1.randomUUID)()}`;
    const lockPath = paths.daemonLockPath;
    const handlers = options.handlers ?? {};
    let server = null;
    let startedAddress = null;
    let lockHeld = false;
    async function acquireLock() {
        await node_fs_1.promises.mkdir(paths.locksRoot, { recursive: true });
        for (let attempt = 0; attempt < DAEMON_LOCK_MAX_ATTEMPTS; attempt += 1) {
            try {
                await node_fs_1.promises.writeFile(lockPath, `${JSON.stringify({
                    ownerId,
                    pid: process.pid,
                    acquiredAt: Date.now(),
                }, null, 2)}\n`, {
                    encoding: 'utf8',
                    flag: 'wx',
                });
                lockHeld = true;
                return;
            }
            catch (error) {
                const code = error.code;
                if (code !== 'EEXIST') {
                    throw error;
                }
                try {
                    if (await recoverStaleLock(lockPath)) {
                        continue;
                    }
                }
                catch (recoverError) {
                    const recoverCode = recoverError.code;
                    if (recoverCode !== 'ENOENT') {
                        throw recoverError;
                    }
                }
                await sleep(Math.min(DAEMON_LOCK_BASE_DELAY_MS * (attempt + 1), 250));
            }
        }
        throw new Error(`Timed out acquiring daemon lock: ${lockPath}`);
    }
    async function releaseLock() {
        if (!lockHeld)
            return;
        lockHeld = false;
        try {
            const lockInfo = await readLockInfo(lockPath);
            if (lockInfo?.ownerId === ownerId && lockInfo.pid === process.pid) {
                await node_fs_1.promises.rm(lockPath);
            }
        }
        catch (error) {
            const code = error.code;
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
                server = (0, httpServer_1.createHttpServer)(handlers);
                await new Promise((resolve, reject) => {
                    const handleError = (error) => {
                        server?.off('listening', handleListening);
                        reject(error);
                    };
                    const handleListening = () => {
                        server?.off('error', handleError);
                        resolve();
                    };
                    server.once('error', handleError);
                    server.once('listening', handleListening);
                    server.listen(port, host);
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
            }
            catch (error) {
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
