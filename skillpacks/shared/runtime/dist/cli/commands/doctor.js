"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDoctorCommand = runDoctorCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
async function runDoctorCommand(_args, context) {
    const handler = context.dependencies.doctor?.run;
    if (!handler) {
        return (0, commandResult_1.commandFailed)('not_implemented', 'Doctor handler is not configured.');
    }
    return handler();
}
