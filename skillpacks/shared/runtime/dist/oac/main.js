#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runOac = runOac;
const commandResult_1 = require("../core/contracts/commandResult");
const npmInstall_1 = require("../core/system/npmInstall");
const version_1 = require("../cli/version");
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
function versionRequested(args) {
    return args.includes('--version') || args.includes('-v');
}
function helpRequested(args) {
    return args.includes('--help') || args.includes('-h');
}
function renderHelp() {
    return [
        'Usage: oac <command>',
        'Summary: Open Agent Connect installer and local maintenance CLI.',
        'Commands:',
        '  install  Install shared MetaBot runtime assets and bind host skills.',
        '  doctor   Verify the npm-installed Open Agent Connect runtime state.',
        'Optional flags:',
        '  --host <codex|claude-code|openclaw>  Target host for install or doctor.',
        '  --version, -v  Print the oac CLI version.',
        '  --help, -h  Print this help text.',
        '',
    ].join('\n');
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
