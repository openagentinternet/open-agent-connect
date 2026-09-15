/**
 * Human-readable surf run formatting shared by the CLI status verb and the
 * metaweb_surf_* chat tools. OAC port of the IDBots surfAgentTools formatters.
 */
import type { MetawebSurfRunRecord } from './store.js';
import { isBatchErrorEntry } from './surfReads.js';

/** Human-readable surf run list (max 10 rows, newest first). */
export function formatSurfRunList(runs: MetawebSurfRunRecord[]): string {
  if (runs.length === 0) {
    return 'No surf runs yet. Start one with metaweb_surf_start or `metabot surf run`, or enable surf-before-dream for a nightly surf.';
  }
  const lines = runs.slice(0, 10).map((run) => {
    const stats = run.stats;
    const acted = [
      stats.savedToKb ? `${stats.savedToKb} saved` : null,
      stats.liked ? `${stats.liked} liked` : null,
      stats.commented ? `${stats.commented} commented` : null,
      stats.answered ? `${stats.answered} answered` : null,
    ].filter(Boolean).join(', ');
    const headline = run.reportMarkdown?.split('\n').find((line) => line.trim() && !line.startsWith('#'))?.trim();
    return [
      `- [${run.status}] ${run.startedAt.slice(0, 16).replace('T', ' ')} (${run.trigger})`,
      `  fetched ${stats.fetched} new · deep-read ${stats.deepRead}${acted ? ` · ${acted}` : ''}`,
      run.error ? `  error: ${run.error}` : null,
      headline ? `  ${headline.slice(0, 140)}` : null,
    ].filter(Boolean).join('\n');
  });
  return [`Recent surf runs (newest first, ${runs.length} total):`, ...lines].join('\n');
}

/** One-line status block for the chat tools (banner + list). */
export function formatSurfStatusText(input: { running: boolean; runs: MetawebSurfRunRecord[] }): string {
  const header = input.running ? 'A surf run is IN PROGRESS right now.\n' : '';
  return `${header}${formatSurfRunList(input.runs)}`;
}

// ---------------- surf-session read formatters ----------------

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** R2 batch read sheet: one block per requested pin, errors isolated. */
export function formatSurfBatchPins(
  entries: Record<string, import('./surfReads.js').MetawebBatchEntry>,
): string {
  const blocks: string[] = [];
  for (const [requestedId, entry] of Object.entries(entries)) {
    if (isBatchErrorEntry(entry)) {
      blocks.push(`## ${requestedId}\n(error: ${entry.error})`);
      continue;
    }
    const lines = [`## ${entry.pinId}`];
    lines.push(`- path: ${entry.path || 'unknown'} · author: ${entry.creator.name || entry.creator.globalMetaId || 'unknown'}`);
    if (entry.meta.title) lines.push(`- title: ${clip(entry.meta.title, 200)}`);
    if (entry.text != null) {
      lines.push(`- body${entry.truncated ? ` (truncated — payload holds the full text, total ${entry.totalLength ?? '?'} runes)` : ''}:`);
      lines.push(clip(entry.text, 4000));
    } else {
      lines.push('- body: (empty/binary/encrypted — skip)');
    }
    if (entry.version.count != null) lines.push(`- versions: ${entry.version.count}`);
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n') || '(no pins returned)';
}

/** R4 pin versions sheet. */
export function formatSurfPinVersions(versions: import('./surfReads.js').MetawebPinVersions): string {
  const lines = [
    `Pin ${versions.pinId} — ${versions.versions.length} version(s), attribution: ${versions.attribution}`,
    `- latest: ${versions.latest || '(unknown)'}`,
  ];
  for (const entry of versions.versions) {
    const date = entry.createdAt > 0 ? new Date(entry.createdAt * 1000).toISOString().slice(0, 10) : '?';
    lines.push(`- v${entry.version || '?'} ${entry.operation || 'create'} ${entry.pinId} (${date}) by ${entry.author.name || entry.author.globalMetaId || 'unknown'}`);
  }
  return lines.join('\n');
}

/** R6 protocol registry sheet. */
export function formatSurfProtocolRegistry(page: import('./surfReads.js').MetawebProtocolRadarPage): string {
  if (page.items.length === 0) return 'No registered protocols.';
  const lines = page.items.map((item) => {
    const date = item.createdAt > 0 ? new Date(item.createdAt * 1000).toISOString().slice(0, 10) : '?';
    return `- ${item.protocolName || item.title || '(unnamed)'} (${item.path}${item.version ? ` v${item.version}` : ''}, ${date})${item.intro ? ` — ${clip(item.intro, 160)}` : ''}`;
  });
  if (page.hasMore && page.nextCursor) lines.push(`(more: pass cursor="${page.nextCursor}")`);
  if (page.rejected.length) lines.push(`(${page.rejected.length} declaration(s) rejected by validation)`);
  return lines.join('\n');
}

/** Social feed bullets (search_social_posts). */
export function formatSurfSocialPosts(posts: Array<import('./socialRecall.js').SocialPostItem>, moreCursor: string | null): string {
  if (posts.length === 0) return 'No social posts matched.';
  const lines = posts.map((post) => {
    const date = post.createdAt > 0 ? new Date(post.createdAt * 1000).toISOString().slice(0, 10) : '?';
    const stats = [
      post.likeCount ? `${post.likeCount}↑` : null,
      post.commentCount ? `${post.commentCount}💬` : null,
    ].filter(Boolean).join(' ');
    return `- [${post.currentPinId || post.pinId}] ${clip(post.payload?.content ?? '(empty)', 200)} (${date}${stats ? `; ${stats}` : ''})`;
  });
  if (moreCursor) lines.push(`(more: pass cursor="${moreCursor}")`);
  return lines.join('\n');
}

/** Social post detail sheet. */
export function formatSurfSocialPostDetail(post: import('./socialRecall.js').SocialPostItem): string {
  const lines = [
    `## ${post.pinId}`,
    `- author: ${post.author.globalMetaId || 'unknown'} · ${post.chainName || 'mvc'}`,
    `- stats: ${post.likeCount}↑ ${post.commentCount}💬 ${post.donateCount} donate ${post.quoteCount} quotes`,
    '- body:',
    clip(post.payload?.content ?? '(empty)', 4000),
  ];
  return lines.join('\n');
}

/** Social comment thread bullets. */
export function formatSurfSocialComments(
  page: import('./socialRecall.js').SocialCommentPage,
): string {
  if (page.items.length === 0) return 'No comments yet.';
  const lines = page.items.map((comment) => {
    const date = comment.timestamp > 0 ? new Date(comment.timestamp * 1000).toISOString().slice(0, 10) : '?';
    return `- [${comment.pinId}] ${comment.authorGlobalMetaId || 'unknown'} (${date}): ${clip(comment.content, 240)}`;
  });
  if (page.hasMore && page.nextCursor) lines.push(`(more: pass cursor="${page.nextCursor}")`);
  return lines.join('\n');
}
