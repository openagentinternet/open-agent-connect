/**
 * SurfBriefing — the deterministic stage-0 of every surf run. OAC port of the
 * IDBots surfBriefing (async file store instead of sync SQLite).
 *
 * For each registered protocol: fetch items newer than the bot's watermark
 * (first surf looks back SURF_FIRST_LOOKBACK_SECONDS) or continue a
 * registered backlog page, drop pins already in the seen ledger, and cap
 * per protocol and in total. The LLM session then decides what to deep-read,
 * save, and interact with. Two deterministic cross-protocol sections ride
 * along: YOUR INBOX (R3 interactions — likes/comments on my pins + answers
 * to my questions) and PROTOCOL RADAR (R6 registered /protocols/*
 * declarations). Neither ever throws — a sick backend lands in the section's
 * error field.
 *
 * This builder is side-effect free by design: survivors are marked
 * 'presented' by the surf service ONLY when the run succeeds, so a failed run
 * (LLM timeout, network outage) re-presents this same window on the next
 * surf instead of silently dropping it (catch-up semantics, IDBots review P1).
 */

import type { MetawebSurfStore } from './store.js';
import {
  DEFAULT_SURF_PROTOCOLS,
  type SurfItem,
  type SurfProtocolDescriptor,
} from './protocols.js';

export const SURF_FIRST_LOOKBACK_SECONDS = 7 * 24 * 60 * 60;
export const SURF_PROTOCOL_FETCH_LIMIT = 50;
export const SURF_TOTAL_FETCH_LIMIT = 150;
/** Deterministic inbox items presented per run (newest first). */
export const SURF_INBOX_PRESENT_LIMIT = 30;
/** Protocol radar page size (one page, newest first). */
export const SURF_PROTOCOL_RADAR_LIMIT = 50;

export interface SurfBriefingProtocolSection {
  key: string;
  displayName: string;
  /** True when this section continued a registered backlog page instead of the since-window. */
  fetchedBacklog: boolean;
  fetchedCount: number;
  keptCount: number;
  /** Newest createdAt seen in this fetch (unix seconds); reporting only. */
  newestTs: number | null;
  /**
   * Kept items dropped by the TOTAL run cap (SURF_TOTAL_FETCH_LIMIT). These
   * stay OUT of the seen ledger and the watermark does not pass them, so the
   * cap defers them to the next surf instead of silently dropping them
   * (IDBots round 3, live evidence: 8 Q&A items once vanished without a trace).
   * For backlog pages the same rule preserves the backlog cursor instead of
   * advancing past them.
   */
  droppedByTotalCap: number;
  /**
   * Watermark to store after a successful run: the OLDEST kept item that made
   * the final capped list. Presented items are ledger-filtered on the next
   * run anyway, and crowded-out items survive that filter — so this cursor
   * re-fetches a bounded overlap and nothing is lost. null = do not advance
   * (fetch error, backlog pages, or this protocol was crowded out entirely).
   */
  nextWatermarkTs: number | null;
  /**
   * What the success path does with the stored backlog cursor (opaque R1
   * server token):
   * - 'store':    persist `backlogCursor` — the window's first page reported
   *               hasMore (debt registered) or a backlog page still has more.
   * - 'clear':    set it to null — the window/backlog is fully scanned
   *               (debt drained).
   * - 'preserve': leave it untouched — fetch error, or total-cap deferral on
   *               a backlog page (re-present the same backlog page next run).
   */
  backlogCursorAction: 'store' | 'clear' | 'preserve';
  /** Cursor value to persist when `backlogCursorAction` is 'store'. */
  backlogCursor: string | null;
  error: string | null;
}

/** One deterministic inbox interaction (R3). `pinId` is the interaction pin itself (the seen-ledger key). */
export interface SurfInboxItem {
  /** e.g. "simplebuzz_like" | "simplebuzz_comment" | "simpleanswer". */
  type: string;
  pinId: string;
  /** The bot's own pin the interaction points at. */
  targetPinId: string;
  actorName: string;
  actorGlobalMetaId: string;
  /** Unix seconds. */
  createdAt: number;
  excerpt: string;
}

export interface SurfBriefingInbox {
  items: SurfInboxItem[];
  /** The baseline the fetch used (unix seconds); presentation reports it. */
  sinceTs: number;
  error: string | null;
}

/** One registered /protocols/* declaration (R6), `isNew` computed against the surf baseline. */
export interface SurfProtocolRadarItem {
  path: string;
  title: string;
  protocolName: string;
  intro: string;
  version: string;
  authorName: string;
  createdAt: number;
  isNew: boolean;
}

export interface SurfProtocolRadar {
  items: SurfProtocolRadarItem[];
  rejectedCount: number;
  error: string | null;
}

/** What buildSurfBriefing expects from a radar fetcher (isNew is annotated in-house). */
export type SurfProtocolRadarFetchResult = {
  items: Array<Omit<SurfProtocolRadarItem, 'isNew'>>;
  rejectedCount: number;
};

export interface SurfBriefing {
  generatedAtIso: string;
  items: SurfItem[];
  protocols: SurfBriefingProtocolSection[];
  /** Deterministic inbox (R3); absent when the host passed no fetcher. */
  inbox?: SurfBriefingInbox;
  /** Registered-protocol radar (R6); absent when the host passed no fetcher. */
  protocolRadar?: SurfProtocolRadar;
  /** Chain-writing interactions allowed for this run (from bot settings). */
  interactionBudget: number;
}

export async function buildSurfBriefing(input: {
  store: MetawebSurfStore;
  interactionBudget: number;
  registry?: SurfProtocolDescriptor[];
  nowMs?: number;
  /**
   * Deterministic inbox fetcher (R3). Called with sinceTs = inboxBaselineTs
   * (or the first-lookback default); returning items are ledger-filtered
   * here for exactly-once presentation. Never throws — errors land in
   * inbox.error.
   */
  fetchInbox?: (input: { sinceTs: number }) => Promise<SurfInboxItem[]>;
  /**
   * Inbox/radar baseline (unix seconds): the START of the bot's previous
   * finished run. An interaction arriving mid-run must surface next run, so
   * the baseline is the previous run's createdAt, NOT its finishedAt.
   * Defaults to the first-lookback window.
   */
  inboxBaselineTs?: number;
  /** Protocol radar fetcher (R6); errors land in protocolRadar.error. */
  fetchProtocolRadar?: () => Promise<SurfProtocolRadarFetchResult>;
}): Promise<SurfBriefing> {
  const registry = input.registry ?? DEFAULT_SURF_PROTOCOLS;
  const nowMs = input.nowMs ?? Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const firstLookbackSince = nowSec - SURF_FIRST_LOOKBACK_SECONDS;
  const baselineTs = input.inboxBaselineTs ?? firstLookbackSince;
  const nowIso = new Date(nowMs).toISOString();

  const protocols: SurfBriefingProtocolSection[] = [];
  const kept: SurfItem[] = [];

  for (const descriptor of registry) {
    const watermark = await input.store.getProtocolState(descriptor.key);
    const sinceTs = watermark?.lastSeenTs ?? firstLookbackSince;
    const backlogCursor = watermark?.backlogCursor ?? null;
    try {
      const page = await descriptor.fetchFresh({ sinceTs, limit: SURF_PROTOCOL_FETCH_LIMIT, backlogCursor });
      const fetched = page.items;
      const unseenIds = new Set(await input.store.filterUnseen(fetched.map((item) => item.pinId)));
      const fresh = fetched.filter((item) => unseenIds.has(item.pinId));
      kept.push(...fresh);
      // Backlog debt bookkeeping: any page (window or backlog) that reports
      // hasMore leaves an unscanned remainder — register the server cursor
      // so the next run continues exactly there (gap-free R1 paging). A
      // cursor-less hasMore is treated as exhausted (defensive; the backend
      // always returns one).
      const nextCursor = typeof page.nextCursor === 'string' && page.nextCursor ? page.nextCursor : null;
      const registerDebt = page.hasMore === true && nextCursor !== null;
      protocols.push({
        key: descriptor.key,
        displayName: descriptor.displayName,
        fetchedBacklog: backlogCursor !== null,
        fetchedCount: fetched.length,
        keptCount: fresh.length,
        newestTs: fetched.reduce<number | null>((max, item) => Math.max(max ?? 0, item.createdAt), null),
        droppedByTotalCap: 0,
        nextWatermarkTs: null,
        backlogCursorAction: registerDebt ? 'store' : 'clear',
        backlogCursor: registerDebt ? nextCursor : null,
        error: null,
      });
    } catch (error) {
      protocols.push({
        key: descriptor.key,
        displayName: descriptor.displayName,
        fetchedBacklog: backlogCursor !== null,
        fetchedCount: 0,
        keptCount: 0,
        newestTs: null,
        droppedByTotalCap: 0,
        nextWatermarkTs: null,
        backlogCursorAction: 'preserve',
        backlogCursor: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Newest first, total cap — a bot offline for weeks still gets a bounded run.
  const items = kept
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, SURF_TOTAL_FETCH_LIMIT);

  // Cap semantics (IDBots round 3): the cap DEFERS, never drops. Per protocol
  // the next watermark is the oldest item that survived the total cap —
  // presented items are ledger-filtered next run, crowded-out items survive
  // the filter and come back. A protocol crowded out entirely keeps its old
  // cursor.
  //
  // Backlog pages NEVER advance nextWatermarkTs: by construction every
  // backlog item is older than the watermark, so only the seen ledger (and
  // the backlog cursor) move. The cursor advance follows the same deferral
  // rule — when the total cap crowds out backlog items, the cursor is
  // PRESERVED so the next run re-presents the same backlog page instead of
  // paging past unseen items. Accepted, bounded starvation: a window that is
  // permanently flooded (hasMore on every run) keeps the backlog behind the
  // 150-item total cap — the debt is re-registered every run and drains the
  // moment the window calms down.
  for (const section of protocols) {
    if (section.error) continue;
    const inList = items.filter((item) => item.protocolKey === section.key);
    if (section.fetchedBacklog) {
      if (inList.length > 0) {
        section.droppedByTotalCap = section.keptCount - inList.length;
        if (section.droppedByTotalCap > 0) {
          section.backlogCursorAction = 'preserve';
          section.backlogCursor = null;
        }
      } else if (section.keptCount > 0) {
        section.droppedByTotalCap = section.keptCount;
        section.backlogCursorAction = 'preserve';
        section.backlogCursor = null;
      }
      section.nextWatermarkTs = null;
      continue;
    }
    if (inList.length > 0) {
      section.droppedByTotalCap = section.keptCount - inList.length;
      section.nextWatermarkTs = inList.reduce((min, item) => Math.min(min, item.createdAt), inList[0].createdAt);
    } else if (section.keptCount > 0) {
      section.droppedByTotalCap = section.keptCount;
      section.nextWatermarkTs = null;
    } else if (section.newestTs !== null) {
      // Everything fetched was already in the seen ledger — nothing to
      // rescue, so the cursor can advance past the scanned window.
      section.nextWatermarkTs = section.newestTs;
    }
  }

  // Deterministic inbox (R3): fetch, ledger-filter for exactly-once
  // presentation, keep the newest SURF_INBOX_PRESENT_LIMIT. Errors land in
  // the section — a sick surf-reads backend must never fail the run.
  let inbox: SurfBriefingInbox | undefined;
  if (input.fetchInbox) {
    try {
      const fetchedInbox = await input.fetchInbox({ sinceTs: baselineTs });
      const unseenInboxIds = new Set(
        await input.store.filterUnseen(fetchedInbox.map((item) => item.pinId)),
      );
      inbox = {
        items: fetchedInbox
          .filter((item) => item.pinId && unseenInboxIds.has(item.pinId))
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, SURF_INBOX_PRESENT_LIMIT),
        sinceTs: baselineTs,
        error: null,
      };
    } catch (error) {
      inbox = {
        items: [],
        sinceTs: baselineTs,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Protocol radar (R6): one newest-first page; isNew flags items the bot
  // has never surfed over (createdAt after the same baseline as the inbox).
  let protocolRadar: SurfProtocolRadar | undefined;
  if (input.fetchProtocolRadar) {
    try {
      const radar = await input.fetchProtocolRadar();
      protocolRadar = {
        items: (radar.items ?? [])
          .slice(0, SURF_PROTOCOL_RADAR_LIMIT)
          .map((item) => ({ ...item, isNew: item.createdAt > baselineTs })),
        rejectedCount: Math.max(0, Math.floor(Number(radar.rejectedCount) || 0)),
        error: null,
      };
    } catch (error) {
      protocolRadar = {
        items: [],
        rejectedCount: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    generatedAtIso: nowIso,
    items,
    protocols,
    inbox,
    protocolRadar,
    interactionBudget: input.interactionBudget,
  };
}

const formatItemLine = (item: SurfItem): string => {
  const date = item.createdAt > 0 ? new Date(item.createdAt * 1000).toISOString().slice(0, 10) : '?';
  const title = item.title || item.summary.slice(0, 60) || '(untitled)';
  const stats = [
    item.likeCount !== null ? `${item.likeCount} likes` : null,
    item.commentCount !== null ? `${item.commentCount} comments` : null,
    item.extra,
  ].filter(Boolean).join(', ');
  return `- [${item.pinId}] ${title} (${date}${stats ? `; ${stats}` : ''})`;
};

const formatInboxLine = (item: SurfInboxItem): string => {
  const date = item.createdAt > 0 ? new Date(item.createdAt * 1000).toISOString().slice(0, 10) : '?';
  const actor = item.actorName || item.actorGlobalMetaId || 'unknown';
  const excerpt = item.excerpt ? `: ${item.excerpt}` : '';
  return `- [${item.type}] ${actor} → ${item.targetPinId || item.pinId} (${date})${excerpt}`;
};

const formatRadarLine = (item: SurfProtocolRadarItem): string => {
  const date = item.createdAt > 0 ? new Date(item.createdAt * 1000).toISOString().slice(0, 10) : '?';
  const name = item.protocolName || item.title || '(unnamed protocol)';
  const title = item.title && item.title !== name ? ` — ${item.title}` : '';
  const author = item.authorName ? ` by ${item.authorName}` : '';
  return `- ${item.isNew ? '[NEW] ' : ''}${name} (${item.path || 'unknown path'}${title}${author}, ${date})`;
};

/**
 * Phase-2 digest report rendered when no LLM session ran (and always used as
 * the briefing appendix of the full report).
 */
export function renderSurfBriefingMarkdown(briefing: SurfBriefing): string {
  const lines: string[] = [
    '# Surf digest',
    '',
    `Generated: ${briefing.generatedAtIso}`,
    `Interaction budget: ${briefing.interactionBudget}`,
    '',
  ];
  for (const section of briefing.protocols) {
    lines.push(`## ${section.displayName} — ${section.keptCount} new`);
    if (section.error) {
      lines.push(`(fetch failed: ${section.error})`);
    }
    const items = briefing.items.filter((item) => item.protocolKey === section.key);
    for (const item of items.slice(0, 20)) {
      lines.push(formatItemLine(item));
    }
    if (items.length > 20) {
      lines.push(`- … and ${items.length - 20} more`);
    }
    if (section.droppedByTotalCap > 0) {
      lines.push(`- … plus ${section.droppedByTotalCap} more held back by the run cap — they stay unseen and return next surf`);
    }
    if (!section.error && section.keptCount === 0) {
      lines.push('- (nothing new)');
    }
    lines.push('');
  }
  if (briefing.inbox) {
    const sinceIso = briefing.inbox.sinceTs > 0
      ? new Date(briefing.inbox.sinceTs * 1000).toISOString().slice(0, 10)
      : '?';
    lines.push(`## Your inbox — ${briefing.inbox.items.length} new interaction(s) since ${sinceIso}`);
    if (briefing.inbox.error) {
      lines.push(`(inbox fetch failed: ${briefing.inbox.error})`);
    }
    for (const item of briefing.inbox.items) {
      lines.push(formatInboxLine(item));
    }
    if (!briefing.inbox.error && briefing.inbox.items.length === 0) {
      lines.push('- (nothing new)');
    }
    lines.push('');
  }
  if (briefing.protocolRadar) {
    lines.push(`## Protocol radar — ${briefing.protocolRadar.items.length} registered protocol(s)`);
    if (briefing.protocolRadar.error) {
      lines.push(`(radar fetch failed: ${briefing.protocolRadar.error})`);
    }
    for (const item of briefing.protocolRadar.items) {
      lines.push(formatRadarLine(item));
    }
    if (briefing.protocolRadar.rejectedCount > 0) {
      lines.push(`- … ${briefing.protocolRadar.rejectedCount} declaration(s) rejected by validation`);
    }
    if (!briefing.protocolRadar.error && briefing.protocolRadar.items.length === 0) {
      lines.push('- (none registered)');
    }
    lines.push('');
  }
  return lines.join('\n');
}
