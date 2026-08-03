"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRIVATE_CHAT_REPLY_GENERATION_ENV = void 0;
exports.createHostLlmChatReplyRunner = createHostLlmChatReplyRunner;
exports.buildChatPrompt = buildChatPrompt;
exports.buildChatSystemPrompt = buildChatSystemPrompt;
exports.parseRunnerOutput = parseRunnerOutput;
exports.stripPlanningPreamble = stripPlanningPreamble;
exports.isPlanningPreambleLine = isPlanningPreambleLine;
const node_fs_1 = require("node:fs");
const defaultChatReplyRunner_1 = require("./defaultChatReplyRunner");
const privateChatAutoReply_1 = require("./privateChatAutoReply");
const privateChatAllowedSkills_1 = require("./privateChatAllowedSkills");
const metaBotWorldview_1 = require("./metaBotWorldview");
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 500;
const MAX_FALLBACK_ATTEMPTS = 5;
const CLOSE_CONVERSATION_SIGNAL = 'Bye';
exports.PRIVATE_CHAT_REPLY_GENERATION_ENV = 'METABOT_PRIVATE_CHAT_REPLY_GENERATION';
// A chat history gap beyond this (or a close marker) starts a new session in
// the prompt; mirrors the orchestrator's idle-reopen window.
const DEFAULT_SESSION_GAP_MS = 300_000;
const SESSION_BOUNDARY_LINE = '--- Earlier conversation session ended. A new session starts below this line: treat it as a fresh opening, and do not end it just because the session above was closed. ---';
function isPlanningPreambleLine(line) {
    const trimmed = line.trim();
    if (!trimmed) {
        return false;
    }
    if (/^先[读查]/u.test(trimmed) && /技能|skill|Skill|MVC|资料|视角/u.test(trimmed)) {
        return true;
    }
    if (/^(?:让我先|我会先|接下来我会|我需要先)/u.test(trimmed) && /技能|skill|Skill|资料/u.test(trimmed)) {
        return true;
    }
    if (/^Use (?:the )?.*skill/i.test(trimmed) && /before (?:I )?reply/i.test(trimmed)) {
        return true;
    }
    return false;
}
function isInvisibleExecutionLine(line) {
    const trimmed = line.trim();
    if (!trimmed) {
        return false;
    }
    if (/^(?:正在|查找|读取)/u.test(trimmed)
        && /私聊技能|会话上下文|MetaBot 信息|相关 MetaBot 命令/u.test(trimmed)
        && /发送(?:私聊)?回复|身份回复|身份发送回复|生成 Buzz 交易数据/u.test(trimmed)) {
        return true;
    }
    if (/^正在以\s+`[^`]+`\s+身份/u.test(trimmed)
        && /发送(?:私聊)?回复/u.test(trimmed)) {
        return true;
    }
    if (/^Looking up /i.test(trimmed)
        && /skill|context|conversation/i.test(trimmed)
        && /reply|respond/i.test(trimmed)) {
        return true;
    }
    if (/^(?:Finding|Checking|Reading|Locating|Looking up)\b/i.test(trimmed)
        && /private[- ]chat|session|conversation|reply|send path/i.test(trimmed)) {
        return true;
    }
    if (/^Sending (?:the )?(?:private[- ]chat )?reply\b/i.test(trimmed)) {
        return true;
    }
    return false;
}
function stripPlanningPreamble(value) {
    const lines = value.split(/\r?\n/u);
    while (lines.length > 0) {
        const line = lines[0];
        if (!line.trim()) {
            lines.shift();
            continue;
        }
        if (isPlanningPreambleLine(line) || isInvisibleExecutionLine(line)) {
            lines.shift();
            continue;
        }
        break;
    }
    return lines.join('\n').trim();
}
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
// Drop a trailing close marker from historical outbound messages: the farewell
// text stays, but past "Bye" markers must not teach the model to end the
// current conversation again.
function stripFinalByeLineFromHistory(value) {
    const lines = value.split(/\r?\n/u);
    const finalIndex = findFinalNonEmptyLineIndex(lines);
    if (finalIndex >= 0 && lines[finalIndex].trim().toLowerCase() === CLOSE_CONVERSATION_SIGNAL.toLowerCase()) {
        lines.splice(finalIndex, 1);
    }
    return lines.join('\n').trim();
}
function buildAuthoritativePersonaSection(input) {
    const { persona } = input;
    const identityName = normalizeText(persona.identity?.name);
    const identityGlobalMetaId = normalizeText(persona.identity?.globalMetaId);
    const lines = [
        '## Your Bot Identity and Persona (authoritative)',
    ];
    if (identityName) {
        lines.push(`- Your name is ${JSON.stringify(identityName)}.`);
    }
    if (identityGlobalMetaId) {
        lines.push(`- Your globalMetaId is ${JSON.stringify(identityGlobalMetaId)}.`);
    }
    lines.push('- This bot identity and the Role, Style, and Goal below are authoritative for this reply.', '- Any name, identity, biography, or persona supplied by the host LLM runtime or its workspace belongs only to the execution host. It is not your bot identity and must never appear as your own.');
    if (identityName) {
        lines.push('- If you introduce yourself, use only your bot name. Never invent, translate, or substitute another name.');
    }
    return lines.join('\n');
}
function buildChatSystemPrompt(input) {
    const { persona } = input;
    return [
        'Generate exactly one private-chat reply as the local bot described below.',
        metaBotWorldview_1.METABOT_AGENT_INTERNET_WORLDVIEW,
        buildAuthoritativePersonaSection(input),
        `## Your Role\n${persona.role}`,
        `## Your Style\n${persona.soul}`,
        `## Your Goal\n${persona.goal}`,
        'Follow the bot identity and persona above even when the execution host has its own conflicting identity or persona.',
    ].join('\n\n');
}
function buildChatPrompt(input, allowedSkillScope = (0, privateChatAllowedSkills_1.emptyPrivateChatAllowedSkillScope)(), options = {}) {
    const { conversation, recentMessages, persona, strategy } = input;
    const maxTurns = strategy?.maxTurns ?? 30;
    const metaBotSlug = normalizeText(options.metaBotSlug);
    const operatorGuidanceText = normalizeText(input.operatorGuidanceText);
    const conversationCloseAllowed = input.conversationCloseAllowed !== false;
    const sections = [];
    sections.push('You are a bot having a private conversation with another bot through the Open Agent Connect network.');
    sections.push(buildAuthoritativePersonaSection(input));
    if (persona.role) {
        sections.push(`## Your Role\n${persona.role}`);
    }
    if (persona.soul) {
        sections.push(`## Your Style\n${persona.soul}`);
    }
    if (persona.goal) {
        sections.push(`## Your Goal\n${persona.goal}`);
    }
    if (metaBotSlug) {
        const actorLines = [
            '## Reply Delivery Boundary (critical)',
            `You are replying as local bot profile \`${metaBotSlug}\`.`,
            '- Generate reply text only as your final output. Open Agent Connect owns delivery of that text and will publish it exactly once.',
            '- NEVER call `metabot chat private`, a private-chat send skill, or any other command that sends this reply yourself.',
        ];
        sections.push(actorLines.join('\n'));
    }
    const strategyLines = [
        '## Conversation Strategy',
        '- This is a bot-to-bot network conversation.',
    ];
    if (strategy?.exitCriteria) {
        strategyLines.push(`- Conversation objective: ${strategy.exitCriteria}`);
    }
    strategyLines.push(`- Current turn: ${conversation.turnCount} / ${maxTurns}`);
    strategyLines.push('- Keep replies concise and natural, 2-4 sentences per message.');
    strategyLines.push('- Do not repeat what you have already said.');
    strategyLines.push('- Actively steer the conversation toward the objective.');
    if (conversationCloseAllowed && conversation.turnCount >= maxTurns - 1) {
        strategyLines.push(`- This chat will be force-closed after turn ${maxTurns}. Steer the topic toward a natural close in THIS reply; if the conversation is ready to end, write your farewell and add ${CLOSE_CONVERSATION_SIGNAL} on the final line.`);
    }
    sections.push(strategyLines.join('\n'));
    const exitLines = conversationCloseAllowed
        ? [
            '## Exit Mechanism',
            `End the conversation ONLY when the exchange is clearly finished. When ending, add ${CLOSE_CONVERSATION_SIGNAL} on its own final line at the very end of your reply:`,
            '- The other party explicitly says goodbye or signals the end in the CURRENT session',
            '- The conversation objective has been fully achieved over several substantive turns',
            '- Several consecutive turns from both sides contained no new, substantive content',
            `- Approaching the turn limit (currently turn ${conversation.turnCount} of ${maxTurns})`,
            '- Do NOT end the conversation just because one reply was short, generic, or low-value; answer it and steer toward a concrete next topic instead.',
            '- Greetings and capability introductions are openings, not a reason to end.',
        ]
        : [
            '## Exit Mechanism',
            'This reply is the opening message of a new session, sent on behalf of the local operator.',
            '- Do NOT end the conversation in this reply: no farewells and no closing remarks.',
            `- Never output the ${CLOSE_CONVERSATION_SIGNAL} close marker in this reply.`,
        ];
    sections.push(exitLines.join('\n'));
    sections.push([
        '## Persona Immersion (critical)',
        '- Stay fully in character from the very first word of your reply.',
        '- Do not narrate plans or internal steps in your reply: no "先读/先查 skill", no workflow/Step narration, no "按角色风格回复".',
        '- After using a skill, reply concisely with the result the persona would give. Do not paste full skill logs or raw tool output.',
    ].join('\n'));
    if (allowedSkillScope.skills.length > 0) {
        const skillLines = allowedSkillScope.skillDetails.map((skill) => {
            const lines = [`- name: ${skill.name}`];
            if (skill.description) {
                lines.push(`  description: ${skill.description}`);
            }
            if (skill.location) {
                lines.push(`  location: ${skill.location}`);
            }
            return lines.join('\n');
        });
        sections.push([
            '## Available Private Chat Skills (evaluate every turn)',
            'Before replying, scan the skill descriptions below and decide whether one should handle the latest message:',
            '- If exactly one skill clearly applies, use it: read its SKILL.md at the listed location, follow it, and run the documented commands before replying.',
            '- If several could apply, choose the most specific one, then read and follow it.',
            '- If none clearly applies, do not use any skill; reply directly.',
            '- Never read more than one skill up front; only read another skill if the first one explicitly references it.',
            '- Use ONLY the skills listed here, even if the host runtime offers other skills.',
            '- Skills may perform their documented actions (including on-chain writes, uploads, or sending messages) when the task calls for it — but never to send this chat reply itself (see Reply Delivery Boundary).',
            '- When skill execution actually starts, the host sends a brief wait notice to the peer automatically. Do not preface normal replies with wait notices, and do not repeat the notice as your final answer.',
            '<available_skills>',
            ...skillLines,
            '</available_skills>',
        ].join('\n'));
    }
    else {
        sections.push([
            '## Private Chat Skills',
            '- No private chat skills are available for this turn. Do not claim local tool access or execute local skills in this regular private chat.',
        ].join('\n'));
    }
    if (operatorGuidanceText) {
        sections.push([
            '## Operator Guidance',
            'This is local-only private guidance from the local operator for this one reply.',
            'Use it as private steering for your next turn.',
            'Do not present it as peer-authored text or mention that you received hidden guidance.',
            operatorGuidanceText,
        ].join('\n'));
    }
    sections.push([
        '## Format Rules',
        '- Output ONLY the reply text itself, no prefixes, labels, or markdown formatting.',
        '- Do NOT open with a plan sentence (for example: "先读…技能，再…"). Start directly with the in-character answer.',
        '- Reply in the same language the other party is using.',
        ...(conversationCloseAllowed
            ? [`- If ending the conversation, write your farewell first, then ${CLOSE_CONVERSATION_SIGNAL} on a separate final line.`]
            : ['- This reply must not end the conversation; do not add a farewell or closing line.']),
    ].join('\n'));
    const selfName = normalizeText(persona.identity?.name) || 'Me';
    const peerName = conversation.peerName || 'Peer';
    const sessionGapMs = strategy?.maxIdleMs ?? DEFAULT_SESSION_GAP_MS;
    const historyLines = [];
    let previousTimestamp = null;
    let previousClosedSession = false;
    for (const msg of recentMessages) {
        // Legacy inbound records may still carry the {"content","extensions"} wire
        // wrapper; unwrap so the model sees plain text (new records are stored
        // unwrapped already).
        const messageText = msg.direction === 'inbound'
            ? (0, privateChatAutoReply_1.unwrapPrivateChatContent)(msg.content).content
            : msg.content;
        const rawContent = normalizeText(messageText);
        const closesSession = hasFinalByeLine(rawContent);
        const timestamp = typeof msg.timestamp === 'number' && Number.isFinite(msg.timestamp)
            ? msg.timestamp
            : null;
        const gapExceeded = previousTimestamp !== null
            && timestamp !== null
            && timestamp - previousTimestamp > sessionGapMs;
        const name = msg.direction === 'outbound' ? selfName : peerName;
        const normalizedContent = msg.direction === 'outbound'
            ? stripFinalByeLineFromHistory(stripPlanningPreamble(msg.content))
            : rawContent;
        if (normalizedContent) {
            // Keep older sessions visible as background, but mark the boundary so a
            // stale farewell or a long idle gap is read as a fresh opening, not as
            // a reason to close the new session again.
            if (historyLines.length > 0 && (previousClosedSession || gapExceeded)) {
                historyLines.push(SESSION_BOUNDARY_LINE);
            }
            historyLines.push(`${name}: ${normalizedContent}`);
        }
        previousTimestamp = timestamp ?? previousTimestamp;
        previousClosedSession = closesSession;
    }
    if (historyLines.length > 0) {
        sections.push(`## Chat History\n${historyLines.join('\n')}`);
    }
    sections.push('Reply now:');
    return sections.join('\n\n');
}
function parseRunnerOutput(rawOutput) {
    const output = normalizeText(stripPlanningPreamble(rawOutput));
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
async function tryExecute(resolver, llmExecutor, metaBotSlug, prompt, systemPrompt, timeoutMs, pollIntervalMs, excludeRuntimeIds, allowedSkillScope, markRuntimeUnavailableOnFailure, stickyRuntime, pollDeadlineTracker, turnState, onSkillExecutionStart, chatWorkspaceDir) {
    const shouldMarkRuntimeUnavailable = markRuntimeUnavailableOnFailure;
    const stickyRuntimeId = stickyRuntime.get();
    const resolved = await resolver.resolveRuntime({
        metaBotSlug,
        excludeRuntimeIds: Array.from(excludeRuntimeIds),
        ...(stickyRuntimeId ? { explicitRuntimeId: stickyRuntimeId } : {}),
    });
    if (!resolved.runtime)
        return null;
    if (excludeRuntimeIds.has(resolved.runtime.id))
        return null;
    if (resolved.runtime.health !== 'healthy') {
        excludeRuntimeIds.add(resolved.runtime.id);
        return null;
    }
    try {
        const request = {
            runtimeId: resolved.runtime.id,
            runtime: resolved.runtime,
            prompt,
            systemPrompt,
            timeout: timeoutMs,
            metaBotSlug,
            outputMode: 'final',
            env: {
                [exports.PRIVATE_CHAT_REPLY_GENERATION_ENV]: '1',
            },
        };
        if (chatWorkspaceDir) {
            request.cwd = chatWorkspaceDir;
        }
        if (allowedSkillScope.skills.length > 0) {
            request.skills = allowedSkillScope.skills;
            request.skillSourcePaths = allowedSkillScope.skillSourcePaths;
        }
        turnState.attemptedExecution = true;
        const sessionId = await llmExecutor.execute(request);
        // Wait-notice trigger: the first tool_use event means an allowed chat
        // skill actually started executing (mirrors the IDBots design). Watch the
        // session event stream in the background; the flag keeps a finished
        // attempt from firing notices, and the orchestrator dedupes per turn.
        let attemptActive = true;
        if (onSkillExecutionStart
            && allowedSkillScope.skills.length > 0
            && typeof llmExecutor.streamEvents === 'function') {
            const streamEvents = llmExecutor.streamEvents.bind(llmExecutor);
            void (async () => {
                try {
                    for await (const event of streamEvents(sessionId)) {
                        if (!attemptActive)
                            return;
                        if (event.type === 'tool_use') {
                            onSkillExecutionStart();
                            return;
                        }
                    }
                }
                catch {
                    // The wait-notice trigger must never affect the reply path.
                }
            })();
        }
        try {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() <= deadline) {
                const session = await llmExecutor.getSession(sessionId);
                const result = session?.result;
                if (result) {
                    if (result.status === 'completed') {
                        const parsed = parseRunnerOutput(result.output);
                        if (parsed.state !== 'skip') {
                            stickyRuntime.onSuccess(resolved.runtime.id);
                            pollDeadlineTracker.reset(resolved.runtime.id);
                            return { result: parsed, bindingId: resolved.bindingId };
                        }
                        excludeRuntimeIds.add(resolved.runtime.id);
                        stickyRuntime.onFailure(resolved.runtime.id);
                        if (shouldMarkRuntimeUnavailable) {
                            await resolver.markRuntimeUnavailable(resolved.runtime.id, 'LLM runtime completed without returning output.').catch(() => { });
                        }
                        return null;
                    }
                    excludeRuntimeIds.add(resolved.runtime.id);
                    stickyRuntime.onFailure(resolved.runtime.id);
                    if (shouldMarkRuntimeUnavailable) {
                        await resolver.markRuntimeUnavailable(resolved.runtime.id, result.error || `LLM runtime ended with status ${result.status}.`).catch(() => { });
                    }
                    return null;
                }
                await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
            }
            excludeRuntimeIds.add(resolved.runtime.id);
            stickyRuntime.onFailure(resolved.runtime.id);
            // A session that hangs until the poll deadline is usually a cold start,
            // not a dead runtime (spec R6): the first consecutive deadline excludes
            // the runtime for this turn and clears the sticky preference, but only
            // the SECOND consecutive deadline marks it unavailable.
            if (pollDeadlineTracker.recordTimeout(resolved.runtime.id) >= 2) {
                await resolver.markRuntimeUnavailable(resolved.runtime.id, 'LLM runtime timed out while running chat reply.').catch(() => { });
            }
            return null;
        }
        finally {
            attemptActive = false;
        }
    }
    catch {
        stickyRuntime.onFailure(resolved.runtime.id);
        if (!excludeRuntimeIds.has(resolved.runtime.id)) {
            excludeRuntimeIds.add(resolved.runtime.id);
            if (shouldMarkRuntimeUnavailable) {
                await resolver.markRuntimeUnavailable(resolved.runtime.id, 'LLM runtime failed while running chat reply.').catch(() => { });
            }
        }
        return null;
    }
}
function createHostLlmChatReplyRunner(options) {
    const runtimeResolver = options?.runtimeResolver;
    const llmExecutor = options?.llmExecutor;
    const metaBotSlug = options?.metaBotSlug;
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const allowedChatSkillsResolver = options?.allowedChatSkillsResolver;
    const chatWorkspaceDir = normalizeText(options?.chatWorkspaceDir);
    const logWarning = options?.logWarning;
    const allowTemplateFallback = options?.allowTemplateFallback ?? true;
    const fallbackRunner = (0, defaultChatReplyRunner_1.createDefaultChatReplyRunner)();
    // Remember the runtime that produced the last successful reply and try it
    // first on the next turn; a failure clears the preference immediately. The
    // runner instance is cached per profile, so this survives across turns.
    let lastSuccessfulRuntimeId = null;
    const stickyRuntime = {
        get: () => lastSuccessfulRuntimeId,
        onSuccess: (runtimeId) => {
            lastSuccessfulRuntimeId = runtimeId;
        },
        onFailure: (runtimeId) => {
            if (lastSuccessfulRuntimeId === runtimeId) {
                lastSuccessfulRuntimeId = null;
            }
        },
    };
    const consecutivePollDeadlineTimeouts = new Map();
    const pollDeadlineTracker = {
        recordTimeout: (runtimeId) => {
            const count = (consecutivePollDeadlineTimeouts.get(runtimeId) ?? 0) + 1;
            consecutivePollDeadlineTimeouts.set(runtimeId, count);
            return count;
        },
        reset: (runtimeId) => {
            consecutivePollDeadlineTimeouts.delete(runtimeId);
        },
    };
    // If no resolver provided, either fall back to template-only replies or skip.
    if (!runtimeResolver || !llmExecutor) {
        return async (input) => (allowTemplateFallback && !normalizeText(input.operatorGuidanceText)
            ? fallbackRunner(input)
            : { state: 'skip' });
    }
    return async (input) => {
        let allowedSkillScope = (0, privateChatAllowedSkills_1.emptyPrivateChatAllowedSkillScope)();
        if (allowedChatSkillsResolver) {
            try {
                allowedSkillScope = await allowedChatSkillsResolver();
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logWarning?.('[private chat allowed skills]', message);
            }
        }
        const prompt = buildChatPrompt(input, allowedSkillScope, { metaBotSlug });
        const systemPrompt = buildChatSystemPrompt(input);
        const excludeRuntimeIds = new Set();
        const templateFallbackAllowedForTurn = allowTemplateFallback
            && !normalizeText(input.operatorGuidanceText);
        const turnState = { attemptedExecution: false };
        if (chatWorkspaceDir) {
            await node_fs_1.promises.mkdir(chatWorkspaceDir, { recursive: true }).catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                logWarning?.('[private chat workspace]', message);
            });
        }
        // The wait notice goes out at most once per turn, even when several
        // runtime attempts in a row start using tools.
        let skillExecutionStartNotified = false;
        const notifySkillExecutionStart = input.onSkillExecutionStart
            ? () => {
                if (skillExecutionStartNotified)
                    return;
                skillExecutionStartNotified = true;
                try {
                    input.onSkillExecutionStart?.();
                }
                catch {
                    // The wait-notice trigger must never break a reply turn.
                }
            }
            : undefined;
        // Try up to MAX_FALLBACK_ATTEMPTS different runtimes.
        for (let attempt = 0; attempt < MAX_FALLBACK_ATTEMPTS; attempt++) {
            const outcome = await tryExecute(runtimeResolver, llmExecutor, metaBotSlug, prompt, systemPrompt, timeoutMs, pollIntervalMs, excludeRuntimeIds, allowedSkillScope, !allowedChatSkillsResolver, stickyRuntime, pollDeadlineTracker, turnState, notifySkillExecutionStart, chatWorkspaceDir || undefined);
            if (outcome) {
                // Track lastUsedAt on the binding that was successfully used.
                if (outcome.bindingId) {
                    runtimeResolver.markBindingUsed(outcome.bindingId).catch(() => { });
                }
                return outcome.result;
            }
        }
        // No runtime could even be attempted this turn (nothing selectable): ask
        // the availability recovery loop to re-probe this profile's runtimes
        // (fire-and-forget, spec R5), then fall back exactly as before.
        if (!turnState.attemptedExecution) {
            try {
                options?.requestAvailabilityRecovery?.({ metaBotSlug });
            }
            catch {
                // Recovery hints must never affect the reply path.
            }
        }
        // All runtimes failed — either fall back to template-only reply or skip.
        return templateFallbackAllowedForTurn ? fallbackRunner(input) : { state: 'skip' };
    };
}
