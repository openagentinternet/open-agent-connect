/**
 * Group Task prompt builders — the OAC port of IDBots groupTaskPrompts.
 * Pure string assembly: identity block, task header, roster, role playbooks,
 * the volatile turn context (recent transcript window + target message), and
 * the host-generated planning directive. The engine feeds the output to the
 * profile's LLM runtime.
 */

import type { GroupTaskMessage, GroupTaskRecord } from './types';

export const GROUP_TASK_CONTEXT_MESSAGE_COUNT = 20;

export interface GroupTaskPromptIdentity {
  name: string;
  globalMetaId?: string | null;
  role?: string | null;
  bio?: string | null;
  soul?: string | null;
  goal?: string | null;
}

export interface GroupTaskPromptSeat {
  name: string;
  role: 'chair' | 'worker';
  remote: boolean;
  /** Optional profile fields for the roster-profiles section (capped 200). */
  roleText?: string | null;
  bio?: string | null;
  goal?: string | null;
}

export interface BuildGroupTaskSystemPromptInput {
  identity: GroupTaskPromptIdentity;
  task: Pick<GroupTaskRecord, 'title' | 'goal' | 'acceptanceCriteria'>;
  seats: GroupTaskPromptSeat[];
  chairName: string;
  ownerGlobalMetaId?: string | null;
  role: 'chair' | 'worker';
}

const FIELD_CAP = 200;

function cap(text: string | null | undefined, max = FIELD_CAP): string {
  const value = (text ?? '').trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function xmlEscape(text: string): string {
  return text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
}

function identityBlock(identity: GroupTaskPromptIdentity): string {
  const lines = ['<metabot_identity>', ` <name>${xmlEscape(identity.name)}</name>`];
  if (identity.globalMetaId) lines.push(` <globalmetaid>${xmlEscape(identity.globalMetaId)}</globalmetaid>`);
  if (identity.role) lines.push(` <role>${xmlEscape(cap(identity.role, 600))}</role>`);
  if (identity.bio) lines.push(` <bio>${xmlEscape(cap(identity.bio, 600))}</bio>`);
  if (identity.soul) lines.push(` <soul>${xmlEscape(cap(identity.soul, 600))}</soul>`);
  if (identity.goal) lines.push(` <goal>${xmlEscape(cap(identity.goal, 600))}</goal>`);
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
  '- Report results with [DELIVERABLE] — exactly one deliverable per line, the URI matching the content\'s on-chain form: `pin://<pinId>` for readable text documents (publish them as notes, NEVER a file upload), `metaapp://<pinId>` for MetaApps, `metafile://` ONLY for binary files (images, video, audio, PDF, archives), a plain https URL for off-chain previews.',
  '- Never fabricate a pinid, txid, URL, or file. If you did not produce it, do not cite it.',
  '- If a message needs no reply from you, respond with exactly [NO_REPLY] and nothing else.',
] as const;

const CHAIR_PLAYBOOK = [
  "- You chair this task as the owner's digital twin / chief of staff. You COORDINATE; you never execute the work yourself.",
  '- In planning: break the goal into assignments, @ each worker with a clear scope, put [STANDBY] observers on notice, then end your plan message with [STATUS:EXECUTING].',
  '- Verify every [DELIVERABLE] before treating it as done: check the URI exists and matches the claim. Acknowledge accepted work briefly.',
  '- SERVE THE DISH: the owner must be able to verify the result by CLICKING a link in the UI — never by downloading files or running anything locally. App-type work delivers a PUBLISHED `metaapp://` link (publishing the app is part of the task, never deferred to the owner); text deliverables are `pin://` notes; `metafile://` is only for binaries. Hold every [DELIVERABLE] to this bar before emitting [STATUS:REVIEW].',
  '- Present every final deliverable to the owner as a full-text markdown link with its complete MetaWeb URI, never abbreviated with an ellipsis: delivering the result the owner can open IS the point of the task. Lead reports with the conclusion and the action already taken — the owner only confirms or redirects.',
  '- Drive the lifecycle yourself: emit [STATUS:EXECUTING] to start work and [STATUS:REVIEW] when the acceptance criteria are met. Do not wait to be asked.',
  '- Emit status tags only at a line start or the very end of the message — never inside prose; a mentioned-but-not-emitted [STATUS:…] is ignored by the host.',
  '- Sequence dependent work with [DEPENDS_ON: <pinid>] on the dispatch message that must wait.',
  '- Disclose every plan deviation with [PLAN_CHANGE: original -> blocked -> switched] on one line.',
  '- When only the owner can decide (budget, scope, irreversible actions), open [CHECKPOINT: <topic>] and wait. After the owner answers, emit [CHECKPOINT_RESOLVED: <decision>] to resume.',
  '- After [STATUS:REVIEW], the floor is closed: only answer the owner.',
  "- Never disclose the owner's private data into the group.",
] as const;

const WORKER_PLAYBOOK = [
  '- Respond only when the chair (or the owner) @-mentions you; the chair coordinates the task.',
  '- On assignment: acknowledge with [WORKING] <what you are doing, optional ETA like "30 min">, then DO THE WORK NOW and report the result — never only promise.',
  '- Report each result on its own line with [DELIVERABLE]; the URI must be the owner-clickable on-chain form — `metaapp://` for a finished app (publish it; a raw source file the owner must download and open locally is NOT a delivered result), `pin://` for text documents, `metafile://` only for binaries.',
  '- @ the chair only when you are blocked or done.',
  '- Not assigned anything? Reply [STANDBY] once, then stay silent.',
  '- After the chair posts [STATUS:REVIEW], stay silent (no goodbye messages).',
] as const;

/** Assemble the full system prompt for one chair/worker seat. */
export function buildGroupTaskSystemPrompt(input: BuildGroupTaskSystemPromptInput): string {
  const sections: string[] = [identityBlock(input.identity)];

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

  const roster = input.seats.map((seat) =>
    `- ${seat.name} (${seat.role}${seat.remote ? ', remote teammate via OpenTeam' : ''})`);
  sections.push(['## Roster', ...roster].join('\n'));

  const profiles = input.seats
    .filter((seat) => seat.roleText || seat.bio || seat.goal)
    .map((seat) => {
      const parts: string[] = [];
      if (seat.roleText) parts.push(`Role: ${cap(seat.roleText)}`);
      if (seat.bio) parts.push(`Bio: ${cap(seat.bio)}`);
      if (seat.goal) parts.push(`Goal: ${cap(seat.goal)}`);
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

// ---------------------------------------------------------------------------
// Volatile turn context
// ---------------------------------------------------------------------------

export interface BuildGroupTaskTurnContextInput {
  task: Pick<GroupTaskRecord, 'id' | 'title'>;
  /** Recent transcript, oldest first (already truncated by the caller). */
  recentMessages: GroupTaskMessage[];
  /** The message this turn responds to (null for host-directed turns). */
  target: GroupTaskMessage | null;
  /** Optional host-side notes (deliverable verification results etc.). */
  notes?: string[];
  nowMs?: number;
  contextMessageCount?: number;
}

function transcriptLine(message: GroupTaskMessage): string {
  const name = message.senderName?.trim() || message.senderGlobalMetaId || 'unknown';
  const suspect = message.senderSuspect ? ' [SUSPECT]' : '';
  const body = message.content.replace(/\s*\n\s*/gu, ' ').trim();
  return `${name}${suspect}: ${body}`;
}

function currentTimeLine(nowMs: number): string {
  const date = new Date(nowMs);
  const pad = (part: number): string => String(part).padStart(2, '0');
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
export function buildGroupTaskTurnContext(input: BuildGroupTaskTurnContextInput): string {
  const count = input.contextMessageCount ?? GROUP_TASK_CONTEXT_MESSAGE_COUNT;
  const window = input.recentMessages.slice(-count);
  const lines: string[] = [currentTimeLine(input.nowMs ?? Date.now()), ''];
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

// ---------------------------------------------------------------------------
// Planning directive (host-generated chair turn, planning status only)
// ---------------------------------------------------------------------------

export interface BuildPlanningDirectiveInput {
  task: Pick<GroupTaskRecord, 'id' | 'title' | 'goal' | 'acceptanceCriteria'>;
  seats: GroupTaskPromptSeat[];
  recentMessages: GroupTaskMessage[];
  nowMs?: number;
}

/**
 * The one-shot planning instruction: distribute the work and end with
 * [STATUS:EXECUTING]. Does not consume the reply budget or cooldowns.
 */
export function buildPlanningDirective(input: BuildPlanningDirectiveInput): string {
  const roster = input.seats
    .map((seat) => `- ${seat.name} (${seat.role}${seat.remote ? ', remote teammate via OpenTeam' : ''})`)
    .join('\n');
  const directive = [
    '[SYSTEM planning directive — generated by the host, not by a group participant]',
    'The task is in PLANNING. As the chair, post ONE planning message that:',
    '(a) restates the goal in one line;',
    '(b) breaks it into concrete assignments and @-mentions each assigned worker with a clear scope and the expected deliverable form — owner-clickable on-chain URIs: `metaapp://` for app work (publishing is part of the task), `pin://` for text documents, `metafile://` only for binaries;',
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

// ---------------------------------------------------------------------------
// Roster-change directive (host-generated chair wake after an OpenTeam join)
// ---------------------------------------------------------------------------

export interface BuildRosterChangeDirectiveInput {
  task: Pick<GroupTaskRecord, 'id' | 'title' | 'goal' | 'acceptanceCriteria'>;
  joinedName: string;
  joinedSkills: string[];
  seats: GroupTaskPromptSeat[];
  recentMessages: GroupTaskMessage[];
  nowMs?: number;
}

/**
 * Wake-up instruction when a remote member joined after the plan was posted
 * (the planning turn raced the OpenTeam accepts, or someone joined mid-task).
 * The chair must reconcile the plan with the current roster in one message.
 */
export function buildRosterChangeDirective(input: BuildRosterChangeDirectiveInput): string {
  const roster = input.seats
    .map((seat) => `- ${seat.name} (${seat.role}${seat.remote ? ', remote teammate via OpenTeam' : ''})`)
    .join('\n');
  const skills = input.joinedSkills.length > 0 ? ` (skills: ${input.joinedSkills.join(', ')})` : '';
  const directive = [
    '[SYSTEM roster change — generated by the host, not by a group participant]',
    `Remote OpenTeam member "${input.joinedName}"${skills} joined AFTER the plan was posted. As the chair, post ONE message that:`,
    `(a) reconciles the plan with the current roster: @-mention the workers that should now take work, with concrete scope, expected [DELIVERABLE] lines, and the owner-clickable URI form (metaapp:// for apps, pin:// for text, metafile:// only for binaries);`,
    `(b) either folds ${input.joinedName} into the work or explicitly states why the current plan already covers their seat;`,
    '(c) never silently ignores the new member;',
    `(d) ends with [STATUS:EXECUTING] on its own final line (status tags only on their own line — never inside prose).`,
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

// ---------------------------------------------------------------------------
// Supervisor wake directives (owner nudge / resume, host-generated chair turn)
// ---------------------------------------------------------------------------

export interface BuildSupervisorWakeDirectiveInput {
  task: Pick<GroupTaskRecord, 'id' | 'title'>;
  kind: 'nudge' | 'resume';
  memberName: string | null;
  memberNote: string | null;
  recentMessages: GroupTaskMessage[];
  nowMs?: number;
}

/**
 * One-shot chair instruction after an owner supervise action: nudge a silent
 * member for an ACK/status, or re-engage the roster after a dispatch pause.
 */
export function buildSupervisorWakeDirective(input: BuildSupervisorWakeDirectiveInput): string {
  const lines = input.kind === 'nudge'
    ? [
      '[SYSTEM supervisor wake — generated by the host, not by a group participant]',
      `The owner nudged this task${input.memberName ? `: member "${input.memberName}" has gone quiet` : ''}. `
        + 'As the chair, post ONE short message that @-mentions the member, asks for a concrete '
        + 'status/ACK on their assignment, and restates what they owe (scope + expected [DELIVERABLE] form).',
      ...(input.memberNote ? [`Owner note: ${input.memberNote}`] : []),
    ]
    : [
      '[SYSTEM supervisor wake — generated by the host, not by a group participant]',
      'The owner RESUMED this task after a dispatch pause. As the chair, post ONE message that '
        + 're-engages the roster: confirm what was already delivered, @-mention each worker with their '
        + 'next concrete step (or [STANDBY] if their part is done), and keep the momentum.',
      ...(input.memberNote ? [`Owner note: ${input.memberNote}`] : []),
    ];
  lines.push('(End with [STATUS:EXECUTING] on its own final line.)');
  return `${lines.join('\n')}\n\n${buildGroupTaskTurnContext({
    task: input.task,
    recentMessages: input.recentMessages,
    target: null,
    nowMs: input.nowMs,
  })}`;
}
