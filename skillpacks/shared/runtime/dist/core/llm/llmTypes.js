"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HOST_SEARCH_ORDER = exports.PROVIDER_DISPLAY_NAMES = exports.HOST_BINARY_MAP = exports.SUPPORTED_LLM_PROVIDERS = void 0;
exports.isLlmProvider = isLlmProvider;
exports.isLlmBindingRole = isLlmBindingRole;
exports.normalizeLlmRuntime = normalizeLlmRuntime;
exports.normalizeLlmBinding = normalizeLlmBinding;
exports.normalizeLlmRuntimesState = normalizeLlmRuntimesState;
exports.normalizeLlmBindingsState = normalizeLlmBindingsState;
const platformRegistry_1 = require("../platform/platformRegistry");
exports.SUPPORTED_LLM_PROVIDERS = [...platformRegistry_1.RUNTIME_PLATFORM_IDS];
exports.HOST_BINARY_MAP = (0, platformRegistry_1.getPlatformBinaryMap)();
exports.PROVIDER_DISPLAY_NAMES = (0, platformRegistry_1.getPlatformDisplayNames)();
exports.HOST_SEARCH_ORDER = (0, platformRegistry_1.getPlatformSearchOrder)();
// ---- normalizers ----
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeBoolean(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
}
function normalizeNonNegativeInteger(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        return Math.trunc(value);
    }
    return 0;
}
function normalizeStringArray(value) {
    return Array.isArray(value)
        ? value.map((e) => normalizeText(e)).filter(Boolean)
        : [];
}
function normalizeIsoString(value, fallback) {
    const s = normalizeText(value);
    return s || fallback;
}
function normalizeOptionalString(value) {
    const s = normalizeText(value);
    return s || undefined;
}
// ---- type guards ----
function isLlmProvider(value) {
    return (0, platformRegistry_1.isRuntimePlatformId)(value) || value === 'custom';
}
function isLlmAuthState(value) {
    return typeof value === 'string' && ['unknown', 'authenticated', 'unauthenticated'].includes(value);
}
function isLlmHealth(value) {
    return typeof value === 'string' && ['healthy', 'degraded', 'unavailable'].includes(value);
}
function isLlmBindingRole(value) {
    return typeof value === 'string' && ['primary', 'fallback', 'reviewer', 'specialist'].includes(value);
}
// ---- schema normalizers ----
function normalizeLlmRuntime(value) {
    const r = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
    if (!r)
        return null;
    const id = normalizeText(r.id);
    const provider = normalizeText(r.provider);
    if (!id || !isLlmProvider(provider))
        return null;
    const now = new Date().toISOString();
    return {
        id,
        provider,
        displayName: normalizeText(r.displayName) || provider,
        binaryPath: normalizeOptionalString(r.binaryPath),
        version: normalizeOptionalString(r.version),
        logoPath: normalizeOptionalString(r.logoPath),
        authState: isLlmAuthState(r.authState) ? r.authState : 'unknown',
        health: isLlmHealth(r.health) ? r.health : 'healthy',
        capabilities: normalizeStringArray(r.capabilities),
        lastSeenAt: normalizeIsoString(r.lastSeenAt, now),
        baseUrl: normalizeOptionalString(r.baseUrl),
        model: normalizeOptionalString(r.model),
        createdAt: normalizeIsoString(r.createdAt, now),
        updatedAt: normalizeIsoString(r.updatedAt, now),
    };
}
function normalizeLlmBinding(value) {
    const b = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
    if (!b)
        return null;
    const id = normalizeText(b.id);
    const metaBotSlug = normalizeText(b.metaBotSlug);
    const llmRuntimeId = normalizeText(b.llmRuntimeId);
    const role = normalizeText(b.role);
    if (!id || !metaBotSlug || !llmRuntimeId || !isLlmBindingRole(role))
        return null;
    const now = new Date().toISOString();
    return {
        id,
        metaBotSlug,
        llmRuntimeId,
        role,
        priority: normalizeNonNegativeInteger(b.priority),
        enabled: normalizeBoolean(b.enabled, true),
        lastUsedAt: normalizeOptionalString(b.lastUsedAt),
        createdAt: normalizeIsoString(b.createdAt, now),
        updatedAt: normalizeIsoString(b.updatedAt, now),
    };
}
function normalizeLlmRuntimesState(value) {
    const obj = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
    const version = typeof obj.version === 'number' && Number.isFinite(obj.version) && obj.version >= 1
        ? Math.trunc(obj.version)
        : 1;
    const rawRuntimes = Array.isArray(obj.runtimes) ? obj.runtimes : [];
    const runtimes = rawRuntimes
        .map((r) => normalizeLlmRuntime(r))
        .filter((r) => r !== null);
    return { version, runtimes };
}
function normalizeLlmBindingsState(value) {
    const obj = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
    const version = typeof obj.version === 'number' && Number.isFinite(obj.version) && obj.version >= 1
        ? Math.trunc(obj.version)
        : 1;
    const rawBindings = Array.isArray(obj.bindings) ? obj.bindings : [];
    const bindings = rawBindings
        .map((b) => normalizeLlmBinding(b))
        .filter((b) => b !== null);
    return { version, bindings };
}
