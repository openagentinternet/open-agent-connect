export type ProviderServiceRunnerTerminalState =
  | 'completed'
  | 'needs_clarification'
  | 'failed';

export interface ProviderServiceRunnerRequest {
  servicePinId: string;
  providerSkill: string;
  providerGlobalMetaId: string;
  userTask: string;
  taskContext: string;
  serviceName?: string | null;
  displayName?: string | null;
  outputType?: string | null;
  rawRequest?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ProviderServiceRunnerCompletedResult {
  state: 'completed';
  responseText: string;
  metadata?: Record<string, unknown> | null;
}

export interface ProviderServiceRunnerClarificationResult {
  state: 'needs_clarification';
  question: string;
  metadata?: Record<string, unknown> | null;
}

export interface ProviderServiceRunnerFailedResult {
  state: 'failed';
  code: string;
  message: string;
  retryable?: boolean;
  metadata?: Record<string, unknown> | null;
}

export type ProviderServiceRunnerResult =
  | ProviderServiceRunnerCompletedResult
  | ProviderServiceRunnerClarificationResult
  | ProviderServiceRunnerFailedResult;

export type ProviderServiceRunner = (
  input: ProviderServiceRunnerRequest
) => ProviderServiceRunnerResult | Promise<ProviderServiceRunnerResult>;

export interface ProviderServiceRunnerRegistration {
  servicePinId?: string | null;
  providerSkill?: string | null;
  runner: ProviderServiceRunner;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function isProviderServiceRunnerResult(value: unknown): value is ProviderServiceRunnerResult {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const state = normalizeText((value as { state?: unknown }).state);
  if (state === 'completed') {
    return typeof (value as { responseText?: unknown }).responseText === 'string';
  }
  if (state === 'needs_clarification') {
    return typeof (value as { question?: unknown }).question === 'string';
  }
  if (state === 'failed') {
    return typeof (value as { code?: unknown }).code === 'string'
      && typeof (value as { message?: unknown }).message === 'string';
  }
  return false;
}

export function createServiceRunnerFailedResult(
  code: string,
  message: string,
  retryable = false,
): ProviderServiceRunnerFailedResult {
  return {
    state: 'failed',
    code: normalizeText(code) || 'service_runner_failed',
    message: normalizeText(message) || 'Provider service runner failed.',
    retryable,
  };
}
