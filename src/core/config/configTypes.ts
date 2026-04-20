export interface EvolutionNetworkConfig {
  enabled: boolean;
  autoAdoptSameSkillSameScope: boolean;
  autoRecordExecutions: boolean;
}

export type AskMasterTriggerMode = 'manual' | 'suggest' | 'auto';
export type AskMasterConfirmationMode = 'always' | 'sensitive_only' | 'never';
export type AskMasterContextMode = 'compact' | 'standard' | 'full_task';

export const ASK_MASTER_TRIGGER_MODES: AskMasterTriggerMode[] = ['manual', 'suggest', 'auto'];
export const ASK_MASTER_CONFIRMATION_MODES: AskMasterConfirmationMode[] = ['always', 'sensitive_only', 'never'];
export const ASK_MASTER_CONTEXT_MODES: AskMasterContextMode[] = ['compact', 'standard', 'full_task'];

export interface AskMasterAutoPolicyConfig {
  minConfidence: number;
  minNoProgressWindowMs: number;
  perTraceLimit: number;
  globalCooldownMs: number;
  allowTrustedAutoSend: boolean;
}

export interface AskMasterConfig {
  enabled: boolean;
  triggerMode: AskMasterTriggerMode;
  confirmationMode: AskMasterConfirmationMode;
  contextMode: AskMasterContextMode;
  trustedMasters: string[];
  autoPolicy: AskMasterAutoPolicyConfig;
}

export interface MetabotConfig {
  evolution_network: EvolutionNetworkConfig;
  askMaster: AskMasterConfig;
}

export function isAskMasterTriggerMode(value: unknown): value is AskMasterTriggerMode {
  return typeof value === 'string' && ASK_MASTER_TRIGGER_MODES.includes(value as AskMasterTriggerMode);
}

export function isAskMasterConfirmationMode(value: unknown): value is AskMasterConfirmationMode {
  return typeof value === 'string' && ASK_MASTER_CONFIRMATION_MODES.includes(value as AskMasterConfirmationMode);
}

export function isAskMasterContextMode(value: unknown): value is AskMasterContextMode {
  return typeof value === 'string' && ASK_MASTER_CONTEXT_MODES.includes(value as AskMasterContextMode);
}

function normalizeFiniteNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
  const normalized = normalizeFiniteNumber(value, fallback);
  return Math.max(0, Math.trunc(normalized));
}

export function createDefaultAskMasterAutoPolicyConfig(): AskMasterAutoPolicyConfig {
  return {
    minConfidence: 0.9,
    minNoProgressWindowMs: 300_000,
    perTraceLimit: 1,
    globalCooldownMs: 1_800_000,
    allowTrustedAutoSend: false,
  };
}

export function normalizeAskMasterAutoPolicyConfig(value: unknown): AskMasterAutoPolicyConfig {
  const defaults = createDefaultAskMasterAutoPolicyConfig();
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    minConfidence: Math.max(0, Math.min(0.99, normalizeFiniteNumber(source.minConfidence, defaults.minConfidence))),
    minNoProgressWindowMs: normalizeNonNegativeInteger(
      source.minNoProgressWindowMs,
      defaults.minNoProgressWindowMs
    ),
    perTraceLimit: Math.max(1, normalizeNonNegativeInteger(source.perTraceLimit, defaults.perTraceLimit)),
    globalCooldownMs: normalizeNonNegativeInteger(source.globalCooldownMs, defaults.globalCooldownMs),
    allowTrustedAutoSend: typeof source.allowTrustedAutoSend === 'boolean'
      ? source.allowTrustedAutoSend
      : defaults.allowTrustedAutoSend,
  };
}

export function createDefaultConfig(): MetabotConfig {
  return {
    evolution_network: {
      enabled: true,
      autoAdoptSameSkillSameScope: false,
      autoRecordExecutions: true
    },
    askMaster: {
      enabled: true,
      triggerMode: 'manual',
      confirmationMode: 'always',
      contextMode: 'standard',
      trustedMasters: [],
      autoPolicy: createDefaultAskMasterAutoPolicyConfig(),
    },
  };
}
