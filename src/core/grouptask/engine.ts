/**
 * Group Task engine — the OAC port of the IDBots groupTaskDaemon: a 5-second
 * tick loop that drives every non-terminal task chaired by a local profile.
 * Per task and per tick it (1) claims the kv driver mutex, (2) stamps the
 * stall heartbeat, (3) syncs the transcript from the chain indexers,
 * (4) runs the one-shot chair planning turn, and (5) processes new messages
 * after the cursor: idempotent tag side effects, then turn-taking LLM replies
 * under cooldowns/budgets. Chain history is the only truth — the engine's own
 * posts are processed when they round-trip through the indexer sync.
 *
 * All seams (profiles, signers, stores, indexer fetch, LLM runner, persona
 * loader, clock) are injected so tests run fully offline.
 */

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { resolveMetabotPaths } from '../state/paths';
import { createGroupTaskStore, type GroupTaskStore } from './store';
import {
  GROUP_TASK_REWORK_AT_KV_PREFIX,
  clearGroupTaskReviewDeliveryGuards,
  postGroupTaskMessage,
  syncGroupTaskMessages,
  type GroupTaskProfileRef,
  type GroupTaskServiceContext,
} from './service';
import {
  decideGroupTaskResponders,
  parseGroupTaskTags,
  isNoReplyResponse,
  type GroupTaskResponderDecision,
  type GroupTaskResponderSeat,
  type ParsedGroupTaskTags,
} from './tags';
import {
  buildGroupTaskSystemPrompt,
  buildGroupTaskTurnContext,
  buildPlanningDirective,
  type GroupTaskPromptSeat,
} from './prompts';
import {
  GROUP_TASK_LEGAL_TRANSITIONS,
  type GroupTaskMember,
  type GroupTaskMessage,
  type GroupTaskRecord,
  type GroupTaskStatus,
} from './types';

// ---------------------------------------------------------------------------
// Constants (IDBots parity)
// ---------------------------------------------------------------------------

export const GROUP_TASK_DRIVER_KV_PREFIX = 'group_task_driver:';
export const GROUP_TASK_PLANNED_KV_PREFIX = 'group_task_chair_planned:';
export const GROUP_TASK_PLAN_ATTEMPTS_KV_PREFIX = 'group_task_chair_plan_attempts:';
export const GROUP_TASK_MSG_RETRY_KV_PREFIX = 'group_task_msg_retry:';
export const GROUP_TASK_REVIEW_SUMMARY_KV_PREFIX = 'group_task_review_summary:';

const DEFAULT_INTERVAL_MS = 5_000;
const MIN_INTERVAL_MS = 1_000;
const DEFAULT_DRIVER_GRACE_MS = 20_000;
const DEFAULT_MAX_WORKER_REPLIES_PER_TICK = 3;
const DEFAULT_WORKER_COOLDOWN_MS = 20_000;
const DEFAULT_CHAIR_COOLDOWN_MS = 10_000;
const DEFAULT_REPLY_BUDGET = 40;
const MSG_RETRY_MAX_FAILURES = 5;
const PLAN_ATTEMPTS_MAX = 3;
const REVIEW_REENTRY_DEBOUNCE_MS = 30_000;
const MESSAGE_FETCH_LIMIT = 500;

const RUNNABLE_STATUSES: ReadonlySet<GroupTaskStatus> = new Set(['planning', 'executing', 'review']);

// ---------------------------------------------------------------------------
// Seams
// ---------------------------------------------------------------------------

export interface GroupTaskLlmTurn {
  profile: GroupTaskProfileRef;
  role: 'chair' | 'worker';
  systemPrompt: string;
  prompt: string;
}

/** Run one LLM turn for a profile; return raw text; throw on runtime failure. */
export type GroupTaskEngineLlmRunner = (turn: GroupTaskLlmTurn) => Promise<string>;

export interface GroupTaskEnginePersona {
  role?: string | null;
  bio?: string | null;
  soul?: string | null;
  goal?: string | null;
}

export type GroupTaskPersonaLoader = (profile: GroupTaskProfileRef) => Promise<GroupTaskEnginePersona>;

export interface GroupTaskEngineOptions {
  ctx: GroupTaskServiceContext;
  runLlmTurn: GroupTaskEngineLlmRunner;
  /** Defaults to reading BIO/SOUL/GOAL/ROLE markdown from the profile home. */
  loadPersona?: GroupTaskPersonaLoader;
  intervalMs?: number;
  driverGraceMs?: number;
  maxWorkerRepliesPerTick?: number;
  workerCooldownMs?: number;
  chairCooldownMs?: number;
  /** Lifetime reply budget per (task, seat) for this engine instance. */
  replyBudget?: number;
  now?: () => number;
}

export interface GroupTaskEngine {
  start(): void;
  stop(): void;
  /** Drive one full tick immediately (used by tests; serialized with timer ticks). */
  tick(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function storeFor(ctx: GroupTaskServiceContext, profile: GroupTaskProfileRef): GroupTaskStore {
  if (ctx.storeForProfile) return ctx.storeForProfile(profile);
  return createGroupTaskStore(resolveMetabotPaths(profile.homeDir));
}

function logOf(ctx: GroupTaskServiceContext): (message: string) => void {
  return ctx.log ?? (() => undefined);
}

function normalizeGmid(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    const text = (await fs.readFile(filePath, 'utf8')).trim();
    return text || null;
  } catch {
    return null;
  }
}

async function defaultPersonaLoader(profile: GroupTaskProfileRef): Promise<GroupTaskEnginePersona> {
  const paths = resolveMetabotPaths(profile.homeDir);
  const [role, bio, soul, goal] = await Promise.all([
    readOptionalFile(paths.roleMdPath),
    readOptionalFile(paths.bioMdPath),
    readOptionalFile(paths.soulMdPath),
    readOptionalFile(paths.goalMdPath),
  ]);
  return { role, bio, soul, goal };
}

interface SeatInfo extends GroupTaskResponderSeat {
  member: GroupTaskMember;
  profile: GroupTaskProfileRef;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export function createGroupTaskEngine(options: GroupTaskEngineOptions): GroupTaskEngine {
  const ctx = options.ctx;
  const log = logOf(ctx);
  const now = options.now ?? (() => Date.now());
  const loadPersona = options.loadPersona ?? defaultPersonaLoader;
  const intervalMs = Math.max(MIN_INTERVAL_MS, options.intervalMs ?? DEFAULT_INTERVAL_MS);
  const driverGraceMs = options.driverGraceMs ?? DEFAULT_DRIVER_GRACE_MS;
  const maxWorkerRepliesPerTick = options.maxWorkerRepliesPerTick ?? DEFAULT_MAX_WORKER_REPLIES_PER_TICK;
  const workerCooldownMs = options.workerCooldownMs ?? DEFAULT_WORKER_COOLDOWN_MS;
  const chairCooldownMs = options.chairCooldownMs ?? DEFAULT_CHAIR_COOLDOWN_MS;
  const replyBudget = options.replyBudget ?? DEFAULT_REPLY_BUDGET;

  const instanceId = randomUUID();
  /** Lifetime reply counts and last-reply stamps per `${chair}:${task}:${slug}`. */
  const replyCounts = new Map<string, number>();
  const lastReplyAt = new Map<string, number>();

  let timer: ReturnType<typeof setInterval> | null = null;
  let ticking = false;

  function seatKey(chairSlug: string, taskId: number, slug: string): string {
    return `${chairSlug}:${taskId}:${slug}`;
  }

  // -------------------------------------------------------------------------
  // Driver mutex
  // -------------------------------------------------------------------------

  async function claimDriverOrYield(store: GroupTaskStore, taskId: number): Promise<boolean> {
    if (driverGraceMs === 0) return true;
    const key = `${GROUP_TASK_DRIVER_KV_PREFIX}${taskId}`;
    const raw = await store.kvGet(key);
    if (raw) {
      const [owner, stampRaw] = raw.split('|');
      const stamp = Number(stampRaw);
      if (owner === instanceId) return true; // own claim; refreshed only on post
      if (Number.isFinite(stamp) && now() - stamp < driverGraceMs) return false;
    }
    await store.kvSet(key, `${instanceId}|${now()}`);
    return true;
  }

  async function refreshDriverClaim(store: GroupTaskStore, taskId: number): Promise<void> {
    if (driverGraceMs === 0) return;
    await store.kvSet(`${GROUP_TASK_DRIVER_KV_PREFIX}${taskId}`, `${instanceId}|${now()}`);
  }

  // -------------------------------------------------------------------------
  // Seats & prompts
  // -------------------------------------------------------------------------

  async function buildSeats(
    task: GroupTaskRecord,
    members: GroupTaskMember[],
    profileBySlug: Map<string, GroupTaskProfileRef>,
  ): Promise<{ seats: SeatInfo[]; promptSeats: GroupTaskPromptSeat[]; chair: SeatInfo | null }> {
    const seats: SeatInfo[] = [];
    const promptSeats: GroupTaskPromptSeat[] = [];
    for (const member of members) {
      if (member.removedAt != null) continue;
      const profile = member.slug ? profileBySlug.get(member.slug) : undefined;
      const name = member.displayName?.trim() || profile?.name || member.slug || member.globalMetaId || 'member';
      promptSeats.push({ name, role: member.role, remote: member.slug == null });
      if (!member.slug || !profile) continue; // remote members never get local turns
      seats.push({
        slug: member.slug,
        role: member.role,
        name,
        globalMetaId: member.globalMetaId ?? profile.globalMetaId,
        metaId: profile.metaId,
        member,
        profile,
      });
    }
    const chair = seats.find((seat) => seat.role === 'chair') ?? null;
    return { seats, promptSeats, chair };
  }

  async function runSeatTurn(input: {
    seat: SeatInfo;
    task: GroupTaskRecord;
    promptSeats: GroupTaskPromptSeat[];
    chairName: string;
    ownerGmid: string | null;
    recentMessages: GroupTaskMessage[];
    target: GroupTaskMessage | null;
    promptOverride?: string;
  }): Promise<string> {
    const persona = await loadPersona(input.seat.profile).catch(() => ({} as GroupTaskEnginePersona));
    const systemPrompt = buildGroupTaskSystemPrompt({
      identity: {
        name: input.seat.name,
        globalMetaId: input.seat.globalMetaId,
        role: persona.role,
        bio: persona.bio,
        soul: persona.soul,
        goal: persona.goal,
      },
      task: input.task,
      seats: input.promptSeats,
      chairName: input.chairName,
      ownerGlobalMetaId: input.ownerGmid,
      role: input.seat.role,
    });
    const prompt = input.promptOverride ?? buildGroupTaskTurnContext({
      task: input.task,
      recentMessages: input.recentMessages,
      target: input.target,
      nowMs: now(),
    });
    return options.runLlmTurn({
      profile: input.seat.profile,
      role: input.seat.role,
      systemPrompt,
      prompt,
    });
  }

  // -------------------------------------------------------------------------
  // Tag side effects (idempotent; safe to re-run on message retry)
  // -------------------------------------------------------------------------

  async function hasOpenCheckpoint(store: GroupTaskStore, taskId: number): Promise<boolean> {
    const checkpoints = await store.listCheckpoints(taskId);
    return checkpoints.some((checkpoint) => checkpoint.status === 'open');
  }

  async function postHostNotice(
    task: GroupTaskRecord,
    chairSlug: string,
    content: string,
  ): Promise<void> {
    try {
      await postGroupTaskMessage(ctx, chairSlug, task.id, { content });
    } catch (error) {
      log(`[GroupTaskEngine] Host notice failed for task ${task.id}: `
        + `${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function applyChairStatusTag(
    store: GroupTaskStore,
    task: GroupTaskRecord,
    chairSlug: string,
    target: 'executing' | 'review',
    message: GroupTaskMessage,
  ): Promise<GroupTaskRecord> {
    if (task.status === target) return task;
    if (!GROUP_TASK_LEGAL_TRANSITIONS[task.status].includes(target)) return task;

    if (target === 'review' && task.status === 'executing') {
      const reworkRaw = await store.kvGet(`${GROUP_TASK_REWORK_AT_KV_PREFIX}${task.id}`);
      const reworkAt = Number(reworkRaw);
      if (Number.isFinite(reworkAt) && now() - reworkAt < REVIEW_REENTRY_DEBOUNCE_MS) {
        return task; // stale review re-entry right after a rework
      }
    }

    const updated = await store.updateTaskStatus(task.id, target, {
      actor: { kind: 'chair', globalMetaId: message.senderGlobalMetaId, name: message.senderName },
      reason: `[STATUS:${target.toUpperCase()}]`,
    });

    if (target === 'executing' && task.status === 'review') {
      await store.kvSet(`${GROUP_TASK_REWORK_AT_KV_PREFIX}${task.id}`, String(now()));
      await clearGroupTaskReviewDeliveryGuards(store, task.id);
      await store.kvDelete(`${GROUP_TASK_REVIEW_SUMMARY_KV_PREFIX}${task.id}`);
    }
    if (target === 'review') {
      await store.kvDelete(`${GROUP_TASK_REWORK_AT_KV_PREFIX}${task.id}`);
      await store.closeOpenCheckpoints(task.id, 'resolved', 'superseded by review entry');
      await runReviewCeremony(store, updated, chairSlug, message);
    }
    return updated;
  }

  async function runReviewCeremony(
    store: GroupTaskStore,
    task: GroupTaskRecord,
    chairSlug: string,
    reviewMessage: GroupTaskMessage,
  ): Promise<void> {
    const guardKey = `${GROUP_TASK_REVIEW_SUMMARY_KV_PREFIX}${task.id}`;
    if (await store.kvGet(guardKey)) return;
    const members = await store.listMembers(task.id);
    const deliverables = await store.listDeliverables(task.id);
    const planChanges = await store.listPlanChanges(task.id);
    const conclusion = reviewMessage.content
      .replace(/\[[A-Z_]+(?::[^\]]*)?\]/gu, '')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, 300) || null;

    await store.addAcceptanceSummary({
      taskId: task.id,
      goal: task.goal,
      acceptanceCriteria: task.acceptanceCriteria,
      deliverables: deliverables.map((row) => ({
        kind: row.kind,
        uri: row.uri,
        status: row.status,
        confirmation: row.confirmation,
        authorName: null,
      })),
      members: members
        .filter((member) => member.removedAt == null)
        .map((member) => ({
          name: member.displayName ?? member.slug,
          role: member.role,
          workStatus: member.status,
        })),
      planChanges: planChanges.map((change) => change.summary),
      guidance: 'Review the deliverables against the acceptance criteria, then accept & close or send the task back to work.',
      conclusion,
      outcome: null,
      rating: null,
      ratingComment: null,
      generatedBy: 'grouptask-engine',
      publishedGroupPinId: null,
    });

    const lines = [
      '[GROUP_TASK_NOTICE:review_summary] Task entered review — owner acceptance requested.',
      `Goal: ${task.goal}`,
      `Acceptance criteria: ${task.acceptanceCriteria ?? '(none specified)'}`,
    ];
    if (deliverables.length > 0) {
      lines.push('Deliverables:');
      for (const row of deliverables) {
        lines.push(`- [${row.status}] ${row.kind ?? 'text'}${row.uri ? ` ${row.uri}` : ''}`);
      }
    }
    if (planChanges.length > 0) {
      lines.push('Plan changes:');
      for (const change of planChanges) lines.push(`- ${change.summary}`);
    }
    await postHostNotice(task, chairSlug, lines.join('\n'));
    await store.kvSet(guardKey, String(now()));
  }

  async function applyTagSideEffects(
    store: GroupTaskStore,
    task: GroupTaskRecord,
    chairSlug: string,
    message: GroupTaskMessage,
    tags: ParsedGroupTaskTags,
    seats: SeatInfo[],
  ): Promise<GroupTaskRecord> {
    if (message.senderSuspect) return task;
    const senderGmid = normalizeGmid(message.senderGlobalMetaId);
    const chairSeat = seats.find((seat) => seat.role === 'chair') ?? null;
    const fromChair = chairSeat !== null && normalizeGmid(chairSeat.globalMetaId) === senderGmid;
    const senderSeat = seats.find((seat) => normalizeGmid(seat.globalMetaId) === senderGmid) ?? null;
    let current = task;

    // Chair-only tags
    if (fromChair) {
      for (const summary of tags.planChanges) {
        const existing = await store.listPlanChanges(task.id);
        const duplicate = existing.some((change) =>
          change.summary === summary && (change.msgPinId ?? null) === (message.pinId ?? null));
        if (!duplicate) {
          await store.addPlanChange({
            taskId: task.id,
            msgPinId: message.pinId,
            authorGlobalMetaId: message.senderGlobalMetaId,
            summary,
          });
        }
      }

      if (tags.checkpointResolved) {
        const resolved = await store.resolveCheckpoint(task.id, tags.checkpointDecision, message.pinId);
        if (resolved) {
          await postHostNotice(current, chairSlug,
            `[GROUP_TASK_NOTICE:checkpoint_resolved] Checkpoint resolved${tags.checkpointDecision ? `: ${tags.checkpointDecision}` : ''}. Work resumes.`);
        }
      } else if (
        tags.checkpointTopic
        && current.status !== 'review'
        && !(await hasOpenCheckpoint(store, task.id))
      ) {
        await store.openCheckpoint(task.id, tags.checkpointTopic, message.pinId);
        await postHostNotice(current, chairSlug,
          `[GROUP_TASK_NOTICE:checkpoint_open] Task paused — waiting for the owner: ${tags.checkpointTopic}`);
      }

      if (tags.status) {
        current = await applyChairStatusTag(store, current, chairSlug, tags.status, message);
      }
    }

    // Member tags (non-chair local members)
    if (senderSeat && !fromChair) {
      if (tags.deliverables.length > 0 && message.pinId) {
        const alreadyRecorded = await store.hasDeliverableWithMsgPin(task.id, message.pinId);
        if (!alreadyRecorded) {
          for (const candidate of tags.deliverables) {
            await store.addDeliverable({
              taskId: task.id,
              msgPinId: message.pinId,
              authorGlobalMetaId: message.senderGlobalMetaId,
              kind: candidate.kind,
              uri: candidate.uri,
            });
          }
        }
      }
      if (tags.working) {
        await store.setMemberStatus(task.id, senderSeat.slug, 'working', senderSeat.globalMetaId);
      } else if (tags.standby) {
        await store.setMemberStatus(task.id, senderSeat.slug, 'standby', senderSeat.globalMetaId);
      }
    }

    return current;
  }

  // -------------------------------------------------------------------------
  // Reply execution
  // -------------------------------------------------------------------------

  interface TickCounters {
    workerReplies: number;
    chairAutoReplies: number;
  }

  /**
   * Run the decided reply turns for one message. Returns 'done' when the
   * message is fully handled, 'defer' when a cap/cooldown blocked a decided
   * responder (the cursor must NOT advance so the reply retries next tick).
   */
  async function runReplies(input: {
    store: GroupTaskStore;
    task: GroupTaskRecord;
    chairSlug: string;
    message: GroupTaskMessage;
    decisions: GroupTaskResponderDecision[];
    seats: SeatInfo[];
    promptSeats: GroupTaskPromptSeat[];
    chairName: string;
    ownerGmid: string | null;
    recentMessages: GroupTaskMessage[];
    counters: TickCounters;
  }): Promise<'done' | 'defer'> {
    for (const decision of input.decisions) {
      const seat = input.seats.find((entry) => entry.slug === decision.slug);
      if (!seat) continue;
      const key = seatKey(input.chairSlug, input.task.id, seat.slug);

      const spent = replyCounts.get(key) ?? 0;
      if (spent >= replyBudget) continue; // budget exhausted: drop, never defer

      if (decision.role === 'worker' && input.counters.workerReplies >= maxWorkerRepliesPerTick) {
        return 'defer';
      }
      if (decision.role === 'chair' && decision.reason !== 'chair_mentioned'
        && input.counters.chairAutoReplies >= 1) {
        return 'defer';
      }
      const cooldown = decision.role === 'chair' ? chairCooldownMs : workerCooldownMs;
      const last = lastReplyAt.get(key) ?? 0;
      if (now() - last < cooldown) return 'defer';

      const reply = (await runSeatTurn({
        seat,
        task: input.task,
        promptSeats: input.promptSeats,
        chairName: input.chairName,
        ownerGmid: input.ownerGmid,
        recentMessages: input.recentMessages,
        target: input.message,
      })).trim();

      replyCounts.set(key, spent + 1);
      lastReplyAt.set(key, now());
      if (decision.role === 'worker') input.counters.workerReplies += 1;
      else if (decision.reason !== 'chair_mentioned') input.counters.chairAutoReplies += 1;

      if (!reply || isNoReplyResponse(reply)) continue;

      await postGroupTaskMessage(ctx, input.chairSlug, input.task.id, {
        content: reply,
        asSlug: seat.slug,
        replyPin: input.message.pinId ?? undefined,
      });
      await refreshDriverClaim(input.store, input.task.id);
    }
    return 'done';
  }

  // -------------------------------------------------------------------------
  // Planning turn
  // -------------------------------------------------------------------------

  async function runPlanningTurn(input: {
    store: GroupTaskStore;
    task: GroupTaskRecord;
    chair: SeatInfo;
    chairSlug: string;
    promptSeats: GroupTaskPromptSeat[];
    ownerGmid: string | null;
    recentMessages: GroupTaskMessage[];
  }): Promise<void> {
    const { store, task } = input;
    const plannedKey = `${GROUP_TASK_PLANNED_KV_PREFIX}${task.id}`;
    if (await store.kvGet(plannedKey)) return;
    const attemptsKey = `${GROUP_TASK_PLAN_ATTEMPTS_KV_PREFIX}${task.id}`;
    const attempts = Number((await store.kvGet(attemptsKey)) ?? '0') || 0;
    if (attempts >= PLAN_ATTEMPTS_MAX) return;
    await store.kvSet(attemptsKey, String(attempts + 1));

    const directive = buildPlanningDirective({
      task,
      seats: input.promptSeats,
      recentMessages: input.recentMessages,
      nowMs: now(),
    });
    const reply = (await runSeatTurn({
      seat: input.chair,
      task,
      promptSeats: input.promptSeats,
      chairName: input.chair.name,
      ownerGmid: input.ownerGmid,
      recentMessages: input.recentMessages,
      target: null,
      promptOverride: directive,
    })).trim();
    if (!reply || isNoReplyResponse(reply)) return; // counts as a failed attempt

    await postGroupTaskMessage(ctx, input.chairSlug, task.id, { content: reply });
    await store.kvSet(plannedKey, String(now()));
    await refreshDriverClaim(store, task.id);
  }

  // -------------------------------------------------------------------------
  // Per-task drive
  // -------------------------------------------------------------------------

  async function driveTask(
    profile: GroupTaskProfileRef,
    store: GroupTaskStore,
    task: GroupTaskRecord,
    profileBySlug: Map<string, GroupTaskProfileRef>,
    ownerGmid: string | null,
  ): Promise<void> {
    if (!task.groupId) return;
    if (!(await claimDriverOrYield(store, task.id))) return;
    await store.touchTaskDriven(task.id, now());
    await syncGroupTaskMessages(ctx, store, task);

    const members = await store.listMembers(task.id, { includeRemoved: true });
    const { seats, promptSeats, chair } = await buildSeats(task, members, profileBySlug);
    const chairName = chair?.name ?? profile.name;

    const page = await store.listMessages(task.groupId, { limit: MESSAGE_FETCH_LIMIT });
    let current = task;

    if (current.status === 'planning' && chair) {
      try {
        await runPlanningTurn({
          store,
          task: current,
          chair,
          chairSlug: profile.slug,
          promptSeats,
          ownerGmid,
          recentMessages: page.messages,
        });
      } catch (error) {
        log(`[GroupTaskEngine] Planning turn failed for task ${current.id}: `
          + `${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const pending = page.messages.filter((message) => message.index > current.lastProcessedIndex);
    const counters: TickCounters = { workerReplies: 0, chairAutoReplies: 0 };

    for (const message of pending) {
      const retryKey = `${GROUP_TASK_MSG_RETRY_KV_PREFIX}${current.id}:${message.index}`;
      try {
        const tags = parseGroupTaskTags(message.content);
        current = await applyTagSideEffects(store, current, profile.slug, message, tags, seats);
        if (current.status === 'done' || current.status === 'cancelled') {
          await store.updateTaskCursor(current.id, message.index);
          break;
        }

        const decisions = decideGroupTaskResponders({
          message,
          taskStatus: current.status,
          hasOpenCheckpoint: await hasOpenCheckpoint(store, current.id),
          seats,
          ownerGlobalMetaId: ownerGmid,
        });

        const recentMessages = page.messages.filter((entry) => entry.index <= message.index);
        const outcome = await runReplies({
          store,
          task: current,
          chairSlug: profile.slug,
          message,
          decisions,
          seats,
          promptSeats,
          chairName,
          ownerGmid,
          recentMessages,
          counters,
        });
        if (outcome === 'defer') break; // cursor stays put; retry next tick

        await store.updateTaskCursor(current.id, message.index);
        await store.kvDelete(retryKey);
      } catch (error) {
        const failures = (Number((await store.kvGet(retryKey)) ?? '0') || 0) + 1;
        await store.kvSet(retryKey, String(failures));
        log(`[GroupTaskEngine] Message ${message.index} of task ${current.id} failed `
          + `(${failures}/${MSG_RETRY_MAX_FAILURES}): ${error instanceof Error ? error.message : String(error)}`);
        if (failures >= MSG_RETRY_MAX_FAILURES) {
          // Poison message: give up on replies, keep the cursor moving.
          await store.updateTaskCursor(current.id, message.index);
          await store.kvDelete(retryKey);
          continue;
        }
        break; // fail-stop: later messages wait for this one
      }
    }
  }

  // -------------------------------------------------------------------------
  // Tick
  // -------------------------------------------------------------------------

  async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      const profiles = await ctx.listProfiles();
      const profileBySlug = new Map(profiles.map((entry) => [entry.slug, entry]));
      let ownerGmid: string | null = null;
      try {
        ownerGmid = (await ctx.ownerIdentity())?.globalMetaId ?? null;
      } catch {
        ownerGmid = null;
      }

      for (const profile of profiles) {
        let store: GroupTaskStore;
        let tasks: GroupTaskRecord[];
        try {
          store = storeFor(ctx, profile);
          tasks = await store.listTasks({ includeArchived: true });
        } catch {
          continue;
        }
        const runnable = tasks.filter((task) =>
          task.chairSlug === profile.slug && RUNNABLE_STATUSES.has(task.status));
        for (const task of runnable) {
          try {
            await driveTask(profile, store, task, profileBySlug, ownerGmid);
          } catch (error) {
            log(`[GroupTaskEngine] Task ${task.id} drive failed: `
              + `${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    } finally {
      ticking = false;
    }
  }

  return {
    start(): void {
      if (timer) return;
      void tick().catch((error: unknown) => {
        log(`[GroupTaskEngine] Initial tick failed: ${error instanceof Error ? error.message : String(error)}`);
      });
      timer = setInterval(() => {
        void tick().catch((error: unknown) => {
          log(`[GroupTaskEngine] Tick failed: ${error instanceof Error ? error.message : String(error)}`);
        });
      }, intervalMs);
      timer.unref?.();
    },
    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    tick,
  };
}
