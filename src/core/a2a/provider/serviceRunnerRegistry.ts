import {
  createServiceRunnerFailedResult,
  isProviderServiceRunnerResult,
  type ProviderServiceRunnerRegistration,
  type ProviderServiceRunnerRequest,
  type ProviderServiceRunnerResult,
} from './serviceRunnerContracts';

export interface ServiceRunnerResolutionInput {
  servicePinId?: string | null;
  providerSkill?: string | null;
}

export type ServiceRunnerResolution =
  | {
      ok: true;
      matchBy: 'servicePinId' | 'providerSkill';
      registration: ProviderServiceRunnerRegistration;
    }
  | ({
      ok: false;
      matchBy: null;
    } & ReturnType<typeof createServiceRunnerFailedResult>);

export interface ServiceRunnerRegistry {
  register(registration: ProviderServiceRunnerRegistration): void;
  resolve(input: ServiceRunnerResolutionInput): ServiceRunnerResolution;
  execute(input: ProviderServiceRunnerRequest): Promise<ProviderServiceRunnerResult>;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function createNotFoundResult(input: ServiceRunnerResolutionInput) {
  const servicePinId = normalizeText(input.servicePinId);
  const providerSkill = normalizeText(input.providerSkill);
  const identifier = [servicePinId, providerSkill].filter(Boolean).join(' / ') || 'unknown service';
  return createServiceRunnerFailedResult(
    'service_runner_not_found',
    `No provider service runner was registered for ${identifier}.`,
  );
}

export function createServiceRunnerRegistry(
  initialRegistrations: ProviderServiceRunnerRegistration[] = [],
): ServiceRunnerRegistry {
  const servicePinIndex = new Map<string, ProviderServiceRunnerRegistration>();
  const providerSkillIndex = new Map<string, ProviderServiceRunnerRegistration>();

  const register = (registration: ProviderServiceRunnerRegistration): void => {
    const normalized: ProviderServiceRunnerRegistration = {
      servicePinId: normalizeText(registration.servicePinId) || null,
      providerSkill: normalizeText(registration.providerSkill) || null,
      runner: registration.runner,
    };

    if (typeof normalized.runner !== 'function') {
      throw new Error('Provider service runner registration requires a runner function.');
    }
    if (!normalized.servicePinId && !normalized.providerSkill) {
      throw new Error('Provider service runner registration requires a servicePinId or providerSkill.');
    }
    if (normalized.servicePinId) {
      if (servicePinIndex.has(normalized.servicePinId)) {
        throw new Error(`Provider service runner already registered for service pin: ${normalized.servicePinId}`);
      }
      servicePinIndex.set(normalized.servicePinId, normalized);
    }
    if (normalized.providerSkill) {
      if (providerSkillIndex.has(normalized.providerSkill)) {
        throw new Error(`Provider service runner already registered for provider skill: ${normalized.providerSkill}`);
      }
      providerSkillIndex.set(normalized.providerSkill, normalized);
    }
  };

  for (const registration of initialRegistrations) {
    register(registration);
  }

  const resolve = (input: ServiceRunnerResolutionInput): ServiceRunnerResolution => {
    const servicePinId = normalizeText(input.servicePinId);
    if (servicePinId) {
      const registration = servicePinIndex.get(servicePinId);
      if (registration) {
        return {
          ok: true,
          matchBy: 'servicePinId',
          registration,
        };
      }
    }

    const providerSkill = normalizeText(input.providerSkill);
    if (providerSkill) {
      const registration = providerSkillIndex.get(providerSkill);
      if (registration) {
        return {
          ok: true,
          matchBy: 'providerSkill',
          registration,
        };
      }
    }

    return {
      ok: false,
      matchBy: null,
      ...createNotFoundResult(input),
    };
  };

  const execute = async (input: ProviderServiceRunnerRequest): Promise<ProviderServiceRunnerResult> => {
    const resolution = resolve({
      servicePinId: input.servicePinId,
      providerSkill: input.providerSkill,
    });
    if (!resolution.ok) {
      return createNotFoundResult(input);
    }

    try {
      const result = await resolution.registration.runner(input);
      if (!isProviderServiceRunnerResult(result)) {
        return createServiceRunnerFailedResult(
          'invalid_service_runner_result',
          'Provider service runner returned an invalid result state.',
        );
      }
      return result;
    } catch (error) {
      return createServiceRunnerFailedResult(
        'service_runner_exception',
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  return {
    register,
    resolve,
    execute,
  };
}
