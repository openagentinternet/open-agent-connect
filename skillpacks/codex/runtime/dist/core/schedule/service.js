"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildScheduleSystemPrompt = buildScheduleSystemPrompt;
exports.runScheduledTask = runScheduledTask;
// Scheduled-task orchestration: the claim → execute → settle loop shared by
// the daemon tick and `metabot schedule run`. The LLM transport is injected
// (`runLlmPromptWithRuntimeFallback` on both call sites), so DSH-style hosts
// can drive tasks across the process boundary with the same store semantics.
const node_path_1 = __importDefault(require("node:path"));
const chatPersonaLoader_1 = require("../chat/chatPersonaLoader");
const memoryService_1 = require("../memory/memoryService");
const metabotIdentity_1 = require("../prompt/metabotIdentity");
const compose_1 = require("../prompt/compose");
const memoryInjection_1 = require("../prompt/memoryInjection");
const store_1 = require("./store");
/**
 * Bot persona framing that wraps every scheduled task prompt (v1 has no
 * per-task systemPrompt; the persona + a short scheduled-task framing stand
 * in for it). The identity block comes from the one shared builder so a
 * scheduled task behaves in the same persona as every other scenario.
 */
async function buildScheduleSystemPrompt(paths) {
    const persona = await (0, chatPersonaLoader_1.loadChatPersona)(paths);
    const slug = node_path_1.default.basename(paths.profileRoot);
    const botName = persona.identity?.name || slug;
    return (0, compose_1.composeSystemPrompt)([
        {
            name: 'scenario',
            order: compose_1.SYSTEM_PROMPT_ORDER.scenario,
            text: [
                'You are a MetaBot. This is a scheduled task that fired for you.',
                'Do the work the prompt asks for, honestly and self-contained.',
                'You are acting asynchronously: there is no human watching live, so report your result plainly when the task asks for one.',
            ].join('\n'),
        },
        {
            name: 'identity',
            order: compose_1.SYSTEM_PROMPT_ORDER.identity,
            text: (0, metabotIdentity_1.buildMetabotIdentityBlock)({
                name: botName,
                globalMetaId: persona.identity?.globalMetaId,
                role: persona.role,
                soul: persona.soul,
                goal: persona.goal,
            }),
        },
    ]);
}
/**
 * Claim one task, run the prompt through the injected LLM runner, and settle
 * the run honestly (executor throw/timeout → error; otherwise success).
 */
async function runScheduledTask(paths, input, deps) {
    const store = (0, store_1.createScheduleStore)(paths);
    // Build the persona framing before claiming so a persona read failure never
    // leaves a claimed run unsettled.
    const systemPrompt = await buildScheduleSystemPrompt(paths);
    const claimed = await store.claim(input.taskId, {
        trigger: input.trigger,
        executor: input.executor,
    }, deps.now !== undefined ? { now: deps.now } : {});
    if (!claimed.ok) {
        if (claimed.code === 'already_running')
            return { kind: 'already_running' };
        return { kind: 'failed', error: `task claim failed: ${claimed.code}` };
    }
    const { run, task } = claimed;
    try {
        // Scoped memory + experience hot layer ride the user prompt tail
        // (IDBots volatile-tail pattern): scheduled tasks are local owner work, so
        // the local 'cowork_ui' channel resolves the owner scope.
        const memorySection = await (0, memoryService_1.buildMemoryBlocksForRequest)(paths, {
            channel: 'cowork_ui',
            userText: task.prompt,
        }).then((result) => (0, memoryInjection_1.wrapMemoryInjection)(result.xml)).catch(() => '');
        const prompt = memorySection ? `${task.prompt}\n\n${memorySection}` : task.prompt;
        const outcome = await deps.runLlm({ prompt, systemPrompt });
        if (!outcome.ok) {
            await store.complete(run.id, { error: outcome.error });
            return { kind: 'failed', error: outcome.error };
        }
        await store.complete(run.id, {});
        return { kind: 'completed', output: outcome.output };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await store.complete(run.id, { error: message });
        return { kind: 'failed', error: message };
    }
}
