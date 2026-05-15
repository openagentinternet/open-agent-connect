import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChainWriteNetwork } from '../chain/writePin';
import type { LoomFileUploadNetwork, LoomWorkflowStatusValue } from './workflowTypes';

type ProcessLogRecordChain = ChainWriteNetwork | string;
type ProcessLogFileChain = LoomFileUploadNetwork;

const SUPPORTED_PROCESS_LOG_FILE_CHAINS = new Set<string>(['mvc', 'btc', 'opcat']);
const DEFAULT_MAX_LOG_BYTES = 100 * 1024;
const TRUNCATION_NOTE = '\n\n> Process log truncated to fit the Loom process log size limit.\n';

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
    /^.*\bmnemonic\b.*$/gim,
    '[REDACTED MNEMONIC]',
  );
  output = output.replace(
    /\b(?:[a-z]+ ){11,23}[a-z]+\b/gi,
    '[REDACTED MNEMONIC]',
  );
  output = output.replace(
    /(Authorization:\s*Bearer\s+)[^\s"'`]+/gi,
    '$1[REDACTED]',
  );
  output = output.replace(
    /\b(api_key=)[^&\s"'`]+/gi,
    '$1[REDACTED]',
  );
  output = output.replace(
    /\b(token=)[^&\s"'`]+/gi,
    '$1[REDACTED]',
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

function formatJson(value: unknown): string {
  return ['```json', JSON.stringify(value, null, 2), '```'].join('\n');
}

function truncateToMaxBytes(content: string, maxBytes: number): string {
  const contentBytes = Buffer.byteLength(content, 'utf8');
  if (contentBytes <= maxBytes) {
    return content;
  }

  const noteBytes = Buffer.byteLength(TRUNCATION_NOTE, 'utf8');
  const keepBytes = Math.max(0, maxBytes - noteBytes);
  return `${Buffer.from(content, 'utf8').subarray(0, keepBytes).toString('utf8')}${TRUNCATION_NOTE}`;
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
    return `- ${check.status}: ${check.command}${summary}`;
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
  const path = join(input.directory, input.fileName);
  await mkdir(input.directory, { recursive: true });

  let content = renderLoomProcessLog(input);
  if (!content.endsWith('\n')) {
    content = `${content}\n`;
  }

  await writeFile(path, content, 'utf8');
  return { path, content };
}
