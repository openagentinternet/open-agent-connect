import { commandFailed, commandSuccess, type MetabotCommandResult } from '../contracts/commandResult';
import { validateLoomPayload, type LoomValidationResult } from './validation';

export interface DraftLoomTaskInput {
  wish: string;
  allowInvalid: boolean;
  executePrompt: (input: { prompt: string; systemPrompt: string }) => Promise<string>;
}

export interface DraftLoomTaskData {
  protocol: 'task';
  path: '/protocols/loom-task';
  valid: boolean;
  payload: unknown;
  validation: LoomValidationResult;
}

const SYSTEM_PROMPT = [
  'You draft MetaBot Loom task protocol payloads.',
  'Output JSON only. Do not include Markdown fences, explanations, comments, or surrounding prose.',
  'The JSON must be a single /protocols/loom-task payload object.',
  'Use requirementContentType: "text/markdown" and criteriaContentType: "text/markdown" by default.',
  'Use projectBase: "github" only when the user provided repository context or clearly implies a GitHub project; otherwise use projectBase: "chain" with an empty project object.',
  'Use conservative placeholder values only when details are missing, and make placeholders obvious enough that validation can fail until edited.',
].join('\n');

function buildDraftTaskPrompt(wish: string): string {
  return [
    'Create a /protocols/loom-task JSON payload for this wish.',
    '',
    'Required payload fields:',
    '- title',
    '- requirementContentType',
    '- requirement',
    '- criteriaContentType',
    '- criteria',
    '- projectBase',
    '- project',
    '- bounty.amount',
    '- bounty.currency',
    '',
    'Valid bounty currencies: SPACE, BTC, DOGE, OPCAT.',
    'Optional fields include deadline, tags, and attachments. Attachments must use metafile:// URIs.',
    '',
    `Wish:\n${wish}`,
  ].join('\n');
}

function tryParseJson(value: string): { ok: true; value: unknown } | { ok: false; message: string } {
  try {
    return { ok: true, value: JSON.parse(value) as unknown };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'LLM output must be valid JSON.',
    };
  }
}

function extractJson(rawOutput: string): { ok: true; value: unknown } | { ok: false; message: string } {
  const trimmed = rawOutput.trim();
  const direct = tryParseJson(trimmed);
  if (direct.ok) {
    return direct;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    return tryParseJson(fenced[1].trim());
  }

  return direct;
}

function failedWithData(
  code: string,
  message: string,
  data: Record<string, unknown>,
): MetabotCommandResult<never> {
  return {
    ...commandFailed(code, message),
    data,
  } as MetabotCommandResult<never>;
}

export async function draftLoomTask(input: DraftLoomTaskInput): Promise<MetabotCommandResult<DraftLoomTaskData>> {
  const rawOutput = await input.executePrompt({
    systemPrompt: SYSTEM_PROMPT,
    prompt: buildDraftTaskPrompt(input.wish),
  });
  const extracted = extractJson(rawOutput);
  if (!extracted.ok) {
    return failedWithData('invalid_llm_output', 'LLM output must be valid JSON for a Loom task payload.', {
      rawOutput,
      parseError: extracted.message,
    });
  }

  const payload = extracted.value;
  const validation = validateLoomPayload('task', payload);
  const data: DraftLoomTaskData = {
    protocol: 'task',
    path: '/protocols/loom-task',
    valid: validation.valid,
    payload,
    validation,
  };

  if (!validation.valid && !input.allowInvalid) {
    return failedWithData('invalid_payload', 'Drafted loom task payload failed validation.', {
      rawOutput,
      payload,
      validation,
    });
  }

  return commandSuccess(data);
}
