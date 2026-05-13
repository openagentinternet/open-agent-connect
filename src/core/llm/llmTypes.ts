import {
  RUNTIME_PLATFORM_IDS,
  getPlatformBinaryMap,
  getPlatformDisplayNames,
  getPlatformSearchOrder,
  isRuntimePlatformId,
} from '../platform/platformRegistry';
import type { RuntimePlatformId } from '../platform/platformRegistry';

export type LlmProvider =
  | RuntimePlatformId
  | 'custom';
export type LlmAuthState = 'unknown' | 'authenticated' | 'unauthenticated';
export type LlmHealth = 'healthy' | 'degraded' | 'unavailable';
export type LlmBindingRole = 'primary' | 'fallback' | 'reviewer' | 'specialist';

export const SUPPORTED_LLM_PROVIDERS: LlmProvider[] = [...RUNTIME_PLATFORM_IDS];

export const HOST_BINARY_MAP: Record<string, string> = getPlatformBinaryMap();

export const PROVIDER_DISPLAY_NAMES: Record<string, string> = getPlatformDisplayNames();

export const HOST_SEARCH_ORDER: LlmProvider[] = getPlatformSearchOrder();

export interface LlmRuntime {
  id: string;
  provider: LlmProvider;
  displayName: string;
  binaryPath?: string;
  version?: string;
  logoPath?: string;
  authState: LlmAuthState;
  health: LlmHealth;
  capabilities: string[];
  lastSeenAt: string;
  baseUrl?: string;
  model?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LlmBinding {
  id: string;
  metaBotSlug: string;
  llmRuntimeId: string;
  role: LlmBindingRole;
  priority: number;
  enabled: boolean;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LlmRuntimesState {
  version: number;
  runtimes: LlmRuntime[];
}

export interface LlmBindingsState {
  version: number;
  bindings: LlmBinding[];
}

// ---- normalizers ----

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeNonNegativeInteger(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value);
  }
  return 0;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((e) => normalizeText(e)).filter(Boolean)
    : [];
}

function normalizeIsoString(value: unknown, fallback: string): string {
  const s = normalizeText(value);
  return s || fallback;
}

function normalizeOptionalString(value: unknown): string | undefined {
  const s = normalizeText(value);
  return s || undefined;
}

// ---- type guards ----

export function isLlmProvider(value: unknown): value is LlmProvider {
  return isRuntimePlatformId(value) || value === 'custom';
}

function isLlmAuthState(value: unknown): value is LlmAuthState {
  return typeof value === 'string' && ['unknown', 'authenticated', 'unauthenticated'].includes(value);
}

function isLlmHealth(value: unknown): value is LlmHealth {
  return typeof value === 'string' && ['healthy', 'degraded', 'unavailable'].includes(value);
}

export function isLlmBindingRole(value: unknown): value is LlmBindingRole {
  return typeof value === 'string' && ['primary', 'fallback', 'reviewer', 'specialist'].includes(value);
}

// ---- schema normalizers ----

export function normalizeLlmRuntime(value: unknown): LlmRuntime | null {
  const r = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  if (!r) return null;

  const id = normalizeText(r.id);
  const provider = normalizeText(r.provider);
  if (!id || !isLlmProvider(provider)) return null;

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

export function normalizeLlmBinding(value: unknown): LlmBinding | null {
  const b = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  if (!b) return null;

  const id = normalizeText(b.id);
  const metaBotSlug = normalizeText(b.metaBotSlug);
  const llmRuntimeId = normalizeText(b.llmRuntimeId);
  const role = normalizeText(b.role);
  if (!id || !metaBotSlug || !llmRuntimeId || !isLlmBindingRole(role)) return null;

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

export function normalizeLlmRuntimesState(value: unknown): LlmRuntimesState {
  const obj = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  const version = typeof obj.version === 'number' && Number.isFinite(obj.version) && obj.version >= 1
    ? Math.trunc(obj.version)
    : 1;

  const rawRuntimes = Array.isArray(obj.runtimes) ? obj.runtimes : [];
  const runtimes = rawRuntimes
    .map((r) => normalizeLlmRuntime(r))
    .filter((r): r is LlmRuntime => r !== null);

  return { version, runtimes };
}

export function normalizeLlmBindingsState(value: unknown): LlmBindingsState {
  const obj = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  const version = typeof obj.version === 'number' && Number.isFinite(obj.version) && obj.version >= 1
    ? Math.trunc(obj.version)
    : 1;

  const rawBindings = Array.isArray(obj.bindings) ? obj.bindings : [];
  const bindings = rawBindings
    .map((b) => normalizeLlmBinding(b))
    .filter((b): b is LlmBinding => b !== null);

  return { version, bindings };
}
