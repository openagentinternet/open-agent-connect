"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.clampMemoryUserMemoriesMaxItems = clampMemoryUserMemoriesMaxItems;
exports.normalizeMemoryGuardLevel = normalizeMemoryGuardLevel;
exports.createMemoryPolicyStore = createMemoryPolicyStore;
// Per-profile memory policy store (`.runtime/memory/policy.json`) and
// effective-policy resolution. Defaults mirror IDBots
// (coworkStore.ts:80-86); the per-profile file overrides them wholesale per
// field. A missing file means "all defaults".
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const memoryHygienePolicy_1 = require("./memoryHygienePolicy");
const memoryPromptBlocks_1 = require("./memoryPromptBlocks");
const DEFAULT_MEMORY_ENABLED = true;
const DEFAULT_MEMORY_IMPLICIT_UPDATE_ENABLED = true;
const DEFAULT_MEMORY_LLM_JUDGE_ENABLED = true;
const DEFAULT_MEMORY_GUARD_LEVEL = 'strict';
const DEFAULT_MEMORY_USER_MEMORIES_MAX_ITEMS = 20;
const MIN_MEMORY_USER_MEMORIES_MAX_ITEMS = 1;
const MAX_MEMORY_USER_MEMORIES_MAX_ITEMS = 60;
let atomicWriteSequence = 0;
function clampMemoryUserMemoriesMaxItems(value) {
    if (!Number.isFinite(value))
        return DEFAULT_MEMORY_USER_MEMORIES_MAX_ITEMS;
    return Math.max(MIN_MEMORY_USER_MEMORIES_MAX_ITEMS, Math.min(MAX_MEMORY_USER_MEMORIES_MAX_ITEMS, Math.floor(value)));
}
function normalizeMemoryGuardLevel(value) {
    return value === 'strict' || value === 'standard' || value === 'relaxed'
        ? value
        : DEFAULT_MEMORY_GUARD_LEVEL;
}
function normalizeBoolean(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
}
function defaultPolicy() {
    return {
        memoryEnabled: DEFAULT_MEMORY_ENABLED,
        memoryImplicitUpdateEnabled: DEFAULT_MEMORY_IMPLICIT_UPDATE_ENABLED,
        memoryLlmJudgeEnabled: DEFAULT_MEMORY_LLM_JUDGE_ENABLED,
        memoryGuardLevel: DEFAULT_MEMORY_GUARD_LEVEL,
        memoryUserMemoriesMaxItems: DEFAULT_MEMORY_USER_MEMORIES_MAX_ITEMS,
        dreamEnabled: true,
        hygieneEnabled: true,
    };
}
/** Keep only the known threshold keys when persisting the `hygiene` object. */
function normalizeHygieneObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return {};
    const record = value;
    const out = {};
    for (const key of memoryHygienePolicy_1.MEMORY_HYGIENE_THRESHOLD_KEYS) {
        if (record[key] !== undefined)
            out[key] = record[key];
    }
    return out;
}
function normalizePolicyFile(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return {};
    const record = value;
    const out = {};
    if (typeof record.memoryEnabled === 'boolean')
        out.memoryEnabled = record.memoryEnabled;
    if (typeof record.memoryImplicitUpdateEnabled === 'boolean') {
        out.memoryImplicitUpdateEnabled = record.memoryImplicitUpdateEnabled;
    }
    if (typeof record.memoryLlmJudgeEnabled === 'boolean')
        out.memoryLlmJudgeEnabled = record.memoryLlmJudgeEnabled;
    if (record.memoryGuardLevel !== undefined)
        out.memoryGuardLevel = normalizeMemoryGuardLevel(record.memoryGuardLevel);
    if (typeof record.memoryUserMemoriesMaxItems === 'number') {
        out.memoryUserMemoriesMaxItems = clampMemoryUserMemoriesMaxItems(record.memoryUserMemoriesMaxItems);
    }
    if (typeof record.memoryPromptMaxChars === 'number') {
        out.memoryPromptMaxChars = (0, memoryPromptBlocks_1.clampMemoryPromptMaxChars)(record.memoryPromptMaxChars);
    }
    if (typeof record.dreamEnabled === 'boolean')
        out.dreamEnabled = record.dreamEnabled;
    if (typeof record.hygieneEnabled === 'boolean')
        out.hygieneEnabled = record.hygieneEnabled;
    if (record.hygiene !== undefined)
        out.hygiene = normalizeHygieneObject(record.hygiene);
    if (typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)) {
        out.updatedAt = record.updatedAt;
    }
    return out;
}
function createMemoryPolicyStore(paths) {
    const filePath = paths.memoryPolicyPath;
    async function readOverride() {
        try {
            const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
            return normalizePolicyFile(JSON.parse(raw));
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return {};
            throw error;
        }
    }
    async function writeOverride(override) {
        await node_fs_1.promises.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
        atomicWriteSequence += 1;
        const tempPath = `${filePath}.${process.pid}.${Date.now()}.${atomicWriteSequence}.tmp`;
        try {
            await node_fs_1.promises.writeFile(tempPath, `${JSON.stringify(override, null, 2)}\n`, 'utf8');
            await node_fs_1.promises.rename(tempPath, filePath);
        }
        catch (error) {
            await node_fs_1.promises.rm(tempPath, { force: true }).catch(() => undefined);
            throw error;
        }
    }
    return {
        readOverride,
        async setOverride(updates) {
            const current = await readOverride();
            const next = { ...current };
            for (const [key, value] of Object.entries(updates)) {
                if (value === undefined)
                    continue;
                next[key] = value;
            }
            const normalized = normalizePolicyFile(next);
            normalized.updatedAt = Date.now();
            await writeOverride(normalized);
            const defaults = defaultPolicy();
            return {
                memoryEnabled: normalizeBoolean(normalized.memoryEnabled, defaults.memoryEnabled),
                memoryImplicitUpdateEnabled: normalizeBoolean(normalized.memoryImplicitUpdateEnabled, defaults.memoryImplicitUpdateEnabled),
                memoryLlmJudgeEnabled: normalizeBoolean(normalized.memoryLlmJudgeEnabled, defaults.memoryLlmJudgeEnabled),
                memoryGuardLevel: normalizeMemoryGuardLevel(normalized.memoryGuardLevel),
                memoryUserMemoriesMaxItems: clampMemoryUserMemoriesMaxItems(normalized.memoryUserMemoriesMaxItems ?? Number.NaN),
                dreamEnabled: normalizeBoolean(normalized.dreamEnabled, defaults.dreamEnabled),
                hygieneEnabled: normalizeBoolean(normalized.hygieneEnabled, defaults.hygieneEnabled),
                updatedAt: normalized.updatedAt,
            };
        },
        async deleteOverride() {
            try {
                await node_fs_1.promises.unlink(filePath);
                return true;
            }
            catch (error) {
                if (error.code === 'ENOENT')
                    return false;
                throw error;
            }
        },
        async effectivePolicy() {
            const override = await readOverride();
            const defaults = defaultPolicy();
            const hasOverride = Object.keys(override).some((key) => key !== 'updatedAt');
            return {
                memoryEnabled: normalizeBoolean(override.memoryEnabled, defaults.memoryEnabled),
                memoryImplicitUpdateEnabled: normalizeBoolean(override.memoryImplicitUpdateEnabled, defaults.memoryImplicitUpdateEnabled),
                memoryLlmJudgeEnabled: normalizeBoolean(override.memoryLlmJudgeEnabled, defaults.memoryLlmJudgeEnabled),
                memoryGuardLevel: normalizeMemoryGuardLevel(override.memoryGuardLevel),
                memoryUserMemoriesMaxItems: clampMemoryUserMemoriesMaxItems(override.memoryUserMemoriesMaxItems ?? Number.NaN),
                memoryPromptMaxChars: (0, memoryPromptBlocks_1.clampMemoryPromptMaxChars)(override.memoryPromptMaxChars ?? Number.NaN),
                dreamEnabled: normalizeBoolean(override.dreamEnabled, defaults.dreamEnabled),
                hygieneEnabled: normalizeBoolean(override.hygieneEnabled, defaults.hygieneEnabled),
                source: hasOverride ? 'profile' : 'default',
            };
        },
        async getHygieneConfig() {
            const override = await readOverride();
            const normalized = (0, memoryHygienePolicy_1.normalizeMemoryHygieneConfig)(override.hygiene ?? {});
            return {
                ...normalized,
                enabled: normalizeBoolean(override.hygieneEnabled, true),
            };
        },
        async setHygieneConfig(update) {
            const current = await readOverride();
            const merged = { ...(current.hygiene ?? {}), ...update };
            delete merged.enabled; // The master switch is the hygieneEnabled flag.
            const normalized = (0, memoryHygienePolicy_1.normalizeMemoryHygieneConfig)(merged);
            const nextEnabled = typeof update.enabled === 'boolean'
                ? update.enabled
                : normalizeBoolean(current.hygieneEnabled, true);
            const nextOverride = { ...current };
            nextOverride.hygiene = normalizeHygieneObject(normalized);
            nextOverride.hygieneEnabled = nextEnabled;
            nextOverride.updatedAt = Date.now();
            await writeOverride(normalizePolicyFile(nextOverride));
            return { ...normalized, enabled: nextEnabled };
        },
    };
}
