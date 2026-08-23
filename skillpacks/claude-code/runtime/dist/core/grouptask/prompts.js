"use strict";
/**
 * Group Task prompt builders — the OAC port of IDBots groupTaskPrompts.
 * Pure string assembly: identity block, task header, roster, role playbooks,
 * the volatile turn context (recent transcript window + target message), and
 * the host-generated planning directive. The engine feeds the output to the
 * profile's LLM runtime.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GROUP_TASK_CONTEXT_MESSAGE_COUNT = void 0;
exports.buildGroupTaskSystemPrompt = buildGroupTaskSystemPrompt;
exports.buildGroupTaskTurnContext = buildGroupTaskTurnContext;
exports.buildPlanningDirective = buildPlanningDirective;
exports.GROUP_TASK_CONTEXT_MESSAGE_COUNT = 20;
const FIELD_CAP = 200;
function cap(text, max = FIELD_CAP) {
    const value = (text ?? '').trim();
    return value.length > max ? `${value.slice(0, max)}…` : value;
}
function xmlEscape(text) {
    return text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
}
function identityBlock(identity) {
    const lines = ['<metabot_identity>', ` <name>${xmlEscape(identity.name)}</name>`];
    if (identity.globalMetaId)
        lines.push(` <globalmetaid>${xmlEscape(identity.globalMetaId)}</globalmetaid>`);
    if (identity.role)
        lines.push(` <role>${xmlEscape(cap(identity.role, 600))}</role>`);
    if (identity.bio)
        lines.push(` <bio>${xmlEscape(cap(identity.bio, 600))}</bio>`);
    if (identity.soul)
        lines.push(` <soul>${xmlEscape(cap(identity.soul, 600))}</soul>`);
    if (identity.goal)
        lines.push(` <goal>${xmlEscape(cap(identity.goal, 600))}</goal>`);
    lines.push('</metabot_identity>');
    lines.push('<instruction>');
    lines.push('You must strictly adhere to the persona, soul, and bio defined in the <metabot_identity> block above for all responses in this session.');
    lines.push('</instruction>');
    return lines.join('\n');
}
const SHARED_PLAYBOOK = [
    '- One group = one task. Everything you say here serves this single task; no small talk.',
    "- Always reply in the OWNER'S LANGUAGE (the language of the task goal), regardless of the language teammates use.",
    '- Speak only when addressed or when you have something material to add; silence is acceptable and often correct.',
    '- Be concise. Group messages are on-chain pins — every byte costs; no filler, no restating what others just said.',
    '- Use @Name only for real handoffs that require that specific member to act.',
    '- Report results with [DELIVERABLE] — exactly one deliverable per line, the line containing the URI (metafile://…, metaapp://…, https://…) or the result text itself.',
    '- Never fabricate a pinid, txid, URL, or file. If you did not produce it, do not cite it.',
    '- If a message needs no reply from you, respond with exactly [NO_REPLY] and nothing else.',
];
const CHAIR_PLAYBOOK = [
    "- You chair this task as the owner's digital twin / chief of staff. You COORDINATE; you never execute the work yourself.",
    '- In planning: break the goal into assignments, @ each worker with a clear scope, put [STANDBY] observers on notice, then end your plan message with [STATUS:EXECUTING].',
    '- Verify every [DELIVERABLE] before treating it as done: check the URI exists and matches the claim. Acknowledge accepted work briefly.',
    '- Drive the lifecycle yourself: emit [STATUS:EXECUTING] to start work and [STATUS:REVIEW] when the acceptance criteria are met. Do not wait to be asked.',
    '- Sequence dependent work with [DEPENDS_ON: <pinid>] on the dispatch message that must wait.',
    '- Disclose every plan deviation with [PLAN_CHANGE: original -> blocked -> switched] on one line.',
    '- When only the owner can decide (budget, scope, irreversible actions), open [CHECKPOINT: <topic>] and wait. After the owner answers, emit [CHECKPOINT_RESOLVED: <decision>] to resume.',
    '- After [STATUS:REVIEW], the floor is closed: only answer the owner.',
    "- Never disclose the owner's private data into the group.",
];
const WORKER_PLAYBOOK = [
    '- Respond only when the chair (or the owner) @-mentions you; the chair coordinates the task.',
    '- On assignment: acknowledge with [WORKING] <what you are doing, optional ETA like "30 min">, then DO THE WORK NOW and report the result — never only promise.',
    '- Report each result on its own line with [DELIVERABLE]; include the real URI or the result text.',
    '- @ the chair only when you are blocked or done.',
    '- Not assigned anything? Reply [STANDBY] once, then stay silent.',
    '- After the chair posts [STATUS:REVIEW], stay silent (no goodbye messages).',
];
/** Assemble the full system prompt for one chair/worker seat. */
function buildGroupTaskSystemPrompt(input) {
    const sections = [identityBlock(input.identity)];
    sections.push([
        '## Group Task',
        `- Title: ${input.task.title}`,
        `- Goal: ${input.task.goal}`,
        `- Acceptance criteria: ${input.task.acceptanceCriteria?.trim() || '(none specified)'}`,
    ].join('\n'));
    const ownerSuffix = input.ownerGlobalMetaId ? `, globalMetaId \`${input.ownerGlobalMetaId}\`` : '';
    sections.push([
        '## Group task environment',
        `- You are in a GROUP TASK: a dedicated on-chain group chat whose only purpose is completing the task above. The initiator and final acceptor is the OWNER (a human${ownerSuffix}). ${input.chairName} (the owner's digital twin) chairs the task.`,
        '- All messages here are on-chain pins (MetaWeb) — a pinid is exactly 64 lowercase hex chars + `i0`; a buzz is a `/protocols/simplebuzz` post.',
    ].join('\n'));
    const roster = input.seats.map((seat) => `- ${seat.name} (${seat.role}${seat.remote ? ', remote teammate via OpenTeam' : ''})`);
    sections.push(['## Roster', ...roster].join('\n'));
    const profiles = input.seats
        .filter((seat) => seat.roleText || seat.bio || seat.goal)
        .map((seat) => {
        const parts = [];
        if (seat.roleText)
            parts.push(`Role: ${cap(seat.roleText)}`);
        if (seat.bio)
            parts.push(`Bio: ${cap(seat.bio)}`);
        if (seat.goal)
            parts.push(`Goal: ${cap(seat.goal)}`);
        return `- ${seat.name} (${seat.role}) — ${parts.join('; ')}`;
    });
    if (profiles.length > 0) {
        sections.push(['## Roster profiles', ...profiles].join('\n'));
    }
    sections.push([
        '## Your Role',
        `You are ${input.identity.name}, a MetaBot participating in an on-chain group task. `
            + `You are the ${input.role} of this task group.`,
    ].join('\n'));
    const playbook = input.role === 'chair'
        ? [...SHARED_PLAYBOOK, ...CHAIR_PLAYBOOK]
        : [...SHARED_PLAYBOOK, ...WORKER_PLAYBOOK];
    sections.push(['## Group Task Playbook', ...playbook].join('\n'));
    return sections.join('\n\n');
}
function transcriptLine(message) {
    const name = message.senderName?.trim() || message.senderGlobalMetaId || 'unknown';
    const suspect = message.senderSuspect ? ' [SUSPECT]' : '';
    const body = message.content.replace(/\s*\n\s*/gu, ' ').trim();
    return `${name}${suspect}: ${body}`;
}
function currentTimeLine(nowMs) {
    const date = new Date(nowMs);
    const pad = (part) => String(part).padStart(2, '0');
    const offsetMinutes = -date.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const offsetHours = Math.abs(Math.trunc(offsetMinutes / 60));
    const weekday = date.toLocaleDateString('en-US', { weekday: 'long' });
    const month = date.toLocaleDateString('en-US', { month: 'long' });
    return `Current time: ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
        + `${pad(date.getHours())}:${pad(date.getMinutes())} (UTC${sign}${offsetHours}); `
        + `today is ${weekday}, ${month} ${date.getDate()}, ${date.getFullYear()}.`;
}
/** Build the user-message context for a reply turn. */
function buildGroupTaskTurnContext(input) {
    const count = input.contextMessageCount ?? exports.GROUP_TASK_CONTEXT_MESSAGE_COUNT;
    const window = input.recentMessages.slice(-count);
    const lines = [currentTimeLine(input.nowMs ?? Date.now()), ''];
    for (const note of input.notes ?? []) {
        lines.push(note, '');
    }
    lines.push(`[Group Task "${input.task.title}" (#${input.task.id}) — recent group log (last ${window.length} messages)]`);
    for (const message of window) {
        lines.push(transcriptLine(message));
    }
    if (input.target) {
        lines.push('', `>>> ${transcriptLine(input.target)} <<< (the message you are responding to)`);
    }
    return lines.join('\n');
}
/**
 * The one-shot planning instruction: distribute the work and end with
 * [STATUS:EXECUTING]. Does not consume the reply budget or cooldowns.
 */
function buildPlanningDirective(input) {
    const roster = input.seats
        .map((seat) => `- ${seat.name} (${seat.role}${seat.remote ? ', remote teammate via OpenTeam' : ''})`)
        .join('\n');
    const directive = [
        '[SYSTEM planning directive — generated by the host, not by a group participant]',
        'The task is in PLANNING. As the chair, post ONE planning message that:',
        '(a) restates the goal in one line;',
        '(b) breaks it into concrete assignments and @-mentions each assigned worker with a clear scope;',
        '(c) puts unassigned members on notice with [STANDBY];',
        '(d) sequences dependent steps with [DEPENDS_ON: <pinid>] where a step must wait for a prior deliverable;',
        '(e) opens a [CHECKPOINT: <topic>] ONLY if the acceptance criteria explicitly require an owner decision first;',
        '(f) states the acceptance criteria the deliverables must meet;',
        '(g) ends with [STATUS:EXECUTING] on the final line.',
        '',
        'Full roster:',
        roster,
    ].join('\n');
    return `${directive}\n\n${buildGroupTaskTurnContext({
        task: input.task,
        recentMessages: input.recentMessages,
        target: null,
        nowMs: input.nowMs,
    })}`;
}
