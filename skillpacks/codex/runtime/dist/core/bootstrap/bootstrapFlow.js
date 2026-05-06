"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runBootstrapFlow = runBootstrapFlow;
const createMetabot_1 = require("./createMetabot");
const requestSubsidy_1 = require("./requestSubsidy");
const syncIdentityToChain_1 = require("./syncIdentityToChain");
const DEFAULT_SYNC_RETRY_DELAY_MS = 2_500;
function emitProgress(onProgress, phase, retryable, manualActionRequired) {
    const progress = { phase, retryable, manualActionRequired };
    onProgress?.(progress);
    return progress;
}
async function runBootstrapFlow(options) {
    const wait = options.wait ?? (async () => { });
    const syncRetryDelayMs = options.syncRetryDelayMs ?? DEFAULT_SYNC_RETRY_DELAY_MS;
    try {
        const created = await (0, createMetabot_1.runCreateMetabotStep)(options.createMetabot, options.request);
        emitProgress(options.onProgress, 'identity_created', false, false);
        const subsidyContext = {
            request: options.request,
            metabot: created.metabot,
            subsidyInput: created.subsidyInput
        };
        const subsidy = await (0, requestSubsidy_1.runRequestSubsidyStep)(options.requestSubsidy, subsidyContext);
        if (!subsidy.success) {
            const failed = emitProgress(options.onProgress, 'failed', false, false);
            return {
                success: false,
                metabot: created.metabot,
                subsidy,
                error: subsidy.error,
                ...failed
            };
        }
        emitProgress(options.onProgress, 'subsidy_requested', false, false);
        const syncContext = {
            request: options.request,
            metabot: created.metabot,
            subsidy
        };
        emitProgress(options.onProgress, 'syncing', false, false);
        const chainWrites = [];
        let sync = await (0, syncIdentityToChain_1.runSyncIdentityToChainStep)(options.syncIdentityToChain, syncContext);
        chainWrites.push(...(sync.chainWrites ?? []));
        if (!sync.success) {
            await wait(syncRetryDelayMs);
            sync = await (0, syncIdentityToChain_1.runSyncIdentityToChainStep)(options.syncIdentityToChain, syncContext);
            chainWrites.push(...(sync.chainWrites ?? []));
        }
        sync = {
            ...sync,
            chainWrites,
        };
        if (sync.success) {
            const ready = emitProgress(options.onProgress, 'ready', false, false);
            return {
                success: true,
                metabot: created.metabot,
                subsidy,
                sync,
                ...ready
            };
        }
        const failed = emitProgress(options.onProgress, 'failed', true, Boolean(sync.canSkip));
        return {
            success: false,
            metabot: created.metabot,
            subsidy,
            sync,
            canSkip: sync.canSkip,
            error: sync.error,
            ...failed
        };
    }
    catch (error) {
        const failed = emitProgress(options.onProgress, 'failed', false, false);
        return {
            success: false,
            subsidy: { success: false },
            error: error instanceof Error ? error.message : String(error),
            ...failed
        };
    }
}
