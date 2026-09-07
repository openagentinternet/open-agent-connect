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

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { MetabotPaths } from '../state/paths';
import type { QaAnswerItem } from './recall';
import { QaRecallNotFoundError } from './recall';

export interface QaAnswerLedgerEntry {
  answerPinId: string;
  content: string;
  postedAt: number;
  network: string;
}

const MAX_ENTRIES_PER_QUESTION = 50;
const MAX_CONTENT_CHARS = 8000;

export interface QaAnswerLedger {
  listAnswers(slug: string, questionPinId: string): Promise<QaAnswerLedgerEntry[]>;
  recordAnswer(slug: string, questionPinId: string, entry: QaAnswerLedgerEntry): Promise<void>;
}

interface QaAnswerLedgerFile {
  entries: Record<string, QaAnswerLedgerEntry[]>;
}

function ledgerKey(slug: string, questionPinId: string): string {
  return `${slug}:${questionPinId}`;
}

function parseEntries(raw: unknown): QaAnswerLedgerEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: QaAnswerLedgerEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Partial<QaAnswerLedgerEntry>;
    if (typeof candidate.answerPinId !== 'string' || !candidate.answerPinId) continue;
    if (typeof candidate.content !== 'string') continue;
    entries.push({
      answerPinId: candidate.answerPinId,
      content: candidate.content,
      postedAt: typeof candidate.postedAt === 'number' ? candidate.postedAt : 0,
      network: typeof candidate.network === 'string' ? candidate.network : '',
    });
  }
  return entries;
}

export function createQaAnswerLedger(paths: MetabotPaths): QaAnswerLedger {
  const filePath = path.join(paths.workspaceRoot, 'memory', 'qanda-answer-ledger.json');

  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };

  async function readFile(): Promise<QaAnswerLedgerFile> {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<QaAnswerLedgerFile>;
      const entries = parsed?.entries;
      return {
        entries: entries && typeof entries === 'object' && !Array.isArray(entries)
          ? entries as Record<string, QaAnswerLedgerEntry[]>
          : {},
      };
    } catch {
      return { entries: {} };
    }
  }

  async function writeFile(state: QaAnswerLedgerFile): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmpPath, JSON.stringify(state, null, 2), 'utf8');
    await fs.rename(tmpPath, filePath);
  }

  return {
    // Junk-tolerant read: a corrupt file reads as "no prior answers".
    listAnswers: async (slug, questionPinId) => {
      if (!slug || !questionPinId) return [];
      try {
        const state = await readFile();
        return parseEntries(state.entries[ledgerKey(slug, questionPinId)]);
      } catch {
        return [];
      }
    },

    // Best-effort write: a ledger failure must never break a successful post.
    recordAnswer: (slug, questionPinId, entry) => enqueue(async () => {
      if (!slug || !questionPinId || !entry.answerPinId) return;
      try {
        const state = await readFile();
        const key = ledgerKey(slug, questionPinId);
        const entries = [
          ...parseEntries(state.entries[key]),
          { ...entry, content: entry.content.slice(0, MAX_CONTENT_CHARS) },
        ];
        state.entries[key] = entries.slice(-MAX_ENTRIES_PER_QUESTION);
        await writeFile(state);
      } catch (error) {
        console.warn(
          '[qandaAnswerLedger] failed to record answer (posting itself succeeded):',
          error instanceof Error ? error.message : String(error),
        );
      }
    }),
  };
}

/**
 * Collect the acting bot's prior answers to one question. The on-chain Q&A
 * index is authoritative when reachable (complete across machines); the local
 * ledger covers indexer outages and pins too fresh to be indexed. Both are
 * FACTS for the bot's own decision — never a gate.
 */
export async function collectPriorAnswers(input: {
  local: QaAnswerLedgerEntry[];
  /** Index lookup via /api/qa/questions/:pinId/answers?publisher=…; null = index not wired. */
  fetchRemote?: (() => Promise<QaAnswerItem[]>) | null;
}): Promise<{ answers: QaAnswerLedgerEntry[]; source: 'index' | 'local' }> {
  const local = input.local;
  if (!input.fetchRemote) {
    return { answers: local, source: 'local' };
  }
  try {
    const remote = await input.fetchRemote();
    const seen = new Set<string>();
    const answers: QaAnswerLedgerEntry[] = [];
    for (const item of remote) {
      if (!item?.pinId || seen.has(item.pinId)) continue;
      seen.add(item.pinId);
      answers.push({
        answerPinId: item.pinId,
        content: item.summary || '(indexed answer; open it via the view link)',
        postedAt: item.createdAt ? item.createdAt * 1000 : 0,
        network: item.chainName || '',
      });
    }
    for (const entry of local) {
      if (!seen.has(entry.answerPinId)) {
        seen.add(entry.answerPinId);
        answers.push(entry);
      }
    }
    return { answers, source: 'index' };
  } catch (error) {
    // Unknown question (not indexed) has no indexed answers: keep it as an
    // empty-but-authoritative result. Other failures fall back to the local
    // ledger.
    if (error instanceof QaRecallNotFoundError) {
      return { answers: local, source: 'index' };
    }
    return { answers: local, source: 'local' };
  }
}
