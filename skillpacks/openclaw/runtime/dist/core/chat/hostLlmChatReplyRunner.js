"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHostLlmChatReplyRunner = createHostLlmChatReplyRunner;
exports.buildChatPrompt = buildChatPrompt;
exports.parseRunnerOutput = parseRunnerOutput;
const defaultChatReplyRunner_1 = require("./defaultChatReplyRunner");
const hostLlmExecutor_1 = require("../llm/hostLlmExecutor");
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_FALLBACK_ATTEMPTS = 5;
const CLOSE_CONVERSATION_SIGNAL = 'Bye';
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function findFinalNonEmptyLineIndex(lines) {
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        if (lines[index].trim()) {
            return index;
        }
    }
    return -1;
}
function hasFinalByeLine(value) {
    const lines = value.split(/\r?\n/u);
    const finalIndex = findFinalNonEmptyLineIndex(lines);
    return finalIndex >= 0 && lines[finalIndex].trim().toLowerCase() === CLOSE_CONVERSATION_SIGNAL.toLowerCase();
}
function canonicalizeFinalByeLine(value) {
    const lines = value.split(/\r?\n/u);
    const finalIndex = findFinalNonEmptyLineIndex(lines);
    if (finalIndex >= 0 && lines[finalIndex].trim().toLowerCase() === CLOSE_CONVERSATION_SIGNAL.toLowerCase()) {
        lines[finalIndex] = CLOSE_CONVERSATION_SIGNAL;
    }
    return lines.join('\n').trim();
}
function buildChatPrompt(input) {
    const { conversation, recentMessages, persona, strategy } = input;
    const maxTurns = strategy?.maxTurns ?? 30;
    const sections = [];
    sections.push('You are a MetaBot having a private conversation with another MetaBot through the Open Agent Connect network.');
    if (persona.role) {
        sections.push(`## Your Role\n${persona.role}`);
    }
    if (persona.soul) {
        sections.push(`## Your Style\n${persona.soul}`);
    }
    if (persona.goal) {
        sections.push(`## Your Goal\n${persona.goal}`);
    }
    const strategyLines = [
        '## Conversation Strategy',
        '- This is a MetaBot-to-MetaBot network conversation.',
    ];
    if (strategy?.exitCriteria) {
        strategyLines.push(`- Conversation objective: ${strategy.exitCriteria}`);
    }
    strategyLines.push(`- Current turn: ${conversation.turnCount} / ${maxTurns}`);
    strategyLines.push('- Keep replies concise and natural, 2-4 sentences per message.');
    strategyLines.push('- Do not repeat what you have already said.');
    strategyLines.push('- Actively steer the conversation toward the objective.');
    if (conversation.turnCount > 20) {
        strategyLines.push('- This private chat has passed 20 inbound turns; converge the topic and end naturally soon.');
    }
    sections.push(strategyLines.join('\n'));
    const exitLines = [
        '## Exit Mechanism',
        `When ANY of the following conditions are met, add ${CLOSE_CONVERSATION_SIGNAL} on its own final line at the very end of your reply:`,
        '- The conversation objective has been achieved',
        '- The other party says goodbye or signals the end',
        '- There are no more valuable topics to discuss',
        `- Approaching the turn limit (currently turn ${conversation.turnCount} of ${maxTurns})`,
    ];
    sections.push(exitLines.join('\n'));
    sections.push([
        '## Format Rules',
        '- Output ONLY the reply text itself, no prefixes, labels, or markdown formatting.',
        '- Reply in the same language the other party is using.',
        `- If ending the conversation, write your farewell first, then ${CLOSE_CONVERSATION_SIGNAL} on a separate final line.`,
    ].join('\n'));
    const selfName = 'Me';
    const peerName = conversation.peerName || 'Peer';
    const historyLines = recentMessages.map(msg => {
        const name = msg.direction === 'outbound' ? selfName : peerName;
        return `${name}: ${msg.content}`;
    });
    if (historyLines.length > 0) {
        sections.push(`## Chat History\n${historyLines.join('\n')}`);
    }
    sections.push('Reply now:');
    return sections.join('\n\n');
}
function parseRunnerOutput(rawOutput) {
    const output = normalizeText(rawOutput);
    if (!output) {
        return { state: 'skip' };
    }
    const content = canonicalizeFinalByeLine(output);
    const hasEndMarker = hasFinalByeLine(content);
    return {
        state: hasEndMarker ? 'end_conversation' : 'reply',
        content,
    };
}
async function tryExecute(resolver, metaBotSlug, prompt, timeoutMs, excludeRuntimeIds) {
    // Re-resolve each attempt so we pick up the next candidate.
    let resolved;
    let attempts = 0;
    do {
        resolved = await resolver.resolveRuntime({ metaBotSlug });
        // If the resolver picked a runtime we already failed on, skip it by marking
        // it unavailable so the resolver walks past it on the next call.
        if (resolved.runtime && excludeRuntimeIds.has(resolved.runtime.id)) {
            // Force the runtime health to unavailable so the resolver skips it.
            // This mutation is temporary — we restore a healthy runtime's health later.
            await resolver.markRuntimeUnavailable(resolved.runtime.id).catch(() => { });
            resolved = { runtime: null };
        }
        attempts++;
    } while (!resolved.runtime && attempts < MAX_FALLBACK_ATTEMPTS);
    if (!resolved.runtime)
        return null;
    try {
        const execResult = await (0, hostLlmExecutor_1.executeLlm)({
            runtime: resolved.runtime,
            prompt,
            timeoutMs,
        });
        if (!execResult.ok) {
            excludeRuntimeIds.add(resolved.runtime.id);
            await resolver.markRuntimeUnavailable(resolved.runtime.id).catch(() => { });
            return null;
        }
        return { result: parseRunnerOutput(execResult.output), bindingId: resolved.bindingId };
    }
    catch {
        excludeRuntimeIds.add(resolved.runtime.id);
        await resolver.markRuntimeUnavailable(resolved.runtime.id).catch(() => { });
        return null;
    }
}
function createHostLlmChatReplyRunner(options) {
    const runtimeResolver = options?.runtimeResolver;
    const metaBotSlug = options?.metaBotSlug;
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const fallbackRunner = (0, defaultChatReplyRunner_1.createDefaultChatReplyRunner)();
    // If no resolver provided, fall back to template-only replies.
    if (!runtimeResolver) {
        return fallbackRunner;
    }
    return async (input) => {
        const prompt = buildChatPrompt(input);
        const excludeRuntimeIds = new Set();
        // Try up to MAX_FALLBACK_ATTEMPTS different runtimes.
        for (let attempt = 0; attempt < MAX_FALLBACK_ATTEMPTS; attempt++) {
            const outcome = await tryExecute(runtimeResolver, metaBotSlug, prompt, timeoutMs, excludeRuntimeIds);
            if (outcome) {
                // Track lastUsedAt on the binding that was successfully used.
                if (outcome.bindingId) {
                    runtimeResolver.markBindingUsed(outcome.bindingId).catch(() => { });
                }
                return outcome.result;
            }
        }
        // All runtimes failed — fall back to template-only reply.
        return fallbackRunner(input);
    };
}
