"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_METABOT_GOAL = exports.DEFAULT_METABOT_SOUL = exports.DEFAULT_METABOT_ROLE = void 0;
exports.normalizeMetabotPersonaFields = normalizeMetabotPersonaFields;
exports.isLegacyDefaultMetabotPersona = isLegacyDefaultMetabotPersona;
exports.normalizePublicMetabotPersona = normalizePublicMetabotPersona;
exports.withRuntimeMetabotPersonaFallback = withRuntimeMetabotPersonaFallback;
exports.DEFAULT_METABOT_ROLE = 'You are a helpful AI assistant.';
exports.DEFAULT_METABOT_SOUL = 'You are friendly and professional.';
exports.DEFAULT_METABOT_GOAL = 'Your goal is to help users accomplish their tasks effectively.';
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeMetabotPersonaFields(input) {
    return {
        role: normalizeText(input.role),
        soul: normalizeText(input.soul),
        goal: normalizeText(input.goal),
    };
}
function isLegacyDefaultMetabotPersona(input) {
    const persona = normalizeMetabotPersonaFields(input);
    return persona.role === exports.DEFAULT_METABOT_ROLE
        && persona.soul === exports.DEFAULT_METABOT_SOUL
        && persona.goal === exports.DEFAULT_METABOT_GOAL;
}
function normalizePublicMetabotPersona(input) {
    if (isLegacyDefaultMetabotPersona(input)) {
        return {
            role: '',
            soul: '',
            goal: '',
        };
    }
    return normalizeMetabotPersonaFields(input);
}
function withRuntimeMetabotPersonaFallback(input) {
    const persona = normalizePublicMetabotPersona(input);
    return {
        role: persona.role || exports.DEFAULT_METABOT_ROLE,
        soul: persona.soul || exports.DEFAULT_METABOT_SOUL,
        goal: persona.goal || exports.DEFAULT_METABOT_GOAL,
    };
}
