/**
 * Human-readable renderings of on-chain Q&A data for bot-facing tool output:
 * question/answer bullet lists (titles as pin:// links, authors as metaid://
 * links), the question-detail sheet, and the already-answered notice. OAC
 * port of the IDBots feat/metaweb-qa qaRecallAgentTools formatters.
 */
import type { QaAnswerItem, QaQuestionDetail, QaQuestionItem } from './recall';
import type { QaAnswerLedgerEntry } from './ledger';
/** Ready-to-quote markdown bullets for question items; titles are pin:// links, authors metaid:// links. */
export declare function formatQaQuestionBullets(items: QaQuestionItem[]): string;
/** Ready-to-quote markdown bullets for ranked answer items. */
export declare function formatQaAnswerBullets(items: QaAnswerItem[]): string;
/** Human-readable sheet for one question with its ranked answers. */
export declare function formatQaQuestionDetail(input: {
    question: QaQuestionItem;
    answers: QaAnswerItem[];
}): string;
/**
 * Informational (non-error) notice shown when prior answers exist. States
 * facts and options; the publish/not-publish decision stays with the bot.
 * `source` says where the facts came from: the on-chain Q&A index (complete
 * across machines) or this host's local records (index unreachable).
 */
export declare function formatAlreadyAnsweredNotice(questionPinId: string, answers: QaAnswerLedgerEntry[], source?: 'index' | 'local'): string;
/** Convenience wrapper naming the question-page view link for detail results. */
export declare function qaQuestionDetailViewLink(detail: QaQuestionDetail): string;
