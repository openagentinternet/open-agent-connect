"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCreateMetabotStep = runCreateMetabotStep;
async function runCreateMetabotStep(step, request) {
    return step(request);
}
