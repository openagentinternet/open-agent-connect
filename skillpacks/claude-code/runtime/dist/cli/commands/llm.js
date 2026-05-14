"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runLlmCommand = runLlmCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
async function runLlmCommand(args, context) {
    const subcommand = args[0];
    const from = (0, helpers_1.readFromFlag)(args);
    const slug = (0, helpers_1.readFlagValue)(args, '--slug') ?? undefined;
    const llm = context.dependencies.llm;
    if (subcommand === 'list-runtimes') {
        return llm?.listRuntimes
            ? llm.listRuntimes()
            : (0, commandResult_1.commandFailed)('not_implemented', 'LLM runtime handler not configured.');
    }
    if (subcommand === 'discover') {
        return llm?.discoverRuntimes
            ? llm.discoverRuntimes()
            : (0, commandResult_1.commandFailed)('not_implemented', 'LLM discover handler not configured.');
    }
    if (subcommand === 'bindings') {
        return llm?.listBindings
            ? llm.listBindings({ from: from ?? undefined, slug })
            : (0, commandResult_1.commandFailed)('not_implemented', 'LLM bindings handler not configured.');
    }
    if (subcommand === 'bind') {
        const runtimeId = (0, helpers_1.readFlagValue)(args, '--runtime-id');
        const role = (0, helpers_1.readFlagValue)(args, '--role') ?? 'primary';
        const priorityArg = (0, helpers_1.readFlagValue)(args, '--priority');
        const priority = priorityArg ? parseInt(priorityArg, 10) : 0;
        if (!runtimeId)
            return (0, commandResult_1.commandFailed)('missing_flag', '--runtime-id is required.');
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
            : (0, commandResult_1.commandFailed)('not_implemented', 'LLM bindings handler not configured.');
    }
    if (subcommand === 'unbind') {
        const bindingId = (0, helpers_1.readFlagValue)(args, '--binding-id');
        if (!bindingId)
            return (0, commandResult_1.commandFailed)('missing_flag', '--binding-id is required.');
        return llm?.removeBinding
            ? llm.removeBinding({ from: from ?? slug, bindingId })
            : (0, commandResult_1.commandFailed)('not_implemented', 'LLM remove binding handler not configured.');
    }
    if (subcommand === 'set-preferred') {
        const runtimeId = (0, helpers_1.readFlagValue)(args, '--runtime-id');
        return llm?.setPreferredRuntime
            ? llm.setPreferredRuntime({ from: from ?? undefined, slug, runtimeId: runtimeId ?? null })
            : (0, commandResult_1.commandFailed)('not_implemented', 'LLM preferred runtime handler not configured.');
    }
    if (subcommand === 'get-preferred') {
        return llm?.getPreferredRuntime
            ? llm.getPreferredRuntime({ from: from ?? undefined, slug })
            : (0, commandResult_1.commandFailed)('not_implemented', 'LLM preferred runtime handler not configured.');
    }
    return (0, helpers_1.commandUnknownSubcommand)(`llm ${args.join(' ')}`.trim());
}
