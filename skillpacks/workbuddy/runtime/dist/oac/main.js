#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runOac = runOac;
const commandResult_1 = require("../core/contracts/commandResult");
const npmInstall_1 = require("../core/system/npmInstall");
const uninstall_1 = require("../core/system/uninstall");
const homeSelection_1 = require("../core/state/homeSelection");
const types_1 = require("../core/system/types");
const version_1 = require("../cli/version");
const platformRegistry_1 = require("../core/platform/platformRegistry");
function resolveContext(context = {}) {
    return {
        stdout: context.stdout ?? process.stdout,
        stderr: context.stderr ?? process.stderr,
        env: context.env ?? process.env,
        cwd: context.cwd ?? process.cwd(),
    };
}
function resolveExitCode(result) {
    if (result.ok)
        return 0;
    if (result.state === 'waiting' || result.state === 'manual_action_required')
        return 2;
    return 1;
}
function writeJsonLine(context, payload) {
    context.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}
function readFlagValue(args, flag) {
    const index = args.indexOf(flag);
    if (index < 0) {
        return undefined;
    }
    const value = args[index + 1];
    return value && !value.startsWith('-') ? value : undefined;
}
function hasFlag(args, flag) {
    return args.includes(flag);
}
function versionRequested(args) {
    return args.includes('--version') || args.includes('-v');
}
function helpRequested(args) {
    return args.includes('--help') || args.includes('-h');
}
function renderHelp() {
    const hostList = platformRegistry_1.SUPPORTED_PLATFORM_IDS.join('|');
    return [
        'Usage: oac <command>',
        'Summary: Open Agent Connect installer and local maintenance CLI.',
        'Commands:',
        '  install  Install shared MetaBot runtime assets and auto-bind detected platform skills.',
        '  doctor   Verify the npm-installed Open Agent Connect runtime state.',
        '  uninstall  Remove OAC shim and guarded host skill symlinks.',
        'Optional flags:',
        `  --host <${hostList}>  Force one platform root for install or doctor.`,
        '  --version, -v  Print the oac CLI version.',
        '  --help, -h  Print this help text.',
        'Primary flow:',
        '  oac install',
        '  oac doctor',
        `  oac install --host <${hostList}>`,
        '',
    ].join('\n');
}
async function runOacUninstall(args, context) {
    const confirmToken = readFlagValue(args, '--confirm-token');
    const all = hasFlag(args, '--all');
    if (confirmToken && !all) {
        return (0, commandResult_1.commandFailed)('invalid_argument', '--confirm-token can only be used together with --all.');
    }
    try {
        const result = await (0, uninstall_1.runSystemUninstall)({
            systemHomeDir: (0, homeSelection_1.normalizeSystemHomeDir)(context.env, context.cwd),
            all,
            confirmToken,
            env: context.env,
        });
        return (0, commandResult_1.commandSuccess)(result);
    }
    catch (error) {
        if (error instanceof types_1.SystemCommandError) {
            return (0, commandResult_1.commandFailed)(error.code, error.message);
        }
        return (0, commandResult_1.commandFailed)('uninstall_failed', error instanceof Error ? error.message : String(error));
    }
}
function rawStdoutHandledResult() {
    const result = (0, commandResult_1.commandSuccess)({ handled: true });
    result.__rawStdoutHandled = true;
    return result;
}
async function runOac(argv, contextInput = {}) {
    const context = resolveContext(contextInput);
    const [command, ...rest] = argv;
    let result;
    try {
        if (versionRequested(argv)) {
            context.stdout.write(`oac ${version_1.CLI_VERSION}\n`);
            result = rawStdoutHandledResult();
        }
        else if (helpRequested(argv)) {
            context.stdout.write(renderHelp());
            result = rawStdoutHandledResult();
        }
        else {
            const host = readFlagValue(rest, '--host');
            switch (command) {
                case 'install':
                    result = await (0, npmInstall_1.runNpmInstall)({ host }, context);
                    break;
                case 'doctor':
                    result = await (0, npmInstall_1.runNpmDoctor)({ host }, context);
                    break;
                case 'uninstall':
                    result = await runOacUninstall(rest, context);
                    break;
                case undefined:
                    result = (0, commandResult_1.commandFailed)('missing_command', 'No command provided.');
                    break;
                default:
                    result = (0, commandResult_1.commandFailed)('unknown_command', `Unknown command: ${command}`);
                    break;
            }
        }
    }
    catch (error) {
        result = (0, commandResult_1.commandFailed)('oac_execution_failed', error instanceof Error ? error.message : String(error));
    }
    if (!result.__rawStdoutHandled) {
        writeJsonLine(context, result);
    }
    return resolveExitCode(result);
}
if (require.main === module) {
    void runOac(process.argv.slice(2)).then((exitCode) => {
        process.exitCode = exitCode;
    });
}
