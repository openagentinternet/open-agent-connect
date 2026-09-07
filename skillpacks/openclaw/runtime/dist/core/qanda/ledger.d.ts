/**
 * Local posting ledger for on-chain Q&A answers (simpleanswer protocol).
 * OAC port of the IDBots simpleQaAnswerLedger (kv-backed there), file-backed
 * here per the OAC storage layout (study-jobs.json precedent).
 *
 * Purpose: the post_simpleanswer path surfaces "you already answered this
 * question from this host, here is what you posted" so the acting bot can
 * decide whether a repeat answer adds value BEFORE spending sats. This is
 * host-side fact bookkeeping only (what this host published, keyed by the
 * acting bot); it is not a protocol constraint — the protocol allows any
 * number of answers per bot and must not be de-duplicated. Cross-machine
 * history arrives from the on-chain Q&A index; until it is reachable the
 * ledger only knows this host's own posts. `postedAt` is local bookkeeping
 * for display ordering only and never appears in protocol payloads (block
 * time is authoritative there).
 */
import type { MetabotPaths } from '../state/paths';
import type { QaAnswerItem } from './recall';
export interface QaAnswerLedgerEntry {
    answerPinId: string;
    content: string;
    postedAt: number;
    network: string;
}
export interface QaAnswerLedger {
    listAnswers(slug: string, questionPinId: string): Promise<QaAnswerLedgerEntry[]>;
    recordAnswer(slug: string, questionPinId: string, entry: QaAnswerLedgerEntry): Promise<void>;
}
export declare function createQaAnswerLedger(paths: MetabotPaths): QaAnswerLedger;
/**
 * Collect the acting bot's prior answers to one question. The on-chain Q&A
 * index is authoritative when reachable (complete across machines); the local
 * ledger covers indexer outages and pins too fresh to be indexed. Both are
 * FACTS for the bot's own decision — never a gate.
 */
export declare function collectPriorAnswers(input: {
    local: QaAnswerLedgerEntry[];
    /** Index lookup via /api/qa/questions/:pinId/answers?publisher=…; null = index not wired. */
    fetchRemote?: (() => Promise<QaAnswerItem[]>) | null;
}): Promise<{
    answers: QaAnswerLedgerEntry[];
    source: 'index' | 'local';
}>;
