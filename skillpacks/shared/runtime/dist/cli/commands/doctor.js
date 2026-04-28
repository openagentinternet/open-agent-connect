"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDoctorCommand = runDoctorCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const homeSelection_1 = require("../../core/state/homeSelection");
const cliShimDoctor_1 = require("../../core/state/cliShimDoctor");
const version_1 = require("../version");
function hasDoctorChecks(data) {
    return Boolean(data)
        && typeof data === 'object'
        && Array.isArray(data.checks);
}
async function runDoctorCommand(_args, context) {
    const handler = context.dependencies.doctor?.run;
    if (!handler) {
        return (0, commandResult_1.commandFailed)('not_implemented', 'Doctor handler is not configured.');
    }
    const result = await handler();
    if (!result.ok || result.state !== 'success' || !hasDoctorChecks(result.data)) {
        return result;
    }
    const cliShimCheck = await (0, cliShimDoctor_1.buildCliShimDoctorCheck)((0, homeSelection_1.normalizeSystemHomeDir)(context.env, context.cwd), context.env, context.cwd);
    return {
        ...result,
        data: {
            ...result.data,
            version: version_1.CLI_VERSION,
            checks: [...result.data.checks, cliShimCheck],
        },
    };
}
