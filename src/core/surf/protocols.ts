/**
 * MetaWeb surf protocol registry. OAC port of the IDBots surfProtocols.
 *
 * One descriptor per surfable chain protocol: how to fetch fresh items since
 * the bot's watermark (or continue a registered backlog page), how to search
 * old items, which interactions the bot may perform, and a relevance hint
 * rendered into the surf prompt. Adding support for a future protocol means
 * adding one descriptor here — the surf loop itself never hard-codes
 * protocol behavior.
 *
 * Stage-0 fresh fetches are backed by the metaso-p2p "surf reads" API
 * (surf/surfReads.ts, R1): deterministic total order, inclusive `since`,
 * gap-free cursor paging, byte-identical dedupe and per-author throttling.
 * agentpedia is NOT indexed server-side and stays on the MANAPI path-list
 * client.
 */
import { qaSearch } from '../qanda/recall.js';
import { searchMetaweb, type MetawebSearchItem } from '../metaweb/search.js';
import { listPinsByPath, type ManapiPathListItem } from './manapiPins.js';
import { metawebFresh, type MetawebFreshItem } from './surfReads.js';
import { getSocialFeed, type SocialPostItem } from './socialRecall.js';

/** One content item surfaced to the bot during a surf run. */
export interface SurfItem {
  /** Pin id to deep-read (current version when the source folds revisions). */
  pinId: string;
  protocolKey: string;
  chainName: string;
  title: string;
  summary: string;
  authorName: string;
  authorGlobalMetaId: string;
  /** Unix seconds. */
  createdAt: number;
  likeCount: number | null;
  commentCount: number | null;
  /** Short protocol-specific note, e.g. "3 answers". */
  extra: string | null;
  /**
   * Server-side byte-identical dedupe (R1 dedupe=identical): number of
   * collapsed copies when > 1, already rendered into `extra` as "×N copies".
   */
  duplicates?: number;
}

/**
 * One stage-0 fetch result. `nextCursor` is an OPAQUE server token (R1
 * cursor paging pins the exact index key) — surfBriefing stores and forwards
 * it verbatim, never parses it.
 */
export interface SurfFreshPage {
  items: SurfItem[];
  hasMore: boolean;
  nextCursor: string | null;
}

export type SurfInteraction = 'like' | 'comment' | 'answer' | 'ask' | 'post' | 'challenge';

export interface SurfProtocolDescriptor {
  key: string;
  displayName: string;
  /** Chain paths this protocol lives under — used for new-protocol discovery. */
  paths: string[];
  interactions: SurfInteraction[];
  /** Persona-matching guidance rendered into the surf prompt. */
  relevanceHint: string;
  /**
   * Fetch one stage-0 page. Without `backlogCursor` this is the normal
   * since-window fetch (items with createdAt >= sinceTs); with a cursor it
   * is a BACKLOG page continuing an earlier window whose first page
   * reported hasMore — the cursor alone pins the resume point, so
   * implementations must NOT send `since` alongside it (backlog items are
   * older than the watermark and would be filtered out server-side).
   */
  fetchFresh: (input: {
    sinceTs: number | null;
    limit: number;
    backlogCursor?: string | null;
  }) => Promise<SurfFreshPage>;
  search?: (input: { query: string; limit: number }) => Promise<SurfItem[]>;
}

export type SurfProtocolOptions = {
  /** so.metaid.io override (METABOT_METAWEB_API_BASE_URL propagation). */
  baseUrl?: string;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** contentSummary is truncated server-side and may not parse; best-effort. */
function extractJsonField(raw: string, field: string): string {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return text(parsed?.[field]);
  } catch {
    const match = new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(raw);
    if (!match) return '';
    try {
      return JSON.parse(`"${match[1]}"`) as string;
    } catch {
      return match[1];
    }
  }
}

const fromSocialPost = (item: SocialPostItem): SurfItem => ({
  pinId: item.currentPinId || item.pinId,
  protocolKey: 'simplebuzz',
  chainName: item.chainName || 'mvc',
  title: '',
  summary: (item.payload?.content ?? '').slice(0, 280),
  authorName: '',
  authorGlobalMetaId: item.author.globalMetaId,
  createdAt: item.createdAt,
  likeCount: item.likeCount,
  commentCount: item.commentCount,
  extra: item.quoteCount > 0 ? `${item.quoteCount} quotes` : null,
});

const fromSearchItem = (item: MetawebSearchItem, protocolKey: string): SurfItem => ({
  pinId: item.currentPinId || item.pinId,
  protocolKey,
  chainName: item.chainName || 'mvc',
  title: item.title,
  summary: item.summary,
  authorName: item.publisher.name,
  authorGlobalMetaId: item.publisher.globalMetaId,
  createdAt: item.createdAt,
  likeCount: null,
  commentCount: null,
  extra: null,
});

const fromQaQuestion = (item: import('../qanda/recall.js').QaQuestionItem): SurfItem => ({
  pinId: item.currentPinId || item.pinId,
  protocolKey: 'simplequestion',
  chainName: item.chainName || 'mvc',
  title: item.title,
  summary: item.summary,
  authorName: item.publisher.name,
  authorGlobalMetaId: item.publisher.globalMetaId,
  createdAt: item.createdAt,
  likeCount: item.likeCount,
  commentCount: item.commentCount,
  extra: item.answerCount > 0
    ? `${item.answerCount} answers`
    : 'unanswered',
});

const fromManapiItem = (item: ManapiPathListItem, protocolKey: string): SurfItem => {
  const title = extractJsonField(item.contentSummary, 'title');
  const content = extractJsonField(item.contentSummary, 'content');
  const slug = extractJsonField(item.contentSummary, 'slug');
  return {
    pinId: item.pinId,
    protocolKey,
    chainName: 'mvc',
    title,
    summary: (content || item.contentSummary).slice(0, 280),
    authorName: '',
    authorGlobalMetaId: item.globalMetaId,
    createdAt: item.timestamp || item.seenTime,
    likeCount: null,
    commentCount: null,
    extra: slug ? `entry: ${slug}` : null,
  };
};

/** R1 fresh-feed item → SurfItem. `protocolKey` buckets the item (answers map onto their question section). */
const fromFreshItem = (item: MetawebFreshItem, protocolKey: string): SurfItem => {
  const base: SurfItem = {
    pinId: item.currentPinId || item.pinId,
    protocolKey,
    chainName: item.chainName || 'mvc',
    title: item.title,
    summary: item.summary,
    authorName: item.author.name,
    authorGlobalMetaId: item.author.globalMetaId,
    createdAt: item.createdAt,
    likeCount: item.likeCount,
    commentCount: item.commentCount,
    extra: null,
  };
  return withDuplicatesExtra(base, item.duplicates ?? null);
};

/**
 * R1 dedupe=identical collapses byte-identical copies onto the newest one;
 * surface the collapse count so the bot knows the chain echoed this content.
 */
const withDuplicatesExtra = (item: SurfItem, duplicates: number | null): SurfItem => {
  if (!duplicates || duplicates <= 1) return item;
  const copies = `×${duplicates} copies`;
  return {
    ...item,
    duplicates,
    extra: item.extra ? `${item.extra}, ${copies}` : copies,
  };
};

/**
 * Freshness filter for fetchFresh implementations. `>=` (not `>`): a pin
 * created in the SAME second as the previous watermark must come back on the
 * next run — the seen ledger dedupes anything already presented, so the
 * boundary second costs one re-fetch at most, while a strict `>` skipped
 * same-second stragglers forever (IDBots review 2, item 2). R1's server-side
 * `since` is already inclusive; this is the belt-and-braces client-side layer.
 */
export const sinceFiltered = (items: SurfItem[], sinceTs: number | null, limit: number): SurfItem[] =>
  items
    .filter((item) => item.pinId && (sinceTs === null || item.createdAt >= sinceTs))
    .slice(0, limit);

/**
 * Backlog-window split for the client-side freshness filter. A BACKLOG page
 * is resumed by the server cursor ALONE: its items are OLDER than the
 * watermark by construction, so the sinceTs filter must NOT run on them —
 * it would drop every backlog item while the cursor still advances, paging
 * past unseen content forever (the exact silent-loss class the backlog
 * mechanism exists to fix). Window pages keep the >= belt-and-braces filter.
 */
export const applyFreshWindowFilter = (
  items: SurfItem[],
  sinceTs: number | null,
  limit: number,
  isBacklog: boolean,
): SurfItem[] =>
  isBacklog
    ? items.filter((item) => item.pinId).slice(0, limit)
    : sinceFiltered(items, sinceTs, limit);

/**
 * Backlog-window split for the R1-backed descriptors: a backlog page is
 * resumed by cursor ALONE — sending `since` alongside would filter out every
 * backlog item (they are older than the watermark server-side).
 */
const freshWindowArgs = (sinceTs: number | null, backlogCursor?: string | null): { since?: number; cursor?: string } =>
  backlogCursor
    ? { cursor: backlogCursor }
    : { since: sinceTs ?? undefined };

/** Build the default registry; `options.baseUrl` overrides the aggregation base. */
export function createSurfProtocols(options: SurfProtocolOptions = {}): SurfProtocolDescriptor[] {
  const readsOptions = options.baseUrl ? { baseUrl: options.baseUrl } : undefined;

  const simplebuzz: SurfProtocolDescriptor = {
    key: 'simplebuzz',
    displayName: 'Buzz (on-chain microblog)',
    paths: ['/protocols/simplebuzz'],
    interactions: ['like', 'comment'],
    relevanceHint:
      'Short posts. Save the ones that teach something about your role or goals; ' +
      'like genuinely good content; comment only when you have something real to add.',
    fetchFresh: async ({ sinceTs, limit, backlogCursor }) => {
      // maxPerAuthor throttles feed-flooding repost chains; dedupe collapses
      // byte-identical echoes (both reported back in `suppressed`).
      const page = await metawebFresh(
        {
          protocols: ['simplebuzz'],
          size: limit,
          dedupe: 'identical',
          maxPerAuthor: 3,
          ...freshWindowArgs(sinceTs, backlogCursor),
        },
        readsOptions,
      );
      return {
        items: applyFreshWindowFilter(page.items.map((item) => fromFreshItem(item, 'simplebuzz')), sinceTs, limit, backlogCursor != null),
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      };
    },
    search: async ({ query, limit }) => {
      const page = await getSocialFeed({ keyword: query, size: limit, sort: 'newest' }, readsOptions);
      return page.items.map(fromSocialPost).slice(0, limit);
    },
  };

  const simplenote: SurfProtocolDescriptor = {
    key: 'simplenote',
    displayName: 'SimpleNote (on-chain blog)',
    paths: ['/protocols/simplenote'],
    interactions: ['like', 'comment'],
    relevanceHint:
      'Long-form articles. Your main learning source: save articles that deepen ' +
      'your professional knowledge, distill key points into your knowledge store.',
    fetchFresh: async ({ sinceTs, limit, backlogCursor }) => {
      // NO maxPerAuthor here: throttling could hide legit long-form authors
      // who published several articles inside one window.
      const page = await metawebFresh(
        {
          protocols: ['simplenote'],
          size: limit,
          dedupe: 'identical',
          ...freshWindowArgs(sinceTs, backlogCursor),
        },
        readsOptions,
      );
      return {
        items: applyFreshWindowFilter(page.items.map((item) => fromFreshItem(item, 'simplenote')), sinceTs, limit, backlogCursor != null),
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      };
    },
    search: async ({ query, limit }) => {
      const page = await searchMetaweb({ q: query, protocols: ['simplenote'], size: limit }, readsOptions);
      return page.items.map((item) => fromSearchItem(item, 'simplenote')).slice(0, limit);
    },
  };

  const simplequestion: SurfProtocolDescriptor = {
    key: 'simplequestion',
    displayName: 'Q&A (on-chain Quora)',
    paths: ['/protocols/simplequestion', '/protocols/simpleanswer'],
    interactions: ['like', 'answer', 'ask', 'comment'],
    relevanceHint:
      'Community questions. Answer only questions squarely inside your role and ' +
      'expertise, with genuinely helpful answers; like good answers from others; ' +
      'ask a question yourself only when you truly need help.',
    fetchFresh: async ({ sinceTs, limit, backlogCursor }) => {
      // R1 serves fresh QUESTIONS and ANSWERS in one feed — answers to old
      // questions now surface in this section the night they land (the old
      // qaLatestQuestions feed only carried questions, so every answer was
      // invisible until the inbox workaround polled for it).
      const page = await metawebFresh(
        {
          protocols: ['simplequestion', 'simpleanswer'],
          size: limit,
          ...freshWindowArgs(sinceTs, backlogCursor),
        },
        readsOptions,
      );
      const items = page.items.map((item) => {
        if (item.protocol === 'simpleanswer') {
          const answer = fromFreshItem(item, 'simplequestion');
          return { ...answer, extra: 'new answer' };
        }
        // R1 carries no answerCount — question items get no extra.
        return fromFreshItem(item, 'simplequestion');
      });
      return {
        items: applyFreshWindowFilter(items, sinceTs, limit, backlogCursor != null),
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      };
    },
    search: async ({ query, limit }) => {
      const page = await qaSearch({ q: query, size: limit }, readsOptions);
      return page.items.map(fromQaQuestion).slice(0, limit);
    },
  };

  const agentpedia: SurfProtocolDescriptor = {
    key: 'agentpedia',
    displayName: 'Agentpedia (on-chain encyclopedia)',
    paths: ['/protocols/agentpedia/rev'],
    interactions: ['challenge'],
    relevanceHint:
      'The shared encyclopedia bots reach consensus from. Learn entries related ' +
      'to your role. Conservative mode: only challenge an entry when you are ' +
      'confident it is factually wrong — never for style or wording.',
    // agentpedia is NOT indexed by the surf-reads backend; this stays on the
    // MANAPI path list, which has no paging cursor — the window is what it is.
    fetchFresh: async ({ sinceTs, limit }) => {
      const page = await listPinsByPath({ path: '/protocols/agentpedia/rev', size: limit });
      return {
        items: sinceFiltered(page.items.map((item) => fromManapiItem(item, 'agentpedia')), sinceTs, limit),
        hasMore: false,
        nextCursor: null,
      };
    },
  };

  return [simplebuzz, simplenote, simplequestion, agentpedia];
}

/** Default registry with production base URLs. */
export const DEFAULT_SURF_PROTOCOLS: SurfProtocolDescriptor[] = createSurfProtocols();
