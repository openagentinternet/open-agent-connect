// Dream-time experience harvest, the file-port counterpart of IDBots
// src/main/services/metaidExperienceBackfillService.ts: folds one dream day's
// group-task chat streams, accepted group tasks, and seller orders into the
// owner-scoped experience ledger so the dream impression pipeline has episodes
// to consolidate. Episodes and evidence are idempotent by sourceKey, so
// re-dreams and repair runs never duplicate rows; evidence carries pin/hash
// references only, never raw private text.
import type { GroupTaskMember, GroupTaskRecord } from '../grouptask/types';
import type { SellerOrderRecord } from '../orders/sellerOrderState';
import type { MetabotPaths } from '../state/paths';
import {
  readDreamDayGroupTaskSource,
  readDreamDaySellerOrders,
  DREAM_GROUP_CHAT_MAX_MESSAGES,
  type DreamDayGroupChatSource,
} from './dreamStore';
import {
  hashExperienceContent,
  type ExperienceEpisode,
  type ExperienceEpisodeStatus,
  type ExperienceStore,
} from './experienceStore';

/** Evidence rows per harvested chat episode stay bounded like the prompt-side
 * excerpt (IDBots writes one row per message; the file port caps instead). */
const MAX_HARVEST_EVIDENCE_PER_EPISODE = DREAM_GROUP_CHAT_MAX_MESSAGES;

export interface DreamExperienceHarvestInput {
  paths: MetabotPaths;
  experienceStore: ExperienceStore;
  /** Observer GlobalMetaID (the dreaming bot). Empty -> no-op. */
  observerGlobalMetaId: string;
  /** Local dream date, YYYY-MM-DD. */
  date: string;
  startMs: number;
  endMs: number;
}

export interface DreamExperienceHarvestResult {
  /** Distinct episodes attached during this harvest (existing + new). */
  episodes: number;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Epoch-ms field or null (junk/missing → null). */
function timestampMs(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** The moment a task counts as accepted that day: rated, else closed. */
function acceptedAtInDay(task: GroupTaskRecord, startMs: number, endMs: number): number | null {
  const ratedAt = timestampMs(task.ratedAt);
  if (ratedAt !== null && ratedAt >= startMs && ratedAt < endMs) return ratedAt;
  const closedAt = timestampMs(task.closedAt);
  if (closedAt !== null && closedAt >= startMs && closedAt < endMs) return closedAt;
  return null;
}

function groupTaskEpisodeStatus(task: GroupTaskRecord): ExperienceEpisodeStatus {
  if (task.status === 'done') return 'completed';
  if (task.status === 'cancelled') return 'abandoned';
  return 'open';
}

/** One episode per in-day group chat stream (per-day-per-group, the IDBots
 * one-episode-per-interaction-stream granularity). */
async function harvestGroupChatEpisode(
  store: ExperienceStore,
  observer: string,
  date: string,
  chat: DreamDayGroupChatSource,
): Promise<ExperienceEpisode> {
  const first = chat.messages[0]!;
  const last = chat.messages[chat.messages.length - 1]!;
  const episode = await store.createEpisode({
    ownerGlobalMetaId: observer,
    episodeType: 'task_participation',
    sourceChannel: 'metaweb_group',
    sourceKey: `grouptask-chat:${chat.groupId}:${date}`,
    externalConversationId: chat.groupId,
    taskId: chat.task ? String(chat.task.id) : null,
    status: chat.task ? groupTaskEpisodeStatus(chat.task) : 'open',
    startedAt: first.occurredAt,
    endedAt: last.occurredAt,
    metadata: {
      interaction: 'group_task',
      groupId: chat.groupId,
      taskId: chat.task?.id ?? null,
      title: chat.task?.title ?? chat.membership?.taskTitle ?? null,
      guest: !chat.task,
      messageCount: chat.messages.length,
    },
  });

  // Participants: the observer plus every resolvable same-day sender.
  await store.addParticipant({
    episodeId: episode.id,
    globalMetaId: observer,
    role: 'observer',
    source: 'dream_harvest',
  });
  const senders = new Map<string, string | null>();
  for (const message of chat.messages) {
    if (!message.senderGlobalMetaId || senders.has(message.senderGlobalMetaId)) continue;
    senders.set(message.senderGlobalMetaId, message.senderName);
  }
  for (const [senderGlobalMetaId, senderName] of senders) {
    if (senderGlobalMetaId === observer) continue;
    await store.addParticipant({
      episodeId: episode.id,
      globalMetaId: senderGlobalMetaId,
      role: 'member',
      displayName: senderName,
      source: 'dream_harvest',
    });
  }

  // Evidence: pinId + content-hash references only — never raw text.
  for (const message of chat.messages.slice(0, MAX_HARVEST_EVIDENCE_PER_EPISODE)) {
    await store.addEvidence({
      episodeId: episode.id,
      evidenceType: 'group_task_message',
      sourceKey: `message:${message.pinId ?? `idx:${message.index}`}`,
      pinId: message.pinId,
      publisherGlobalMetaId: message.senderGlobalMetaId,
      contentHash: hashExperienceContent(message.content),
      occurredAt: message.occurredAt,
      metadata: {
        groupId: chat.groupId,
        index: message.index,
        txId: message.txId,
      },
    });
  }
  return episode;
}

/** Accepted tasks fold rating/acceptance evidence into the day's chat episode
 * when one exists, else open a per-task day episode. */
async function harvestAcceptedTaskEpisode(
  store: ExperienceStore,
  observer: string,
  date: string,
  task: GroupTaskRecord,
  members: GroupTaskMember[],
  chatEpisodeByGroupId: Map<string, ExperienceEpisode>,
  acceptedAt: number,
): Promise<ExperienceEpisode> {
  const groupId = text(task.groupId);
  let episode = groupId ? chatEpisodeByGroupId.get(groupId) : undefined;
  if (!episode) {
    episode = await store.createEpisode({
      ownerGlobalMetaId: observer,
      episodeType: 'task_participation',
      sourceChannel: 'metaweb_group',
      sourceKey: `grouptask:${task.id}:${date}`,
      externalConversationId: groupId || `group-task:${task.id}`,
      taskId: String(task.id),
      status: groupTaskEpisodeStatus(task),
      startedAt: acceptedAt,
      endedAt: acceptedAt,
      metadata: {
        interaction: 'group_task',
        taskId: task.id,
        groupId: groupId || null,
        title: task.title,
        messageCount: 0,
      },
    });
  }

  await store.addParticipant({
    episodeId: episode.id,
    globalMetaId: observer,
    role: 'observer',
    source: 'dream_harvest',
  });
  // Roster members with resolved identities join as participants.
  for (const member of members) {
    if (member.taskId !== task.id) continue;
    const globalMetaId = text(member.globalMetaId);
    if (!globalMetaId || globalMetaId === observer) continue;
    await store.addParticipant({
      episodeId: episode.id,
      globalMetaId,
      role: member.role === 'chair' ? 'chair' : 'member',
      displayName: text(member.displayName) || null,
      source: 'dream_harvest',
    });
  }

  // Rating/acceptance evidence when present: the human's review comment is
  // private text, so only its hash is recorded.
  const rating = typeof task.rating === 'number' && Number.isInteger(task.rating)
    && task.rating >= 1 && task.rating <= 5 ? task.rating : null;
  const ratingComment = text(task.ratingComment);
  if (rating !== null || ratingComment) {
    await store.addEvidence({
      episodeId: episode.id,
      evidenceType: 'group_task_acceptance',
      sourceKey: `grouptask:${task.id}:${date}:acceptance`,
      contentHash: hashExperienceContent(JSON.stringify({
        taskId: task.id,
        rating,
        ratingComment: ratingComment || null,
        status: task.status,
      })),
      occurredAt: acceptedAt,
      metadata: { taskId: task.id, rating, status: task.status },
    });
  }
  return episode;
}

/** One episode per in-day seller order, keyed by the order id. */
async function harvestSellerOrderEpisode(
  store: ExperienceStore,
  observer: string,
  order: SellerOrderRecord,
): Promise<ExperienceEpisode | null> {
  const orderId = text(order.id);
  if (!orderId) return null;
  const createdAt = timestampMs(order.createdAt) ?? Date.now();
  const updatedAt = timestampMs(order.updatedAt) ?? createdAt;
  const state = text(order.state) || 'received';
  const status: ExperienceEpisodeStatus = state === 'failed'
    ? 'failed'
    : state === 'completed' || state === 'refunded'
      ? 'completed'
      : 'open';
  const episode = await store.createEpisode({
    ownerGlobalMetaId: observer,
    episodeType: 'service_order',
    sourceChannel: 'service_order',
    sourceKey: `order:${orderId}`,
    externalConversationId: text(order.a2aSessionId) || `service-order:${orderId}`,
    orderId,
    status,
    startedAt: createdAt,
    endedAt: status === 'open'
      ? null
      : timestampMs(order.endedAt) ?? timestampMs(order.refundCompletedAt) ?? updatedAt,
    metadata: {
      interaction: 'service_order',
      state,
      serviceName: text(order.serviceName) || null,
      servicePinId: text(order.servicePinId) || null,
      orderPinId: text(order.orderPinId) || null,
      paymentTxid: text(order.paymentTxid) || null,
      paymentChain: text(order.paymentChain) || null,
      paymentCurrency: text(order.paymentCurrency) || null,
    },
  });

  // Participants: the buyer/seller GlobalMetaIDs when present (the seller is
  // this profile's provider identity for seller orders), plus the observer.
  const sellerGlobalMetaId = text(order.providerGlobalMetaId);
  const buyerGlobalMetaId = text(order.buyerGlobalMetaId);
  let observerAdded = false;
  if (sellerGlobalMetaId) {
    await store.addParticipant({
      episodeId: episode.id,
      globalMetaId: sellerGlobalMetaId,
      role: 'seller',
      source: 'dream_harvest',
    });
    observerAdded ||= sellerGlobalMetaId === observer;
  }
  if (buyerGlobalMetaId && buyerGlobalMetaId !== sellerGlobalMetaId) {
    await store.addParticipant({
      episodeId: episode.id,
      globalMetaId: buyerGlobalMetaId,
      role: 'buyer',
      source: 'dream_harvest',
    });
    observerAdded ||= buyerGlobalMetaId === observer;
  }
  if (!observerAdded) {
    await store.addParticipant({
      episodeId: episode.id,
      globalMetaId: observer,
      role: 'observer',
      source: 'dream_harvest',
    });
  }

  // One state-observation evidence row per observed state — idempotent across
  // re-dreams, and later runs only add a row when the state moved.
  await store.addEvidence({
    episodeId: episode.id,
    evidenceType: 'service_order_event',
    sourceKey: `order:${orderId}:${state}`,
    pinId: text(order.serviceOrderPinId) || text(order.orderPinId) || null,
    publisherGlobalMetaId: buyerGlobalMetaId || null,
    contentHash: hashExperienceContent(JSON.stringify({ orderId, state, updatedAt })),
    occurredAt: updatedAt,
    metadata: { event: state, state },
  });
  return episode;
}

/**
 * Fold one dream day's group-task chats, accepted group tasks and seller
 * orders into the experience ledger. Callers gate on the observer GlobalMetaID
 * and isolate failures — this harvest must never fail a dream run.
 */
export async function harvestDreamDayExperiences(
  input: DreamExperienceHarvestInput,
): Promise<DreamExperienceHarvestResult> {
  const observer = text(input.observerGlobalMetaId);
  if (!observer) return { episodes: 0 };
  const store = input.experienceStore;
  const episodeIds = new Set<string>();

  const groupTaskSource = await readDreamDayGroupTaskSource(input.paths, {
    startMs: input.startMs,
    endMs: input.endMs,
  });

  const chatEpisodeByGroupId = new Map<string, ExperienceEpisode>();
  for (const chat of groupTaskSource.chats) {
    const episode = await harvestGroupChatEpisode(store, observer, input.date, chat);
    chatEpisodeByGroupId.set(chat.groupId, episode);
    episodeIds.add(episode.id);
  }

  for (const task of groupTaskSource.tasks) {
    const acceptedAt = acceptedAtInDay(task, input.startMs, input.endMs);
    if (acceptedAt === null) continue;
    const episode = await harvestAcceptedTaskEpisode(
      store,
      observer,
      input.date,
      task,
      groupTaskSource.members,
      chatEpisodeByGroupId,
      acceptedAt,
    );
    episodeIds.add(episode.id);
  }

  const orders = await readDreamDaySellerOrders(input.paths, {
    startMs: input.startMs,
    endMs: input.endMs,
  });
  for (const order of orders) {
    const episode = await harvestSellerOrderEpisode(store, observer, order);
    if (episode) episodeIds.add(episode.id);
  }

  return { episodes: episodeIds.size };
}
