#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCli = runCli;
const node_path_1 = __importDefault(require("node:path"));
const commandResult_1 = require("../core/contracts/commandResult");
const daemon_1 = require("../daemon");
const mvcPendingUtxos_1 = require("../core/chain/mvcPendingUtxos");
const homeSelection_1 = require("../core/state/homeSelection");
const paths_1 = require("../core/state/paths");
const version_1 = require("./version");
const daemon_2 = require("./commands/daemon");
const doctor_1 = require("./commands/doctor");
const identity_1 = require("./commands/identity");
const user_1 = require("./commands/user");
const owner_1 = require("./commands/owner");
const trust_1 = require("./commands/trust");
const block_1 = require("./commands/block");
const team_1 = require("./commands/team");
const mcp_1 = require("./commands/mcp");
const hook_1 = require("./commands/hook");
const sessions_1 = require("./commands/sessions");
const network_1 = require("./commands/network");
const provider_1 = require("./commands/provider");
const services_1 = require("./commands/services");
const buzz_1 = require("./commands/buzz");
const comment_1 = require("./commands/comment");
const bot_1 = require("./commands/bot");
const browser_1 = require("./commands/browser");
const chain_1 = require("./commands/chain");
const traffic_1 = require("./commands/traffic");
const chat_1 = require("./commands/chat");
const grouptask_1 = require("./commands/grouptask");
const metatask_1 = require("./commands/metatask");
const conversations_1 = require("./commands/conversations");
const memory_1 = require("./commands/memory");
const chainhistory_1 = require("./commands/chainhistory");
const dream_1 = require("./commands/dream");
const surf_1 = require("./commands/surf");
const longtask_1 = require("./commands/longtask");
const knowledge_base_1 = require("./commands/knowledge-base");
const schedule_1 = require("./commands/schedule");
const twin_1 = require("./commands/twin");
const file_1 = require("./commands/file");
const trace_1 = require("./commands/trace");
const ui_1 = require("./commands/ui");
const config_1 = require("./commands/config");
const skills_1 = require("./commands/skills");
const host_1 = require("./commands/host");
const agents_1 = require("./commands/agents");
const wallet_1 = require("./commands/wallet");
const system_1 = require("./commands/system");
const llm_1 = require("./commands/llm");
const metaapp_1 = require("./commands/metaapp");
const metaid_1 = require("./commands/metaid");
const metaweb_1 = require("./commands/metaweb");
const simplenote_1 = require("./commands/simplenote");
const qanda_1 = require("./commands/qanda");
const protocol_1 = require("./commands/protocol");
const media_1 = require("./commands/media");
const helpers_1 = require("./commands/helpers");
const commandHelp_1 = require("./commandHelp");
const types_1 = require("./types");
const runtime_1 = require("./runtime");
function resolveExitCode(result) {
    if (result.ok && result.state === 'success')
        return 0;
    // Awaiting confirmation is a deliberate pause, not success: scripts must
    // be able to tell "needs --confirm" apart from "done" (exit 0).
    if (result.state === 'awaiting_confirmation' || result.state === 'waiting' || result.state === 'manual_action_required')
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
    // Cross-process pending-UTXO journal: a wallet transfer in this CLI process
    // must immediately constrain UTXO selection in the daemon (and vice versa)
    // — explorer views lag several seconds behind a broadcast.
    (0, mvcPendingUtxos_1.configurePendingMvcUtxoPersistence)({
        journalPath: node_path_1.default.join((0, paths_1.resolveMetabotDaemonPaths)((0, homeSelection_1.normalizeSystemHomeDir)(context.env, context.cwd)).runtimeRoot, 'pending-mvc-utxos.json'),
    });
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
                case 'comment':
                    result = await (0, comment_1.runCommentCommand)(rest, context);
                    break;
                case 'bot':
                    result = await (0, bot_1.runBotCommand)(rest, context);
                    break;
                case 'browser':
                    result = await (0, browser_1.runBrowserCommand)(rest, context);
                    break;
                case 'chain':
                    result = await (0, chain_1.runChainCommand)(rest, context);
                    break;
                case 'traffic':
                    result = await (0, traffic_1.runTrafficCommand)(rest, context);
                    break;
                case 'media':
                    result = await (0, media_1.runMediaCommand)(rest, context);
                    break;
                case 'daemon':
                    result = await (0, daemon_2.runDaemonCommand)(rest, context);
                    break;
                case 'doctor':
                    result = await (0, doctor_1.runDoctorCommand)(rest, context);
                    break;
                case 'identity':
                    result = await (0, identity_1.runIdentityCommand)(rest, context);
                    break;
                case 'user':
                    result = await (0, user_1.runUserCommand)(rest, context);
                    break;
                case 'owner':
                    result = await (0, owner_1.runOwnerCommand)(rest, context);
                    break;
                case 'trust':
                    result = await (0, trust_1.runTrustCommand)(rest, context);
                    break;
                case 'block':
                    result = await (0, block_1.runBlockCommand)(rest, context);
                    break;
                case 'team':
                    result = await (0, team_1.runTeamCommand)(rest, context);
                    break;
                case 'mcp':
                    result = await (0, mcp_1.runMcpCommand)(rest, context);
                    break;
                case 'hook':
                    result = await (0, hook_1.runHookCommand)(rest, context);
                    break;
                case 'sessions':
                    result = await (0, sessions_1.runSessionsCommand)(rest, context);
                    break;
                case 'network':
                    result = await (0, network_1.runNetworkCommand)(rest, context);
                    break;
                case 'provider':
                    result = await (0, provider_1.runProviderCommand)(rest, context);
                    break;
                case 'services':
                    result = await (0, services_1.runServicesCommand)(rest, context);
                    break;
                case 'chat':
                    result = await (0, chat_1.runChatCommand)(rest, context);
                    break;
                case 'grouptask':
                    result = await (0, grouptask_1.runGroupTaskCommand)(rest, context);
                    break;
                case 'metatask':
                    result = await (0, metatask_1.runMetaTaskCommand)(rest, context);
                    break;
                case 'conversations':
                    result = await (0, conversations_1.runConversationsCommand)(rest, context);
                    break;
                case 'memory':
                    result = await (0, memory_1.runMemoryCommand)(rest, context);
                    break;
                case 'chainhistory':
                    result = await (0, chainhistory_1.runChainhistoryCommand)(rest, context);
                    break;
                case 'dream':
                    result = await (0, dream_1.runDreamCommand)(rest, context);
                    break;
                case 'surf':
                    result = await (0, surf_1.runSurfCommand)(rest, context);
                    break;
                case 'longtask':
                    result = await (0, longtask_1.runLongTaskCommand)(rest, context);
                    break;
                case 'knowledge-base':
                    result = await (0, knowledge_base_1.runKnowledgeBaseCommand)(rest, context);
                    break;
                case 'schedule':
                    result = await (0, schedule_1.runScheduleCommand)(rest, context);
                    break;
                case 'twin':
                    result = await (0, twin_1.runTwinCommand)(rest, context);
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
                case 'agents':
                    result = await (0, agents_1.runAgentsCommand)(rest, context);
                    break;
                case 'host':
                    result = await (0, host_1.runHostCommand)(rest, context);
                    break;
                case 'system':
                    result = await (0, system_1.runSystemCommand)(rest, context);
                    break;
                case 'llm':
                    result = await (0, llm_1.runLlmCommand)(rest, context);
                    break;
                case 'metaapp':
                    result = await (0, metaapp_1.runMetaAppCommand)(rest, context);
                    break;
                case 'metaid':
                    result = await (0, metaid_1.runMetaIdCommand)(rest, context);
                    break;
                case 'metaweb':
                    result = await (0, metaweb_1.runMetawebCommand)(rest, context);
                    break;
                case 'simplenote':
                    result = await (0, simplenote_1.runSimpleNoteCommand)(rest, context);
                    break;
                case 'qanda':
                    result = await (0, qanda_1.runQandaCommand)(rest, context);
                    break;
                case 'protocol':
                    result = await (0, protocol_1.runProtocolCommand)(rest, context);
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
        }).catch((error) => {
            // The serve process must never die on an unhandled rejection: daemon
            // stop/start races and concurrent CLI auto-starts routinely lose the
            // daemon lock, and a stack-trace crash hides that the winner is fine.
            const code = error?.code;
            if (code === daemon_1.DAEMON_LOCK_TIMEOUT_CODE) {
                console.error('[daemon serve] another daemon holds the lock — leaving it running, this process exits.');
                process.exit(0);
            }
            console.error('[daemon serve] failed:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        });
    }
    else {
        void runCli(argv).then((exitCode) => {
            process.exitCode = exitCode;
        });
    }
}
