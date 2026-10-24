#!/usr/bin/env node

import path from 'node:path';
import { commandFailed, commandSuccess, type MetabotCommandResult } from '../core/contracts/commandResult';
import { DAEMON_LOCK_TIMEOUT_CODE } from '../daemon';
import { configurePendingMvcUtxoPersistence } from '../core/chain/mvcPendingUtxos';
import { normalizeSystemHomeDir } from '../core/state/homeSelection';
import { resolveMetabotDaemonPaths } from '../core/state/paths';
import { CLI_VERSION } from './version';
import { runDaemonCommand } from './commands/daemon';
import { runDoctorCommand } from './commands/doctor';
import { runIdentityCommand } from './commands/identity';
import { runUserCommand } from './commands/user';
import { runOwnerCommand } from './commands/owner';
import { runTrustCommand } from './commands/trust';
import { runBlockCommand } from './commands/block';
import { runTeamCommand } from './commands/team';
import { runNetworkCommand } from './commands/network';
import { runProviderCommand } from './commands/provider';
import { runServicesCommand } from './commands/services';
import { runBuzzCommand } from './commands/buzz';
import { runCommentCommand } from './commands/comment';
import { runBotCommand } from './commands/bot';
import { runBrowserCommand } from './commands/browser';
import { runChainCommand } from './commands/chain';
import { runTrafficCommand } from './commands/traffic';
import { runChatCommand } from './commands/chat';
import { runGroupTaskCommand } from './commands/grouptask';
import { runMetaTaskCommand } from './commands/metatask';
import { runConversationsCommand } from './commands/conversations';
import { runMemoryCommand } from './commands/memory';
import { runChainhistoryCommand } from './commands/chainhistory';
import { runDreamCommand } from './commands/dream';
import { runSurfCommand } from './commands/surf';
import { runLongTaskCommand } from './commands/longtask';
import { runKnowledgeBaseCommand } from './commands/knowledge-base';
import { runScheduleCommand } from './commands/schedule';
import { runTwinCommand } from './commands/twin';
import { runFileCommand } from './commands/file';
import { runTraceCommand } from './commands/trace';
import { runUiCommand } from './commands/ui';
import { runConfigCommand } from './commands/config';
import { runSkillsCommand } from './commands/skills';
import { runHostCommand } from './commands/host';
import { runAgentsCommand } from './commands/agents';
import { runWalletCommand } from './commands/wallet';
import { runSystemCommand } from './commands/system';
import { runLlmCommand } from './commands/llm';
import { runMetaAppCommand } from './commands/metaapp';
import { runMetaIdCommand } from './commands/metaid';
import { runMetawebCommand } from './commands/metaweb';
import { runSimpleNoteCommand } from './commands/simplenote';
import { runQandaCommand } from './commands/qanda';
import { runProtocolCommand } from './commands/protocol';
import { runMediaCommand } from './commands/media';
import { commandUnknownSubcommand } from './commands/helpers';
import { helpRequested, writeResolvedHelp } from './commandHelp';
import { createCliRuntimeContext, type CliContext } from './types';
import { mergeCliDependencies, serveCliDaemonProcess } from './runtime';

function resolveExitCode(result: MetabotCommandResult<unknown>): number {
  if (result.ok && result.state === 'success') return 0;
  // Awaiting confirmation is a deliberate pause, not success: scripts must
  // be able to tell "needs --confirm" apart from "done" (exit 0).
  if (result.state === 'awaiting_confirmation' || result.state === 'waiting' || result.state === 'manual_action_required') return 2;
  return 1;
}

function writeJsonLine(context: ReturnType<typeof createCliRuntimeContext>, payload: unknown): void {
  context.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function versionRequested(args: string[]): boolean {
  return args.includes('--version') || args.includes('-v');
}

function writeResolvedVersion(
  context: ReturnType<typeof createCliRuntimeContext>,
  args: string[]
): MetabotCommandResult<unknown> & { __rawStdoutHandled?: boolean } {
  const output = args.includes('--json')
    ? `${JSON.stringify({ version: CLI_VERSION }, null, 2)}\n`
    : `metabot ${CLI_VERSION}\n`;
  context.stdout.write(output);
  const result = commandSuccess({ version: CLI_VERSION }) as MetabotCommandResult<unknown> & {
    __rawStdoutHandled?: boolean;
  };
  result.__rawStdoutHandled = true;
  return result;
}

export async function runCli(argv: string[], cliContext: CliContext = {}): Promise<number> {
  const context = createCliRuntimeContext(cliContext);
  context.dependencies = mergeCliDependencies(context);
  // Cross-process pending-UTXO journal: a wallet transfer in this CLI process
  // must immediately constrain UTXO selection in the daemon (and vice versa)
  // — explorer views lag several seconds behind a broadcast.
  configurePendingMvcUtxoPersistence({
    journalPath: path.join(
      resolveMetabotDaemonPaths(normalizeSystemHomeDir(context.env, context.cwd)).runtimeRoot,
      'pending-mvc-utxos.json',
    ),
  });

  const [command, ...rest] = argv;
  let result: MetabotCommandResult<unknown>;

  try {
    if (versionRequested(argv)) {
      result = writeResolvedVersion(context, argv);
    } else if (helpRequested(argv)) {
      result = writeResolvedHelp(context, argv);
    } else {
      switch (command) {
        case 'buzz':
          result = await runBuzzCommand(rest, context);
          break;
        case 'comment':
          result = await runCommentCommand(rest, context);
          break;
        case 'bot':
          result = await runBotCommand(rest, context);
          break;
        case 'browser':
          result = await runBrowserCommand(rest, context);
          break;
        case 'chain':
          result = await runChainCommand(rest, context);
          break;
        case 'traffic':
          result = await runTrafficCommand(rest, context);
          break;
        case 'media':
          result = await runMediaCommand(rest, context);
          break;
        case 'daemon':
          result = await runDaemonCommand(rest, context);
          break;
        case 'doctor':
          result = await runDoctorCommand(rest, context);
          break;
        case 'identity':
          result = await runIdentityCommand(rest, context);
          break;
        case 'user':
          result = await runUserCommand(rest, context);
          break;
        case 'owner':
          result = await runOwnerCommand(rest, context);
          break;
        case 'trust':
          result = await runTrustCommand(rest, context);
          break;
        case 'block':
          result = await runBlockCommand(rest, context);
          break;
        case 'team':
          result = await runTeamCommand(rest, context);
          break;
        case 'network':
          result = await runNetworkCommand(rest, context);
          break;
        case 'provider':
          result = await runProviderCommand(rest, context);
          break;
        case 'services':
          result = await runServicesCommand(rest, context);
          break;
        case 'chat':
          result = await runChatCommand(rest, context);
          break;
        case 'grouptask':
          result = await runGroupTaskCommand(rest, context);
          break;
        case 'metatask':
          result = await runMetaTaskCommand(rest, context);
          break;
        case 'conversations':
          result = await runConversationsCommand(rest, context);
          break;
        case 'memory':
          result = await runMemoryCommand(rest, context);
          break;
        case 'chainhistory':
          result = await runChainhistoryCommand(rest, context);
          break;
        case 'dream':
          result = await runDreamCommand(rest, context);
          break;
        case 'surf':
          result = await runSurfCommand(rest, context);
          break;
        case 'longtask':
          result = await runLongTaskCommand(rest, context);
          break;
        case 'knowledge-base':
          result = await runKnowledgeBaseCommand(rest, context);
          break;
        case 'schedule':
          result = await runScheduleCommand(rest, context);
          break;
        case 'twin':
          result = await runTwinCommand(rest, context);
          break;
        case 'file':
          result = await runFileCommand(rest, context);
          break;
        case 'wallet':
          result = await runWalletCommand(rest, context);
          break;
        case 'trace':
          result = await runTraceCommand(rest, context);
          break;
        case 'ui':
          result = await runUiCommand(rest, context);
          break;
        case 'config':
          result = await runConfigCommand(rest, context);
          break;
        case 'skills':
          result = await runSkillsCommand(rest, context);
          break;
        case 'agents':
          result = await runAgentsCommand(rest, context);
          break;
        case 'host':
          result = await runHostCommand(rest, context);
          break;
        case 'system':
          result = await runSystemCommand(rest, context);
          break;
        case 'llm':
          result = await runLlmCommand(rest, context);
          break;
        case 'metaapp':
          result = await runMetaAppCommand(rest, context);
          break;
        case 'metaid':
          result = await runMetaIdCommand(rest, context);
          break;
        case 'metaweb':
          result = await runMetawebCommand(rest, context);
          break;
        case 'simplenote':
          result = await runSimpleNoteCommand(rest, context);
          break;
        case 'qanda':
          result = await runQandaCommand(rest, context);
          break;
        case 'protocol':
          result = await runProtocolCommand(rest, context);
          break;
        case undefined:
          result = commandFailed('missing_command', 'No command provided.');
          break;
        default:
          result = commandUnknownSubcommand(command);
          break;
      }
    }
  } catch (error) {
    result = commandFailed(
      'cli_execution_failed',
      error instanceof Error ? error.message : String(error)
    );
  }

  if (!(result as { __rawStdoutHandled?: boolean }).__rawStdoutHandled) {
    writeJsonLine(context, result);
  }
  return resolveExitCode(result);
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv[0] === 'daemon' && argv[1] === 'serve') {
    void serveCliDaemonProcess({
      env: process.env,
      cwd: process.cwd(),
    }).catch((error: unknown) => {
      // The serve process must never die on an unhandled rejection: daemon
      // stop/start races and concurrent CLI auto-starts routinely lose the
      // daemon lock, and a stack-trace crash hides that the winner is fine.
      const code = (error as { code?: unknown } | undefined)?.code;
      if (code === DAEMON_LOCK_TIMEOUT_CODE) {
        console.error('[daemon serve] another daemon holds the lock — leaving it running, this process exits.');
        process.exit(0);
      }
      console.error('[daemon serve] failed:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
  } else {
    void runCli(argv).then((exitCode) => {
      process.exitCode = exitCode;
    });
  }
}
