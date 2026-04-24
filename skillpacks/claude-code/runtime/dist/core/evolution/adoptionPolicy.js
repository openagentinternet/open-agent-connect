"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateSkillAdoption = evaluateSkillAdoption;
function normalizeAllowedCommands(commands) {
    return [...new Set(commands)].sort();
}
function scopesEquivalent(left, right) {
    const leftCommands = normalizeAllowedCommands(left.allowedCommands);
    const rightCommands = normalizeAllowedCommands(right.allowedCommands);
    if (leftCommands.length !== rightCommands.length) {
        return false;
    }
    for (let index = 0; index < leftCommands.length; index += 1) {
        if (leftCommands[index] !== rightCommands[index]) {
            return false;
        }
    }
    return left.chainRead === right.chainRead
        && left.chainWrite === right.chainWrite
        && left.localUiOpen === right.localUiOpen
        && left.remoteDelegation === right.remoteDelegation;
}
function evaluateSkillAdoption(input) {
    if (input.candidate.skillName !== input.activeSkillName) {
        return {
            autoAdopt: false,
            status: 'inactive',
            adoption: 'manual',
        };
    }
    if (!scopesEquivalent(input.activeScope, input.candidate.scope)) {
        return {
            autoAdopt: false,
            status: 'inactive',
            adoption: 'manual',
        };
    }
    return {
        autoAdopt: true,
        status: 'active',
        adoption: 'active',
    };
}
