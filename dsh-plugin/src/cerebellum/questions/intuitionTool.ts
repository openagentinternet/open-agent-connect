/**
 * Cerebellum (小脑) intuition tool — the brain-callable judgment primitive.
 * Port of IDBots src/main/cerebellum/intuitionTool.ts @ commit
 * d75bea8ac2249da4886bfa0f6f1db838d234ef1f (byte-synced semantics; import
 * specifiers are extension-ful for NodeNext, and this header replaces the
 * Electron-session note — the OAC call context injects a proxy-aware Node
 * fetch instead, see cerebellum/client.ts).
 *
 * Exposes the fast decision model (TypeSafe JEV) to the MetaBot itself as an
 * inline tool (`intuition`): the brain composes questions (noul / choice /
 * score) plus the content to judge, and gets back calibrated probabilities.
 * Everything the infra integrations do invisibly (memory write gate, skill
 * shortlist, volatile block gate) stays in the infra — this tool serves the
 * ad-hoc judgments only the brain knows it needs.
 *
 * Pure and host-free so it is unit-testable in plain Node; the caller
 * injects the fetch implementation.
 *
 * Failure contract: askCerebellumIntuition NEVER throws and returns null on
 * HTTP errors, network errors, abort/timeout, and malformed payloads — the
 * tool handler then reports an honest "no verdict" to the model instead of
 * inventing one.
 *
 * Bot-authored inputs are untrusted: validateIntuitionInput enforces hard
 * caps on every dimension (context length, question count, option count,
 * level count, instruction length) so a runaway or prompt-injected model
 * cannot balloon the request or exfiltrate oversized content.
 */

import type { ResolvedCerebellumConfig } from '../config.js';
import type { CerebellumFetchLike } from './memoryRank.js';

/**
 * The tool call is an EXPLICIT brain request (like any other tool the model
 * chose to run), so it gets a slightly larger budget than the invisible
 * turn-path injections (1500 ms) — but still hard-bounded.
 */
export const CEREBELLUM_INTUITION_TIMEOUT_MS = 3000;

/** Hard caps on bot-authored input — see module doc. */
export const CEREBELLUM_INTUITION_MAX_CONTEXT_CHARS = 6000;
export const CEREBELLUM_INTUITION_MAX_QUESTIONS = 6;
export const CEREBELLUM_INTUITION_MAX_INSTRUCTION_CHARS = 600;
export const CEREBELLUM_INTUITION_MAX_OPTIONS = 24;
export const CEREBELLUM_INTUITION_MAX_OPTION_CHARS = 240;
export const CEREBELLUM_INTUITION_MIN_LEVELS = 2;
export const CEREBELLUM_INTUITION_MAX_LEVELS = 10;
export const CEREBELLUM_INTUITION_MAX_LEVEL_CHARS = 160;

/** Rolling-window guardrail against runaway intuition loops. */
export const CEREBELLUM_INTUITION_WINDOW_MS = 60_000;
export const CEREBELLUM_INTUITION_WINDOW_MAX_CALLS = 3;

export type CerebellumIntuitionQuestionType = 'noul' | 'choice' | 'score';

export interface CerebellumIntuitionQuestion {
  /** Caller-visible answer key. Auto-generated (q1, q2, ...) when absent. */
  id: string;
  type: CerebellumIntuitionQuestionType;
  /** English instructions work best; the judged content stays in `context`. */
  instructions: string;
  /** noul only: the two criteria sentences (defaults when omitted). */
  criteria?: { true: string; false: string };
  /** choice only: option id -> one-line description. */
  options?: Record<string, string>;
  /** score only: level descriptions ordered from the low end to the high end. */
  levels?: string[];
}

export interface CerebellumIntuitionRequest {
  state: string;
  model: string;
  questions: Record<string, unknown>;
}

export interface CerebellumIntuitionAnswer {
  noul?: number;
  choice?: string;
  probabilities?: Record<string, number>;
  score?: number;
  confidence?: number;
  legend?: Record<string, unknown>;
}

const DEFAULT_NOUL_CRITERIA = {
  true: 'The answer to the question is yes.',
  false: 'The answer to the question is no.',
} as const;

export interface IntuitionValidation {
  /** Normalized questions, or null when the input failed validation. */
  questions: CerebellumIntuitionQuestion[] | null;
  /** The teaching error for the model, or null when input is valid. */
  error: string | null;
}

/**
 * Validate and normalize raw tool arguments. Returns a null `questions` with
 * a human-readable `error` the tool handler surfaces to the model verbatim
 * (a clear error teaches the model to re-ask within bounds; silent
 * truncation does not).
 */
export function validateIntuitionInput(input: {
  context?: unknown;
  questions?: unknown;
}): IntuitionValidation {
  const context = typeof input.context === 'string' ? input.context : '';
  if (!context.trim()) {
    return { questions: null, error: 'intuition: "context" is required — provide the text to judge (the user\'s original language is fine).' };
  }
  if (context.length > CEREBELLUM_INTUITION_MAX_CONTEXT_CHARS) {
    return { questions: null, error: `intuition: "context" exceeds ${CEREBELLUM_INTUITION_MAX_CONTEXT_CHARS} chars (${context.length}) — quote only the part the judgments need.` };
  }
  if (!Array.isArray(input.questions) || input.questions.length === 0) {
    return { questions: null, error: 'intuition: "questions" must be a non-empty array (1-' + CEREBELLUM_INTUITION_MAX_QUESTIONS + ').' };
  }
  if (input.questions.length > CEREBELLUM_INTUITION_MAX_QUESTIONS) {
    return { questions: null, error: `intuition: at most ${CEREBELLUM_INTUITION_MAX_QUESTIONS} questions per call (got ${input.questions.length}).` };
  }

  const seenIds = new Set<string>();
  const questions: CerebellumIntuitionQuestion[] = [];
  for (const [index, raw] of input.questions.entries()) {
    if (!raw || typeof raw !== 'object') {
      return { questions: null, error: `intuition: questions[${index}] must be an object.` };
    }
    const row = raw as Record<string, unknown>;
    const type = row.type;
    if (type !== 'noul' && type !== 'choice' && type !== 'score') {
      return { questions: null, error: `intuition: questions[${index}].type must be "noul", "choice", or "score".` };
    }
    const instructions = typeof row.question === 'string' ? row.question : '';
    if (!instructions.trim()) {
      return { questions: null, error: `intuition: questions[${index}].question is required (English wording works best).` };
    }
    if (instructions.length > CEREBELLUM_INTUITION_MAX_INSTRUCTION_CHARS) {
      return { questions: null, error: `intuition: questions[${index}].question exceeds ${CEREBELLUM_INTUITION_MAX_INSTRUCTION_CHARS} chars — keep each question atomic.` };
    }

    const rawId = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : `q${index + 1}`;
    const id = /^[a-zA-Z0-9_-]{1,32}$/.test(rawId) ? rawId : `q${index + 1}`;
    if (seenIds.has(id)) {
      return { questions: null, error: `intuition: duplicate question id "${id}" — ids must be unique (or omitted).` };
    }
    seenIds.add(id);

    const question: CerebellumIntuitionQuestion = { id, type, instructions };

    if (type === 'choice') {
      if (!row.options || typeof row.options !== 'object' || Array.isArray(row.options)) {
        return { questions: null, error: `intuition: questions[${index}] is type "choice" and requires "options" (an object of option_id -> one-line description).` };
      }
      const entries = Object.entries(row.options as Record<string, unknown>);
      if (entries.length < 2) {
        return { questions: null, error: `intuition: questions[${index}].options needs at least 2 options.` };
      }
      if (entries.length > CEREBELLUM_INTUITION_MAX_OPTIONS) {
        return { questions: null, error: `intuition: questions[${index}].options exceeds ${CEREBELLUM_INTUITION_MAX_OPTIONS} options.` };
      }
      const options: Record<string, string> = {};
      for (const [key, value] of entries) {
        if (!/^[a-zA-Z0-9_-]{1,32}$/.test(key)) {
          return { questions: null, error: `intuition: option ids must be short alphanumeric slugs (got "${key}").` };
        }
        const label = typeof value === 'string' ? value : '';
        if (!label.trim()) {
          return { questions: null, error: `intuition: option "${key}" needs a one-line description.` };
        }
        if (label.length > CEREBELLUM_INTUITION_MAX_OPTION_CHARS) {
          return { questions: null, error: `intuition: option "${key}" description exceeds ${CEREBELLUM_INTUITION_MAX_OPTION_CHARS} chars.` };
        }
        options[key] = label;
      }
      question.options = options;
    }

    if (type === 'score') {
      if (!Array.isArray(row.levels) || row.levels.length < CEREBELLUM_INTUITION_MIN_LEVELS) {
        return { questions: null, error: `intuition: questions[${index}] is type "score" and requires "levels" — ${CEREBELLUM_INTUITION_MIN_LEVELS}-${CEREBELLUM_INTUITION_MAX_LEVELS} descriptions ordered from the low end to the high end of the scale.` };
      }
      if (row.levels.length > CEREBELLUM_INTUITION_MAX_LEVELS) {
        return { questions: null, error: `intuition: questions[${index}].levels exceeds ${CEREBELLUM_INTUITION_MAX_LEVELS} (the API maximum).` };
      }
      const levels: string[] = [];
      for (const [levelIndex, level] of row.levels.entries()) {
        const text = typeof level === 'string' ? level : '';
        if (!text.trim()) {
          return { questions: null, error: `intuition: questions[${index}].levels[${levelIndex}] must be a non-empty description.` };
        }
        if (text.length > CEREBELLUM_INTUITION_MAX_LEVEL_CHARS) {
          return { questions: null, error: `intuition: questions[${index}].levels[${levelIndex}] exceeds ${CEREBELLUM_INTUITION_MAX_LEVEL_CHARS} chars.` };
        }
        levels.push(text);
      }
      question.levels = levels;
    }

    questions.push(question);
  }
  return { questions, error: null };
}

/**
 * Build the /v1/systemone request: one shared state (the judged context) and
 * all questions evaluated against it in parallel. Question shapes follow the
 * JEV primitives: noul -> criteria {true,false}; choice -> criteria keyed by
 * option id; score -> criteria as an ordered level array (low -> high).
 */
export function buildIntuitionRequest(input: {
  context: string;
  questions: CerebellumIntuitionQuestion[];
  model: string;
}): CerebellumIntuitionRequest {
  const questions: Record<string, unknown> = {};
  for (const question of input.questions) {
    if (question.type === 'noul') {
      questions[question.id] = {
        type: 'noul',
        instructions: question.instructions,
        criteria: question.criteria ?? DEFAULT_NOUL_CRITERIA,
      };
    } else if (question.type === 'choice') {
      questions[question.id] = {
        type: 'choice',
        instructions: question.instructions,
        criteria: { ...(question.options ?? {}) },
      };
    } else {
      questions[question.id] = {
        type: 'score',
        instructions: question.instructions,
        criteria: [...(question.levels ?? [])],
      };
    }
  }
  return {
    state: String(input.context ?? '').replace(/\s+/g, ' ').trim(),
    model: input.model,
    questions,
  };
}

/**
 * Extract per-question answers from a /v1/systemone payload. Unusable shapes
 * (no answers object, or an answer that is not an object) are skipped; the
 * map only carries the questions that came back usable.
 */
export function parseIntuitionAnswers(
  payload: unknown,
  questionIds: readonly string[],
): Record<string, CerebellumIntuitionAnswer> | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const answers = (payload as { answers?: unknown }).answers;
  if (!answers || typeof answers !== 'object') {
    return null;
  }
  const record = answers as Record<string, unknown>;
  const parsed: Record<string, CerebellumIntuitionAnswer> = {};
  for (const id of questionIds) {
    const answer = record[id];
    if (!answer || typeof answer !== 'object') {
      continue;
    }
    const row = answer as Record<string, unknown>;
    const mapped: CerebellumIntuitionAnswer = {};
    if (typeof row.noul === 'number' && Number.isFinite(row.noul)) {
      mapped.noul = Math.max(0, Math.min(1, row.noul));
    }
    if (typeof row.choice === 'string') {
      mapped.choice = row.choice;
    }
    if (typeof row.score === 'number' && Number.isFinite(row.score)) {
      mapped.score = row.score;
    }
    if (typeof row.confidence === 'number' && Number.isFinite(row.confidence)) {
      mapped.confidence = Math.max(0, Math.min(1, row.confidence));
    }
    if (row.probabilities && typeof row.probabilities === 'object' && !Array.isArray(row.probabilities)) {
      const probabilities: Record<string, number> = {};
      for (const [key, value] of Object.entries(row.probabilities as Record<string, unknown>)) {
        if (typeof value === 'number' && Number.isFinite(value)) {
          probabilities[key] = value;
        }
      }
      mapped.probabilities = probabilities;
    }
    if (row.legend && typeof row.legend === 'object' && !Array.isArray(row.legend)) {
      mapped.legend = row.legend as Record<string, unknown>;
    }
    parsed[id] = mapped;
  }
  return Object.keys(parsed).length > 0 ? parsed : null;
}

/**
 * Ask the cerebellum the brain's questions. Returns the parsed answers and
 * usage, or null (no verdict — blank context, HTTP/network error,
 * abort/timeout, malformed payload). Never throws.
 */
export async function askCerebellumIntuition(input: {
  config: ResolvedCerebellumConfig;
  fetchImpl: CerebellumFetchLike;
  context: string;
  questions: CerebellumIntuitionQuestion[];
  timeoutMs?: number;
}): Promise<{
  answers: Record<string, CerebellumIntuitionAnswer>;
  inputTokens: number;
} | null> {
  const { config, fetchImpl } = input;
  if (!String(input.context ?? '').trim() || input.questions.length === 0) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Math.max(1, input.timeoutMs ?? CEREBELLUM_INTUITION_TIMEOUT_MS),
  );
  try {
    const response = await fetchImpl(`${config.baseUrl}/v1/systemone`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildIntuitionRequest({
        context: input.context,
        questions: input.questions,
        model: config.model,
      })),
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as { usage?: { input_tokens?: number } };
    const answers = parseIntuitionAnswers(
      payload,
      input.questions.map((question) => question.id),
    );
    if (answers === null) {
      return null;
    }
    return { answers, inputTokens: payload.usage?.input_tokens ?? 0 };
  } catch {
    // Network errors, aborts/timeouts and JSON parse failures all land here:
    // the caller reports an honest "no verdict" to the model.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
