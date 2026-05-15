import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { ChainWriteNetwork } from '../chain/writePin';
import type { LoomFileUploadNetwork, LoomWorkflowStatusValue } from './workflowTypes';

type ProcessLogRecordChain = ChainWriteNetwork | string;
type ProcessLogFileChain = LoomFileUploadNetwork;

const SUPPORTED_PROCESS_LOG_FILE_CHAINS = new Set<string>(['mvc', 'btc', 'opcat']);
const DEFAULT_MAX_LOG_BYTES = 100 * 1024;
const TRUNCATION_NOTE = '\n\n> Process log truncated to fit the Loom process log size limit.\n';
const SECRET_KEY_RE = String.raw`(?:[A-Z0-9_]+_API_KEY|[A-Z0-9_]+_TOKEN|api_key|api-key|access_token|access-token|token|API_KEY|TOKEN)`;

export interface LoomProcessLogCheck {
  command: string;
  status: 'passed' | 'failed' | 'skipped' | string;
  summary?: string;
}

export interface LoomProcessLogCommit {
  sha: string;
  message: string;
}

export interface LoomProcessLogInput {
  directory?: string;
  fileName?: string;
  taskPinId?: string;
  claimPinId?: string;
  actor?: {
    slug?: string;
    globalMetaId?: string;
  };
  repo?: {
    uri?: string;
    branch?: string;
    workspacePath?: string;
  };
  roundNote?: string;
  llm?: {
    model?: string;
    sessionId?: string | null;
  };
  checks?: LoomProcessLogCheck[];
  git?: {
    changes?: string[];
    commits?: LoomProcessLogCommit[];
  };
  statusDecision?: {
    status?: LoomWorkflowStatusValue | string;
    summary?: string;
  };
  payloadPreview?: unknown;
  chainResult?: unknown;
  errors?: unknown[];
  rawLog?: string;
  maxBytes?: number;
}

export interface LoomProcessLogWriteResult {
  path: string;
  content: string;
}

function isSupportedProcessLogFileChain(value: string): value is ProcessLogFileChain {
  return SUPPORTED_PROCESS_LOG_FILE_CHAINS.has(value);
}

export function selectProcessLogFileChain(
  recordChain: ProcessLogRecordChain,
  fileChain?: string,
): ProcessLogFileChain {
  if (fileChain !== undefined) {
    if (isSupportedProcessLogFileChain(fileChain)) {
      return fileChain;
    }
    throw new Error(`Unsupported Loom process log file chain: ${fileChain}`);
  }

  if (isSupportedProcessLogFileChain(recordChain)) {
    return recordChain;
  }

  if (recordChain === 'doge') {
    return 'mvc';
  }

  throw new Error(`Unsupported Loom record chain for process logs: ${recordChain}`);
}

export function redactLoomProcessLog(input: unknown): string {
  let output = String(input ?? '');

  output = output.replace(
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    '[REDACTED PRIVATE KEY]',
  );
  output = output.replace(
    /\b((?:mnemonic|seed phrase|seed words|seed_words|recovery phrase|secret phrase|seed)\s*(?::|=)\s*)(?:"[^"]*"|'[^']*'|[^\n\r]+)/gi,
    '$1[REDACTED MNEMONIC]',
  );
  output = output.replace(
    /(Authorization:\s*(?:Bearer|token)\s+)[^\s"'`]+/gi,
    '$1[REDACTED]',
  );
  output = output.replace(
    /(["']?Authorization["']?\s*:\s*["']?(?:Bearer|token)\s+)[^"',}\s]+/gi,
    '$1[REDACTED]',
  );
  output = output.replace(
    /(^|\s)(--(?:token|api-key|api_key|access-token|access_token))(?:=|\s+)(?:"[^"]*"|'[^']*'|[^\s"'`]+)/gi,
    '$1$2 [REDACTED]',
  );
  output = output.replace(
    new RegExp(`\\b(${SECRET_KEY_RE}=)(?:"[^"]*"|'[^']*'|[^&\\s"'\\x60,}]+)`, 'gi'),
    '$1[REDACTED]',
  );
  output = output.replace(
    new RegExp(`\\b(${SECRET_KEY_RE}:\\s*)(?:"[^"]*"|'[^']*'|[^&\\s"'\\x60,}]+)`, 'gi'),
    '$1[REDACTED]',
  );
  output = output.replace(
    new RegExp(`(["']?${SECRET_KEY_RE}["']?\\s*:\\s*)(["']?)([^"',}\\s]+)\\2`, 'g'),
    '$1$2[REDACTED]$2',
  );

  return output;
}

function pushSection(lines: string[], title: string, values: string[]): void {
  const present = values.filter((value) => value.trim().length > 0);
  if (present.length === 0) {
    return;
  }
  lines.push('', `## ${title}`, ...present);
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const json = JSON.stringify(value, (_key, nestedValue) => {
    if (typeof nestedValue === 'bigint') {
      return nestedValue.toString();
    }
    if (typeof nestedValue === 'object' && nestedValue !== null) {
      if (seen.has(nestedValue)) {
        return '[Circular]';
      }
      seen.add(nestedValue);
    }
    return nestedValue;
  }, 2);

  return json ?? String(value);
}

function formatJson(value: unknown): string {
  return ['```json', safeStringify(value), '```'].join('\n');
}

function byteSafePrefix(input: string, maxBytes: number): string {
  let output = '';
  for (const character of input) {
    const next = `${output}${character}`;
    if (Buffer.byteLength(next, 'utf8') > maxBytes) {
      break;
    }
    output = next;
  }
  return output;
}

function truncateToMaxBytes(content: string, maxBytes: number): string {
  if (maxBytes <= 0) {
    return '';
  }

  const contentBytes = Buffer.byteLength(content, 'utf8');
  if (contentBytes <= maxBytes) {
    return content;
  }

  const noteBytes = Buffer.byteLength(TRUNCATION_NOTE, 'utf8');
  if (noteBytes > maxBytes) {
    return byteSafePrefix('[truncated]', maxBytes);
  }

  const keepBytes = maxBytes - noteBytes;
  return `${byteSafePrefix(content, keepBytes)}${TRUNCATION_NOTE}`;
}

function assertSafeProcessLogFileName(fileName: string): void {
  if (
    fileName.length === 0
    || isAbsolute(fileName)
    || fileName.includes('/')
    || fileName.includes('\\')
    || fileName === '..'
  ) {
    throw new Error(`Unsafe Loom process log file name: ${fileName}`);
  }
}

export function renderLoomProcessLog(input: LoomProcessLogInput): string {
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_LOG_BYTES;
  const lines: string[] = ['# Loom Process Log'];

  pushSection(lines, 'Task And Claim', [
    input.taskPinId ? `- Task: ${input.taskPinId}` : '',
    input.claimPinId ? `- Claim: ${input.claimPinId}` : '',
  ]);

  pushSection(lines, 'Actor', [
    input.actor?.slug ? `- Slug: ${input.actor.slug}` : '',
    input.actor?.globalMetaId ? `- Global MetaID: ${input.actor.globalMetaId}` : '',
  ]);

  pushSection(lines, 'Repo And Branch', [
    input.repo?.uri ? `- Repo: ${input.repo.uri}` : '',
    input.repo?.branch ? `- Branch: ${input.repo.branch}` : '',
    input.repo?.workspacePath ? `- Workspace: ${input.repo.workspacePath}` : '',
  ]);

  pushSection(lines, 'Round Note', [
    input.roundNote ? redactLoomProcessLog(input.roundNote) : '',
  ]);

  pushSection(lines, 'LLM', [
    input.llm?.model ? `- Model: ${input.llm.model}` : '',
    input.llm?.sessionId ? `- Session: ${input.llm.sessionId}` : '',
  ]);

  pushSection(lines, 'Checks', (input.checks ?? []).map((check) => {
    const summary = check.summary ? ` - ${redactLoomProcessLog(check.summary)}` : '';
    return `- ${check.status}: ${redactLoomProcessLog(check.command)}${summary}`;
  }));

  pushSection(lines, 'Git Changes', (input.git?.changes ?? []).map((change) => `- ${change}`));
  pushSection(lines, 'Commits', (input.git?.commits ?? []).map(
    (commit) => `- ${commit.sha} ${redactLoomProcessLog(commit.message)}`,
  ));

  pushSection(lines, 'Status Decision', [
    input.statusDecision?.status ? `- Status: ${input.statusDecision.status}` : '',
    input.statusDecision?.summary
      ? `- Summary: ${redactLoomProcessLog(input.statusDecision.summary)}`
      : '',
  ]);

  pushSection(lines, 'Payload Preview', [
    input.payloadPreview === undefined ? '' : redactLoomProcessLog(formatJson(input.payloadPreview)),
  ]);

  pushSection(lines, 'Chain Result', [
    input.chainResult === undefined ? '' : redactLoomProcessLog(formatJson(input.chainResult)),
  ]);

  pushSection(lines, 'Errors', (input.errors ?? []).map(
    (error) => `- ${redactLoomProcessLog(error instanceof Error ? error.message : String(error))}`,
  ));

  pushSection(lines, 'Raw Log', [
    input.rawLog === undefined ? '' : redactLoomProcessLog(input.rawLog),
  ]);

  return truncateToMaxBytes(lines.join('\n'), maxBytes);
}

export async function writeLoomProcessLogFile(
  input: LoomProcessLogInput & { directory: string; fileName: string },
): Promise<LoomProcessLogWriteResult> {
  assertSafeProcessLogFileName(input.fileName);
  const path = join(input.directory, input.fileName);
  await mkdir(input.directory, { recursive: true });

  let content = renderLoomProcessLog(input);
  if (!content.endsWith('\n')) {
    const withNewline = `${content}\n`;
    if (
      input.maxBytes === undefined
      || (input.maxBytes > 0 && Buffer.byteLength(withNewline, 'utf8') <= input.maxBytes)
    ) {
      content = withNewline;
    }
  }

  await writeFile(path, content, 'utf8');
  return { path, content };
}
