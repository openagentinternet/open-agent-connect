// Deep-consolidation prompt — the LLM side of the memory-hygiene compression
// stroke, ported from IDBots src/main/libs/deepConsolidationPrompt.ts.
//
// While the other hygiene steps are deterministic, this pass periodically
// reviews the bot's belief layer (value boundaries, work reviews, knowledge
// points) and proposes retire/merge actions so beliefs stay few, current and
// high-weight as the bot ages — "wisdom aging" instead of endless
// accumulation. Every proposal is validated against the listed inventory and
// applied through existing versioned channels (soft archive / knowledge
// rewrite), so nothing is ever lost irreversibly.

export interface DeepConsolidationInventoryItem {
  id: string;
  kind: 'value_boundary' | 'work_review' | 'knowledge';
  text: string;
  extra?: string;
}

export interface DeepConsolidationRewrite {
  id: string;
  topic: string;
  summary: string;
  kind: 'know_how' | 'pitfall' | 'principle';
}

export interface DeepConsolidationOutput {
  retireMemoryIds: string[];
  retireKnowledgeIds: string[];
  rewriteKnowledge: DeepConsolidationRewrite[];
  notes: string;
}

const MIN_ITEMS_TO_CONSIDER = 8;

export function shouldRunDeepConsolidation(itemCount: number): boolean {
  return itemCount >= MIN_ITEMS_TO_CONSIDER;
}

/**
 * Maximum combined retire/rewrite actions one pass may propose — a quarter
 * of the inventory, rounded up. Shared by the prompt (so the model budgets
 * its own proposal) and the service guardrail (which refuses larger lists
 * as suspected hallucinated purges).
 */
export function deepConsolidationRetireCap(itemCount: number): number {
  return Math.ceil(itemCount * 0.25);
}

export function buildDeepConsolidationPrompt(input: {
  botName: string;
  items: DeepConsolidationInventoryItem[];
}): string {
  const lines: string[] = [];
  lines.push(
    `You are reviewing the long-term belief layer of MetaBot "${input.botName}" as part of a periodic deep-consolidation pass.`,
    'The layer below holds the bot\'s distilled value boundaries, work reviews and reusable knowledge points.',
    'Goal: keep this layer small, current and high-signal as the bot ages — merge what belongs together, retire what is outdated or contradicted.',
    '',
    'Rules:',
    '- Retire a value boundary only when it is clearly superseded by a newer one or refers to a bygone situation. Never retire boundaries that still look load-bearing.',
    '- Retire work reviews that summarize situations unlikely to matter for future tasks (one-off events, resolved episodes).',
    '- Retire knowledge points that duplicate another point or have been proven wrong; prefer rewriting (merging several stale points into one accurate point) over deletion when the underlying lesson still has value.',
    '- Rewrites must reuse an existing id and keep the topic focused; the system stores the prior text as a version, so rewrites are reversible.',
    '- Be conservative: when unsure, keep the item and explain in notes.',
    `- Propose at most ${deepConsolidationRetireCap(input.items.length)} combined retire/rewrite actions (a quarter of the inventory); the system refuses larger lists.`,
    '- Keep notes under 80 words and answer with the JSON object only — long per-item commentary is not read by anyone.',
    '- Output ONLY a JSON object, no prose around it.',
    '',
    'Output JSON shape:',
    '{"retire_memory_ids": ["<value_boundary/work_review id>"], "retire_knowledge_ids": ["<knowledge id>"], "rewrite_knowledge": [{"id": "<knowledge id>", "topic": "...", "summary": "...", "kind": "know_how|pitfall|principle"}], "notes": "<one short paragraph>"}',
    '',
    'Inventory (id | kind | text):',
  );
  for (const item of input.items) {
    const extra = item.extra ? ` [${item.extra}]` : '';
    lines.push(`- ${item.id} | ${item.kind} | ${item.text}${extra}`);
  }
  return lines.join('\n');
}

export function parseDeepConsolidationOutput(raw: string): DeepConsolidationOutput | null {
  const trimmed = raw.trim();
  const candidates = [trimmed];
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const asStringArray = (value: unknown): string[] => Array.isArray(value)
        ? value.map((entry) => String(entry)).filter(Boolean)
        : [];
      const rewrites = Array.isArray(parsed.rewrite_knowledge)
        ? parsed.rewrite_knowledge
            .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
            .filter((entry) => typeof entry.id === 'string' && typeof entry.topic === 'string' && typeof entry.summary === 'string')
            .map((entry) => ({
              id: String(entry.id),
              topic: String(entry.topic),
              summary: String(entry.summary),
              kind: (entry.kind === 'pitfall' || entry.kind === 'principle' ? entry.kind : 'know_how') as 'know_how' | 'pitfall' | 'principle',
            }))
        : [];
      return {
        retireMemoryIds: asStringArray(parsed.retire_memory_ids),
        retireKnowledgeIds: asStringArray(parsed.retire_knowledge_ids),
        rewriteKnowledge: rewrites,
        notes: typeof parsed.notes === 'string' ? parsed.notes : '',
      };
    } catch {
      // Try the next candidate slice.
    }
  }
  return null;
}

/**
 * Human-readable diagnosis for a parse failure — distinguishes an answer
 * with no JSON object at all (prose drift or truncation before the object
 * finished, e.g. the output-token budget cut the stream mid-list) from a
 * complete-but-malformed object, so the surfaced error line points at the
 * actual cause instead of a bare "unparseable output".
 */
export function describeDeepConsolidationParseFailure(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return 'empty output';
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return `no complete JSON object in ${trimmed.length} chars of output (prose answer, or truncated at the output-token budget)`;
  }
  return `malformed JSON object (${trimmed.length} chars)`;
}
