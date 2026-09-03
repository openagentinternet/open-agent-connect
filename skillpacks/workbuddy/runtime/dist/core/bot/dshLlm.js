"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DSH_LLM_REASONING_EFFORTS = void 0;
exports.normalizeOptionalDshLlmId = normalizeOptionalDshLlmId;
exports.normalizeOptionalDshLlmReasoningEffort = normalizeOptionalDshLlmReasoningEffort;
exports.normalizeDshLlmBinding = normalizeDshLlmBinding;
exports.readDshLlmBinding = readDshLlmBinding;
exports.writeDshLlmBinding = writeDshLlmBinding;
exports.mergeDshLlmBinding = mergeDshLlmBinding;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
/** Reasoning efforts the DSH adapters own (llm-deepseek ships off/low/high/max). */
exports.DSH_LLM_REASONING_EFFORTS = ['off', 'low', 'high', 'max'];
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeOptionalDshLlmId(value) {
    if (value === null)
        return null;
    const normalized = normalizeText(value);
    return normalized || null;
}
/**
 * Normalize an optional reasoning effort: null/blank clears it (the provider
 * default applies), and anything outside the adapter vocabulary is rejected.
 */
function normalizeOptionalDshLlmReasoningEffort(value) {
    if (value === null || value === undefined)
        return null;
    const normalized = normalizeText(value);
    if (!normalized)
        return null;
    if (!exports.DSH_LLM_REASONING_EFFORTS.includes(normalized)) {
        throw new Error(`dshLlm reasoning effort must be one of: ${exports.DSH_LLM_REASONING_EFFORTS.join(', ')}.`);
    }
    return normalized;
}
function normalizeDshLlmBinding(value) {
    const record = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
    return {
        dshLlmProvider: normalizeOptionalDshLlmId(record.dshLlmProvider),
        dshLlmModel: normalizeOptionalDshLlmId(record.dshLlmModel),
        dshLlmReasoningEffort: normalizeOptionalDshLlmId(record.dshLlmReasoningEffort),
        dshLlmFallbackProvider: normalizeOptionalDshLlmId(record.dshLlmFallbackProvider),
        dshLlmFallbackModel: normalizeOptionalDshLlmId(record.dshLlmFallbackModel),
        dshLlmFallbackReasoningEffort: normalizeOptionalDshLlmId(record.dshLlmFallbackReasoningEffort),
    };
}
function hasAnyDshLlmValue(binding) {
    return Boolean(binding.dshLlmProvider
        || binding.dshLlmModel
        || binding.dshLlmReasoningEffort
        || binding.dshLlmFallbackProvider
        || binding.dshLlmFallbackModel
        || binding.dshLlmFallbackReasoningEffort);
}
async function readDshLlmBinding(filePath) {
    try {
        return normalizeDshLlmBinding(JSON.parse(await node_fs_1.promises.readFile(filePath, 'utf8')));
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return {
                dshLlmProvider: null,
                dshLlmModel: null,
                dshLlmReasoningEffort: null,
                dshLlmFallbackProvider: null,
                dshLlmFallbackModel: null,
                dshLlmFallbackReasoningEffort: null,
            };
        }
        throw error;
    }
}
async function writeDshLlmBinding(filePath, binding) {
    const next = normalizeDshLlmBinding(binding);
    if (!hasAnyDshLlmValue(next)) {
        try {
            await node_fs_1.promises.unlink(filePath);
        }
        catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }
        return;
    }
    await node_fs_1.promises.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
    await node_fs_1.promises.writeFile(filePath, `${JSON.stringify({
        ...next,
        updatedAt: new Date().toISOString(),
    }, null, 2)}\n`, 'utf8');
}
function mergeDshLlmBinding(current, patch) {
    return {
        dshLlmProvider: patch.dshLlmProvider !== undefined ? patch.dshLlmProvider : (current.dshLlmProvider ?? null),
        dshLlmModel: patch.dshLlmModel !== undefined ? patch.dshLlmModel : (current.dshLlmModel ?? null),
        dshLlmReasoningEffort: patch.dshLlmReasoningEffort !== undefined
            ? patch.dshLlmReasoningEffort
            : (current.dshLlmReasoningEffort ?? null),
        dshLlmFallbackProvider: patch.dshLlmFallbackProvider !== undefined
            ? patch.dshLlmFallbackProvider
            : (current.dshLlmFallbackProvider ?? null),
        dshLlmFallbackModel: patch.dshLlmFallbackModel !== undefined
            ? patch.dshLlmFallbackModel
            : (current.dshLlmFallbackModel ?? null),
        dshLlmFallbackReasoningEffort: patch.dshLlmFallbackReasoningEffort !== undefined
            ? patch.dshLlmFallbackReasoningEffort
            : (current.dshLlmFallbackReasoningEffort ?? null),
    };
}
