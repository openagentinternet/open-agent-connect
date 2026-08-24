"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGroupTaskHealth = getGroupTaskHealth;
/**
 * Group task health report — the read-only preflight the DSH banner and the
 * `metabot grouptask health` verb surface. The live-diagnosis round showed
 * the real failures are silent prerequisites: invites arriving while no
 * engine is alive expire without a trace, owner identity or twin absence
 * blocks creation, and a disabled simplemsg listener silently kills OpenTeam
 * intake. This module turns those into one inspectable snapshot; the engine
 * log tail carries whatever actually failed lately.
 */
const service_1 = require("./service");
const engineLog_1 = require("./engineLog");
const RECENT_ENGINE_LOG_LINES = 15;
async function getGroupTaskHealth(ctx, input = {}) {
    let chair;
    try {
        const resolved = await (0, service_1.resolveChairProfile)(ctx);
        chair = { resolvable: true, slug: resolved.slug, globalMetaId: resolved.globalMetaId };
    }
    catch (error) {
        chair = {
            resolvable: false,
            reason: error instanceof Error ? error.message : String(error),
        };
    }
    const owner = await ctx.ownerIdentity().catch(() => null);
    const ownerIdentity = owner
        ? { present: true, globalMetaId: owner.globalMetaId, name: owner.name }
        : { present: false };
    const simplemsgListenerEnabled = await input.readSimplemsgListenerEnabled?.().catch(() => true) ?? true;
    let tasks = { active: 0, total: 0 };
    try {
        const summaries = await (0, service_1.listGroupTaskSummaries)(ctx, { tab: 'all', includeArchived: false });
        tasks = {
            total: summaries.length,
            active: summaries.filter((task) => task.status !== 'done' && task.status !== 'cancelled').length,
        };
    }
    catch {
        // Profile listing failures must not take down the rest of the report.
    }
    const logFile = input.engineLogFile ?? null;
    let recentLines = [];
    if (logFile) {
        const tail = await (input.readEngineLogTail ?? engineLog_1.readGroupTaskEngineLogTail)(logFile);
        recentLines = tail.split('\n').filter((line) => line.trim() !== '').slice(-RECENT_ENGINE_LOG_LINES);
    }
    return { chair, ownerIdentity, simplemsgListenerEnabled, tasks, engine: { logFile, recentLines } };
}
