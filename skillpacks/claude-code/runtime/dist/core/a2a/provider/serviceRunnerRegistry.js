"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createServiceRunnerRegistry = createServiceRunnerRegistry;
const serviceRunnerContracts_1 = require("./serviceRunnerContracts");
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function createNotFoundResult(input) {
    const servicePinId = normalizeText(input.servicePinId);
    const providerSkill = normalizeText(input.providerSkill);
    const identifier = [servicePinId, providerSkill].filter(Boolean).join(' / ') || 'unknown service';
    return (0, serviceRunnerContracts_1.createServiceRunnerFailedResult)('service_runner_not_found', `No provider service runner was registered for ${identifier}.`);
}
function createServiceRunnerRegistry(initialRegistrations = []) {
    const servicePinIndex = new Map();
    const providerSkillIndex = new Map();
    const register = (registration) => {
        const normalized = {
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
    const resolve = (input) => {
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
    const execute = async (input) => {
        const resolution = resolve({
            servicePinId: input.servicePinId,
            providerSkill: input.providerSkill,
        });
        if (!resolution.ok) {
            return createNotFoundResult(input);
        }
        try {
            const result = await resolution.registration.runner(input);
            if (!(0, serviceRunnerContracts_1.isProviderServiceRunnerResult)(result)) {
                return (0, serviceRunnerContracts_1.createServiceRunnerFailedResult)('invalid_service_runner_result', 'Provider service runner returned an invalid result state.');
            }
            return result;
        }
        catch (error) {
            return (0, serviceRunnerContracts_1.createServiceRunnerFailedResult)('service_runner_exception', error instanceof Error ? error.message : String(error));
        }
    };
    return {
        register,
        resolve,
        execute,
    };
}
