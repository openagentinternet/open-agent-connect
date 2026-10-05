/**
 * Participation drafts (UI reference F13): the prefilled, mode-aware prompt a
 * human hands to a bot session to join a task. The templates are the IDBots
 * `metatask.participateDraft` / `participateDraftCompetitive` copy ported
 * verbatim with one permitted change (UI ref §8): IDBots tool names are
 * spelled as `metabot metatask …` CLI verbs, in both languages. The UIs never
 * write — they only hand the user this draft.
 */
import type { MetaTaskTaskProjection } from './engine/types';
export interface ParticipateDraft {
    lang: 'en' | 'zh';
    mode: 'tree' | 'competitive';
    /** The suggested node the hint names, null when nothing is open. */
    node: string | null;
    text: string;
}
/**
 * Suggested first node: among open nodes prefer entry nodes (deps: []) with
 * the fewest competing candidates, then the fewest deps, then id order; when
 * nothing is open the draft carries no hint.
 */
export declare const suggestParticipateNode: (projection: MetaTaskTaskProjection) => string | null;
export declare function buildParticipateDraft(projection: MetaTaskTaskProjection, options?: {
    lang?: 'en' | 'zh';
    node?: string | null;
}): ParticipateDraft;
