"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultSurfSettings = exports.normalizeSurfBudgetValue = exports.MAX_SURF_INTERACTION_BUDGET = exports.DEFAULT_SURF_INTERACTION_BUDGET = void 0;
exports.createSurfSettingsStore = createSurfSettingsStore;
/**
 * Per-bot MetaWeb surf settings, ported from IDBots surfSettings.ts onto the
 * file layout: `.runtime/surf/settings.json` (storage layout v2 amendment
 * 2026-09-15). Read helpers centralize the defaults so a bot that never
 * touched the settings gets the product defaults (surf-before-dream OFF —
 * opt-in, interaction budget 20).
 */
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
exports.DEFAULT_SURF_INTERACTION_BUDGET = 20;
exports.MAX_SURF_INTERACTION_BUDGET = 100;
const SETTINGS_FILE_VERSION = 1;
const normalizeSurfBudgetValue = (value) => {
    const num = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof num !== 'number' || !Number.isFinite(num))
        return null;
    const int = Math.round(num);
    if (int < 0 || int > exports.MAX_SURF_INTERACTION_BUDGET)
        return null;
    return int;
};
exports.normalizeSurfBudgetValue = normalizeSurfBudgetValue;
const defaultSurfSettings = () => ({
    surfBeforeDreamEnabled: false,
    interactionBudget: exports.DEFAULT_SURF_INTERACTION_BUDGET,
});
exports.defaultSurfSettings = defaultSurfSettings;
async function readSettingsFile(filePath) {
    try {
        const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
        const value = JSON.parse(raw);
        if (!value || typeof value !== 'object' || Array.isArray(value))
            return null;
        const record = value;
        const budget = (0, exports.normalizeSurfBudgetValue)(record.interactionBudget);
        return {
            version: SETTINGS_FILE_VERSION,
            surfBeforeDreamEnabled: record.surfBeforeDreamEnabled === true,
            interactionBudget: budget === null ? exports.DEFAULT_SURF_INTERACTION_BUDGET : budget,
        };
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return null;
        if (error instanceof SyntaxError)
            return null;
        throw error;
    }
}
async function writeSettingsAtomic(filePath, file) {
    await node_fs_1.promises.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
        await node_fs_1.promises.writeFile(tempPath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
        await node_fs_1.promises.rename(tempPath, filePath);
    }
    catch (error) {
        await node_fs_1.promises.rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
    }
}
/** Create the per-bot surf settings store bound to `paths.surfSettingsPath`. */
function createSurfSettingsStore(paths) {
    const filePath = paths.surfSettingsPath;
    let writeQueue = Promise.resolve();
    function enqueue(task) {
        const run = writeQueue.then(task, task);
        writeQueue = run.catch(() => undefined);
        return run;
    }
    return {
        async read() {
            const file = await readSettingsFile(filePath);
            if (!file)
                return (0, exports.defaultSurfSettings)();
            return {
                surfBeforeDreamEnabled: file.surfBeforeDreamEnabled,
                interactionBudget: file.interactionBudget,
            };
        },
        async update(patch) {
            return enqueue(async () => {
                const file = (await readSettingsFile(filePath)) ?? {
                    version: SETTINGS_FILE_VERSION,
                    surfBeforeDreamEnabled: false,
                    interactionBudget: exports.DEFAULT_SURF_INTERACTION_BUDGET,
                };
                if (patch.surfBeforeDreamEnabled !== undefined) {
                    file.surfBeforeDreamEnabled = patch.surfBeforeDreamEnabled === true;
                }
                if (patch.interactionBudget !== undefined) {
                    const budget = (0, exports.normalizeSurfBudgetValue)(patch.interactionBudget);
                    if (budget === null) {
                        throw new Error(`interactionBudget must be an integer between 0 and ${exports.MAX_SURF_INTERACTION_BUDGET}.`);
                    }
                    file.interactionBudget = budget;
                }
                await writeSettingsAtomic(filePath, file);
                return {
                    surfBeforeDreamEnabled: file.surfBeforeDreamEnabled,
                    interactionBudget: file.interactionBudget,
                };
            });
        },
    };
}
