/**
 * Human-readable surf run formatting shared by the CLI status verb and the
 * metaweb_surf_* chat tools. OAC port of the IDBots surfAgentTools formatters.
 */
import type { MetawebSurfRunRecord } from './store.js';
/** Human-readable surf run list (max 10 rows, newest first). */
export declare function formatSurfRunList(runs: MetawebSurfRunRecord[]): string;
/** One-line status block for the chat tools (banner + list). */
export declare function formatSurfStatusText(input: {
    running: boolean;
    runs: MetawebSurfRunRecord[];
}): string;
/** R2 batch read sheet: one block per requested pin, errors isolated. */
export declare function formatSurfBatchPins(entries: Record<string, import('./surfReads.js').MetawebBatchEntry>): string;
/** R4 pin versions sheet. */
export declare function formatSurfPinVersions(versions: import('./surfReads.js').MetawebPinVersions): string;
/** R6 protocol registry sheet. */
export declare function formatSurfProtocolRegistry(page: import('./surfReads.js').MetawebProtocolRadarPage): string;
/** Social feed bullets (search_social_posts). */
export declare function formatSurfSocialPosts(posts: Array<import('./socialRecall.js').SocialPostItem>, moreCursor: string | null): string;
/** Social post detail sheet. */
export declare function formatSurfSocialPostDetail(post: import('./socialRecall.js').SocialPostItem): string;
/** Social comment thread bullets. */
export declare function formatSurfSocialComments(page: import('./socialRecall.js').SocialCommentPage): string;
