"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMetabotDaemon = createMetabotDaemon;
const node_fs_1 = require("node:fs");
const node_crypto_1 = require("node:crypto");
const httpServer_1 = require("./httpServer");
const paths_1 = require("../core/state/paths");
function resolvePaths(input) {
    return typeof input === 'string' ? (0, paths_1.resolveMetabotPaths)(input) : input;
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
        await node_fs_1.promises.writeFile(lockPath, `${JSON.stringify({ ownerId, acquiredAt: Date.now() }, null, 2)}\n`, {
            encoding: 'utf8',
            flag: 'wx',
        });
        lockHeld = true;
    }
    async function releaseLock() {
        if (!lockHeld)
            return;
        lockHeld = false;
        try {
            await node_fs_1.promises.rm(lockPath);
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
