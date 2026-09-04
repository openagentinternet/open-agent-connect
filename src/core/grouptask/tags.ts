/**
 * Group Task tag grammar + turn-taking decisions — pure functions ported from
 * the proven IDBots engine (groupTaskDeliverableParser / mention utils /
 * decideGroupTaskResponders). No IO here: the engine module wires these to the
 * store and the chain.
 *
 * Tag emitters: chair-only tags are [STATUS:...], [CHECKPOINT:...],
 * [CHECKPOINT_RESOLVED...], [PLAN_CHANGE:...]; worker tags are [DELIVERABLE],
 * [WORKING], [STANDBY]; [NO_REPLY] is an LLM-output escape hatch (never sent
 * on-chain); [DEPENDS_ON:...] rides on chair dispatch messages.
 */

import type { GroupTaskMessage, GroupTaskStatus } from './types';

// ---------------------------------------------------------------------------
// Tag regexes (exact IDBots grammar)
// ---------------------------------------------------------------------------

export const DELIVERABLE_TAG = /\[DELIVERABLE\]/i;
export const STATUS_TAG = /\[STATUS:\s*(EXECUTING|REVIEW)\s*\]/i;
/**
 * Status tags move the task only from protocol positions: a line START, or
 * the tail of the FINAL line (the IDBots status_parser discipline). The last
 * honored position wins, so a prose mention like "→ 汇总 [STATUS:REVIEW]"
 * (mid-text, real tag on the final line) can never transition the task —
 * that exact pattern sent a live task to review before any work started.
 */
const STATUS_LINE_START_TAG = /^\s*\[STATUS:\s*(EXECUTING|REVIEW)\s*\]/i;
const STATUS_LINE_TAIL_TAG = /\[STATUS:\s*(EXECUTING|REVIEW)\s*\]\s*$/i;
export const CHECKPOINT_OPEN_TAG = /\[CHECKPOINT:\s*([^\]\n]+?)\s*\]/i;
export const CHECKPOINT_RESOLVED_TAG = /\[CHECKPOINT_RESOLVED(?::\s*([^\]\n]+?)\s*)?\]/i;
export const PLAN_CHANGE_TAG = /\[PLAN_CHANGE:\s*([^\]\n]+?)\s*\]/gi;
/** Must START the LLM reply to suppress the on-chain send. */
export const NO_REPLY_TAG = /^\[NO_REPLY\]/i;
export const WORKING_TAG = /\[WORKING\]/i;
export const STANDBY_TAG = /\[STANDBY\]/i;
export const DEPENDS_ON_TAG = /\[DEPENDS_ON:\s*([^\]]+)\]/i;
/** Strips every checkpoint-family tag for display summaries. */
export const CHECKPOINT_ANY_TAG = /\[CHECKPOINT(?:_[A-Z]+)?(?::[^\]]*)?\]/gi;
/** Host-generated notice prefix (welcome / pause / resume / review lines). */
export const HOST_NOTICE_PREFIX = '[GROUP_TASK_NOTICE:';

const PIN_ID_RE = /^[0-9a-f]{64}i\d+$/u;
const TXID_RE = /^[0-9a-f]{64}$/u;
const PLAN_CHANGE_MAX_CHARS = 240;
const WORKING_NOTE_MAX_CHARS = 120;

// ---------------------------------------------------------------------------
// Parsed shapes
// ---------------------------------------------------------------------------

export type GroupTaskDeliverableKind = 'metaapp' | 'metafile' | 'link' | 'pin' | 'text';

export interface GroupTaskDeliverableCandidate {
  kind: GroupTaskDeliverableKind;
  /** Canonical uri (null for text deliverables). */
  uri: string | null;
  /** Raw payload text after the tag on that line. */
  payload: string;
  /** True when the payload announces a correction of a previous deliverable. */
  correction: boolean;
}

export interface GroupTaskWorkingAck {
  /** Free-text note after the tag, capped at 120 chars. */
  note: string;
  /** Optional ETA in minutes ("30 分钟" / "30 min"), null when absent. */
  etaMinutes: number | null;
}

export interface ParsedGroupTaskTags {
  deliverables: GroupTaskDeliverableCandidate[];
  /** Lowercased [STATUS:...] target, null when absent. */
  status: 'executing' | 'review' | null;
  /** [CHECKPOINT: topic] topic, null when absent. */
  checkpointTopic: string | null;
  checkpointResolved: boolean;
  /** Decision text of [CHECKPOINT_RESOLVED: decision], null when bare/absent. */
  checkpointDecision: string | null;
  /** One-line [PLAN_CHANGE: ...] disclosures, capped at 240 chars each. */
  planChanges: string[];
  working: GroupTaskWorkingAck | null;
  standby: boolean;
  /** [DEPENDS_ON: token] token, null when absent. */
  dependsOn: string | null;
}

// ---------------------------------------------------------------------------
// Deliverable parsing (line-scoped, strict URI rules)
// ---------------------------------------------------------------------------

const CORRECTION_RE = /更正|修正|纠正|勘误|correction|corrected|revise[ds]?\b/iu;
const URI_TOKEN_RE = /(metaapp:\/\/\S+|metafile:\/\/\S+|https?:\/\/\S+|\b[0-9a-f]{64}i\d+\b)/giu;

function trimTrailingPunctuation(token: string): string {
  return token.replace(/[)\].,;:!?、。》】]+$/u, '');
}

/**
 * Validate one URI-like token. Returns the canonical {kind, uri} or null when
 * the token is a fabrication (bad hex, placeholder, hostless URL).
 */
function classifyUriToken(raw: string): { kind: GroupTaskDeliverableKind; uri: string } | null {
  const token = trimTrailingPunctuation(raw.trim());
  if (!token || token.includes('…') || token.includes('...')) return null;
  const lower = token.toLowerCase();
  if (lower.startsWith('metaapp://')) {
    const id = lower.slice('metaapp://'.length);
    return PIN_ID_RE.test(id) ? { kind: 'metaapp', uri: `metaapp://${id}` } : null;
  }
  if (lower.startsWith('metafile://')) {
    const id = lower.slice('metafile://'.length);
    return PIN_ID_RE.test(id) ? { kind: 'metafile', uri: `metafile://${id}` } : null;
  }
  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    try {
      const url = new URL(token);
      return url.hostname ? { kind: 'link', uri: token } : null;
    } catch {
      return null;
    }
  }
  if (PIN_ID_RE.test(lower)) return { kind: 'pin', uri: lower };
  return null;
}

/**
 * Extract deliverable candidates from a message. Line-scoped: each line
 * containing [DELIVERABLE] yields one candidate per tag occurrence, its
 * payload being the text after that tag. Lines with a URI-shaped token that
 * fails validation are dropped (fabrication guard); URI-free payloads become
 * text deliverables.
 */
export function parseDeliverableCandidates(content: string): GroupTaskDeliverableCandidate[] {
  const candidates: GroupTaskDeliverableCandidate[] = [];
  for (const line of content.split(/\r?\n/u)) {
    if (!DELIVERABLE_TAG.test(line)) continue;
    const segments = line.split(/\[DELIVERABLE\]/iu).slice(1);
    for (const segment of segments) {
      const payload = segment.trim();
      if (!payload) continue;
      const correction = CORRECTION_RE.test(line);
      URI_TOKEN_RE.lastIndex = 0;
      const uriTokens = payload.match(URI_TOKEN_RE) ?? [];
      if (uriTokens.length === 0) {
        candidates.push({ kind: 'text', uri: null, payload, correction });
        continue;
      }
      const classified = classifyUriToken(uriTokens[0]!);
      if (!classified) continue;
      candidates.push({ kind: classified.kind, uri: classified.uri, payload, correction });
    }
  }
  return candidates;
}

/** Parse a [WORKING] acknowledgement: note after the tag + optional ETA. */
export function parseWorkingAck(content: string): GroupTaskWorkingAck | null {
  const match = content.match(/\[WORKING\]\s*([^\n]*)/iu);
  if (!match) return null;
  const note = (match[1] ?? '').trim().slice(0, WORKING_NOTE_MAX_CHARS);
  const eta = note.match(/(\d{1,4})\s*(?:分钟|min(?:ute)?s?\b)/iu);
  const etaMinutes = eta ? Math.max(1, Number.parseInt(eta[1]!, 10)) : null;
  return { note, etaMinutes: Number.isFinite(etaMinutes as number) ? etaMinutes : null };
}

/**
 * The last protocol-position [STATUS:…] tag in the body: line-start anywhere,
 * or the tail of the final line. Null when none.
 */
function lastHonoredStatusTag(content: string): RegExpExecArray | null {
  const lines = content.split(/\r?\n/);
  let best: { exec: RegExpExecArray; index: number } | null = null;
  let offset = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const isFinalLine = i === lines.length - 1;
    const startMatch = STATUS_LINE_START_TAG.exec(line);
    const tailMatch = isFinalLine ? STATUS_LINE_TAIL_TAG.exec(line) : null;
    const candidate = (tailMatch && (!startMatch || tailMatch.index >= startMatch.index))
      ? tailMatch
      : startMatch;
    if (candidate) best = { exec: candidate, index: offset + candidate.index };
    offset += line.length + 1;
  }
  return best?.exec ?? null;
}

/** Parse every engine-relevant tag of one message body. */
export function parseGroupTaskTags(content: string): ParsedGroupTaskTags {
  const statusMatch = lastHonoredStatusTag(content);
  const checkpointMatch = content.match(CHECKPOINT_OPEN_TAG);
  const resolvedMatch = content.match(CHECKPOINT_RESOLVED_TAG);
  const dependsMatch = content.match(DEPENDS_ON_TAG);

  const planChanges: string[] = [];
  PLAN_CHANGE_TAG.lastIndex = 0;
  for (const match of content.matchAll(PLAN_CHANGE_TAG)) {
    const line = (match[1] ?? '').trim().slice(0, PLAN_CHANGE_MAX_CHARS);
    if (line && !planChanges.includes(line)) planChanges.push(line);
  }

  return {
    deliverables: parseDeliverableCandidates(content),
    status: statusMatch ? (statusMatch[1]!.toLowerCase() as 'executing' | 'review') : null,
    checkpointTopic: checkpointMatch ? checkpointMatch[1]!.trim() : null,
    checkpointResolved: resolvedMatch !== null,
    checkpointDecision: resolvedMatch?.[1]?.trim() || null,
    planChanges,
    working: parseWorkingAck(content),
    standby: STANDBY_TAG.test(content),
    dependsOn: dependsMatch ? dependsMatch[1]!.trim() : null,
  };
}

/** True when an LLM reply opted out of speaking ([NO_REPLY] at line start). */
export function isNoReplyResponse(reply: string): boolean {
  return NO_REPLY_TAG.test(reply.trim());
}

/** True for host-generated notice lines (never trigger engine replies). */
export function isHostNotice(content: string): boolean {
  return content.trimStart().startsWith(HOST_NOTICE_PREFIX);
}

/** [DEPENDS_ON] token is enforceable only when it names a pin or txid. */
export function isEnforceableDependencyToken(token: string): boolean {
  const lower = token.trim().toLowerCase();
  return PIN_ID_RE.test(lower) || TXID_RE.test(lower);
}

// ---------------------------------------------------------------------------
// Mentions
// ---------------------------------------------------------------------------

export interface GroupTaskMentionTarget {
  name: string;
  globalMetaId: string | null;
  metaId?: string | null;
}

function normalizeId(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * A bot is mentioned when the message mention array carries its
 * GlobalMetaID/MetaID, or the body contains an explicit `@Name` with word
 * boundaries (a bare name without `@` does not count).
 */
export function isMentioned(
  message: Pick<GroupTaskMessage, 'content' | 'mention'>,
  target: GroupTaskMentionTarget,
): boolean {
  const gmid = normalizeId(target.globalMetaId);
  const metaId = normalizeId(target.metaId);
  for (const entry of message.mention ?? []) {
    const id = normalizeId(entry);
    if (id && (id === gmid || (metaId && id === metaId))) return true;
  }
  const name = target.name.trim();
  if (!name) return false;
  const pattern = new RegExp(`@${escapeRegExp(name)}(?![\\w\\p{Script=Han}])`, 'iu');
  return pattern.test(message.content);
}

// ---------------------------------------------------------------------------
// Turn-taking decision
// ---------------------------------------------------------------------------

export type GroupTaskReplyReason =
  | 'worker_mentioned'
  | 'chair_mentioned'
  | 'chair_owner_message'
  | 'chair_deliverable'
  | 'chair_floor_control';

export interface GroupTaskResponderSeat {
  /** Local profile slug; remote members are never responders. */
  slug: string;
  role: 'chair' | 'worker';
  name: string;
  globalMetaId: string | null;
  metaId?: string | null;
}

export interface GroupTaskResponderDecision {
  slug: string;
  role: 'chair' | 'worker';
  reason: GroupTaskReplyReason;
}

export interface DecideRespondersInput {
  message: Pick<GroupTaskMessage, 'content' | 'mention' | 'senderGlobalMetaId' | 'senderSuspect'>;
  taskStatus: GroupTaskStatus;
  hasOpenCheckpoint: boolean;
  /** Active local seats only (removed and remote members excluded). */
  seats: GroupTaskResponderSeat[];
  ownerGlobalMetaId: string | null;
}

/**
 * Decide which local seats reply to one inbound message (IDBots
 * decideGroupTaskResponders semantics):
 * - never: empty body, terminal task, suspect sender, self, host notices;
 * - human-gate (review OR open checkpoint): workers silent even when
 *   mentioned; chair answers the owner only;
 * - normal: workers only when mentioned; chair by mention > owner message >
 *   [DELIVERABLE] > floor control (only when nobody specific was addressed).
 */
export function decideGroupTaskResponders(input: DecideRespondersInput): GroupTaskResponderDecision[] {
  const content = input.message.content.trim();
  if (!content || isHostNotice(content)) return [];
  if (input.taskStatus === 'done' || input.taskStatus === 'cancelled') return [];
  if (input.message.senderSuspect) return [];

  const senderGmid = normalizeId(input.message.senderGlobalMetaId);
  const ownerGmid = normalizeId(input.ownerGlobalMetaId);
  const fromOwner = Boolean(ownerGmid) && senderGmid === ownerGmid;
  const humanGate = input.taskStatus === 'review' || input.hasOpenCheckpoint;

  const decisions: GroupTaskResponderDecision[] = [];
  const chair = input.seats.find((seat) => seat.role === 'chair') ?? null;
  const chairIsSender = chair !== null && normalizeId(chair.globalMetaId) === senderGmid;

  let anyoneAddressed = false;
  for (const seat of input.seats) {
    if (normalizeId(seat.globalMetaId) === senderGmid) continue;
    if (!isMentioned(input.message, seat)) continue;
    anyoneAddressed = true;
    if (seat.role === 'worker' && !humanGate) {
      decisions.push({ slug: seat.slug, role: 'worker', reason: 'worker_mentioned' });
    }
  }

  if (chair && !chairIsSender) {
    const chairMentioned = isMentioned(input.message, chair);
    if (humanGate) {
      if (fromOwner) decisions.push({ slug: chair.slug, role: 'chair', reason: 'chair_owner_message' });
    } else if (chairMentioned) {
      decisions.push({ slug: chair.slug, role: 'chair', reason: 'chair_mentioned' });
    } else if (fromOwner) {
      decisions.push({ slug: chair.slug, role: 'chair', reason: 'chair_owner_message' });
    } else if (DELIVERABLE_TAG.test(content)) {
      decisions.push({ slug: chair.slug, role: 'chair', reason: 'chair_deliverable' });
    } else if (!anyoneAddressed) {
      decisions.push({ slug: chair.slug, role: 'chair', reason: 'chair_floor_control' });
    }
  }

  return decisions;
}
