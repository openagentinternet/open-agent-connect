import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import type { CliRuntimeContext } from '../types';
import { commandUnknownSubcommand, readFlagValue, readFromFlag } from './helpers';

export async function runLlmCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>> {
  const subcommand = args[0];
  const from = readFromFlag(args);
  const slug = readFlagValue(args, '--slug') ?? undefined;
  const llm = context.dependencies.llm;

  if (subcommand === 'list-runtimes') {
    return llm?.listRuntimes
      ? llm.listRuntimes()
      : commandFailed('not_implemented', 'LLM runtime handler not configured.');
  }

  if (subcommand === 'discover') {
    return llm?.discoverRuntimes
      ? llm.discoverRuntimes()
      : commandFailed('not_implemented', 'LLM discover handler not configured.');
  }

  if (subcommand === 'bindings') {
    return llm?.listBindings
      ? llm.listBindings({ from: from ?? undefined, slug })
      : commandFailed('not_implemented', 'LLM bindings handler not configured.');
  }

  if (subcommand === 'bind') {
    const runtimeId = readFlagValue(args, '--runtime-id');
    const role = readFlagValue(args, '--role') ?? 'primary';
    const priorityArg = readFlagValue(args, '--priority');
    const priority = priorityArg ? parseInt(priorityArg, 10) : 0;

    if (!runtimeId) return commandFailed('missing_flag', '--runtime-id is required.');

    const binding = {
      llmRuntimeId: runtimeId,
      role,
      priority: Number.isFinite(priority) ? priority : 0,
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    return llm?.upsertBindings
      ? llm.upsertBindings({ from: from ?? undefined, slug, bindings: [binding] })
      : commandFailed('not_implemented', 'LLM bindings handler not configured.');
  }

  if (subcommand === 'unbind') {
    const bindingId = readFlagValue(args, '--binding-id');
    if (!bindingId) return commandFailed('missing_flag', '--binding-id is required.');
    return llm?.removeBinding
      ? llm.removeBinding({ from: from ?? slug, bindingId })
      : commandFailed('not_implemented', 'LLM remove binding handler not configured.');
  }

  if (subcommand === 'set-preferred') {
    const runtimeId = readFlagValue(args, '--runtime-id');
    return llm?.setPreferredRuntime
      ? llm.setPreferredRuntime({ from: from ?? undefined, slug, runtimeId: runtimeId ?? null })
      : commandFailed('not_implemented', 'LLM preferred runtime handler not configured.');
  }

  if (subcommand === 'get-preferred') {
    return llm?.getPreferredRuntime
      ? llm.getPreferredRuntime({ from: from ?? undefined, slug })
      : commandFailed('not_implemented', 'LLM preferred runtime handler not configured.');
  }

  return commandUnknownSubcommand(`llm ${args.join(' ')}`.trim());
}
