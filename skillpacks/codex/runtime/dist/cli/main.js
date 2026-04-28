#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCli = runCli;
const commandResult_1 = require("../core/contracts/commandResult");
const version_1 = require("./version");
const daemon_1 = require("./commands/daemon");
const doctor_1 = require("./commands/doctor");
const identity_1 = require("./commands/identity");
const master_1 = require("./commands/master");
const network_1 = require("./commands/network");
const services_1 = require("./commands/services");
const buzz_1 = require("./commands/buzz");
const chain_1 = require("./commands/chain");
const chat_1 = require("./commands/chat");
const file_1 = require("./commands/file");
const trace_1 = require("./commands/trace");
const ui_1 = require("./commands/ui");
const config_1 = require("./commands/config");
const skills_1 = require("./commands/skills");
const host_1 = require("./commands/host");
const evolution_1 = require("./commands/evolution");
const wallet_1 = require("./commands/wallet");
const helpers_1 = require("./commands/helpers");
const commandHelp_1 = require("./commandHelp");
const types_1 = require("./types");
const runtime_1 = require("./runtime");
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
function versionRequested(args) {
    return args.includes('--version') || args.includes('-v');
}
function writeResolvedVersion(context, args) {
    const output = args.includes('--json')
        ? `${JSON.stringify({ version: version_1.CLI_VERSION }, null, 2)}\n`
        : `metabot ${version_1.CLI_VERSION}\n`;
    context.stdout.write(output);
    const result = (0, commandResult_1.commandSuccess)({ version: version_1.CLI_VERSION });
    result.__rawStdoutHandled = true;
    return result;
}
async function runCli(argv, cliContext = {}) {
    const context = (0, types_1.createCliRuntimeContext)(cliContext);
    context.dependencies = (0, runtime_1.mergeCliDependencies)(context);
    const [command, ...rest] = argv;
    let result;
    try {
        if (versionRequested(argv)) {
            result = writeResolvedVersion(context, argv);
        }
        else if ((0, commandHelp_1.helpRequested)(argv)) {
            result = (0, commandHelp_1.writeResolvedHelp)(context, argv);
        }
        else {
            switch (command) {
                case 'buzz':
                    result = await (0, buzz_1.runBuzzCommand)(rest, context);
                    break;
                case 'chain':
                    result = await (0, chain_1.runChainCommand)(rest, context);
                    break;
                case 'daemon':
                    result = await (0, daemon_1.runDaemonCommand)(rest, context);
                    break;
                case 'doctor':
                    result = await (0, doctor_1.runDoctorCommand)(rest, context);
                    break;
                case 'identity':
                    result = await (0, identity_1.runIdentityCommand)(rest, context);
                    break;
                case 'master':
                    result = await (0, master_1.runMasterCommand)(rest, context);
                    break;
                case 'network':
                    result = await (0, network_1.runNetworkCommand)(rest, context);
                    break;
                case 'services':
                    result = await (0, services_1.runServicesCommand)(rest, context);
                    break;
                case 'chat':
                    result = await (0, chat_1.runChatCommand)(rest, context);
                    break;
                case 'file':
                    result = await (0, file_1.runFileCommand)(rest, context);
                    break;
                case 'wallet':
                    result = await (0, wallet_1.runWalletCommand)(rest, context);
                    break;
                case 'trace':
                    result = await (0, trace_1.runTraceCommand)(rest, context);
                    break;
                case 'ui':
                    result = await (0, ui_1.runUiCommand)(rest, context);
                    break;
                case 'config':
                    result = await (0, config_1.runConfigCommand)(rest, context);
                    break;
                case 'skills':
                    result = await (0, skills_1.runSkillsCommand)(rest, context);
                    break;
                case 'host':
                    result = await (0, host_1.runHostCommand)(rest, context);
                    break;
                case 'evolution':
                    result = await (0, evolution_1.runEvolutionCommand)(rest, context);
                    break;
                case undefined:
                    result = (0, commandResult_1.commandFailed)('missing_command', 'No command provided.');
                    break;
                default:
                    result = (0, helpers_1.commandUnknownSubcommand)(command);
                    break;
            }
        }
    }
    catch (error) {
        result = (0, commandResult_1.commandFailed)('cli_execution_failed', error instanceof Error ? error.message : String(error));
    }
    if (!result.__rawStdoutHandled) {
        writeJsonLine(context, result);
    }
    return resolveExitCode(result);
}
if (require.main === module) {
    const argv = process.argv.slice(2);
    if (argv[0] === 'daemon' && argv[1] === 'serve') {
        void (0, runtime_1.serveCliDaemonProcess)({
            env: process.env,
            cwd: process.cwd(),
        });
    }
    else {
        void runCli(argv).then((exitCode) => {
            process.exitCode = exitCode;
        });
    }
}
