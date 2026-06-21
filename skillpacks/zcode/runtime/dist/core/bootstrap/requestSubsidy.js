"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runRequestSubsidyStep = runRequestSubsidyStep;
async function runRequestSubsidyStep(step, context) {
    return step(context);
}
