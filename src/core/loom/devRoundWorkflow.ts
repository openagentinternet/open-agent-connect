import {
  commandFailed,
  commandSuccess,
  type MetabotCommandResult,
} from '../contracts/commandResult';
import type { LoomCommandRunner, LoomCommandRunResult } from './commandRunner';
import { writeLoomProtocolRecord, type LoomProtocolRecordWriteResult } from './workflowChain';
import {
  selectProcessLogFileChain,
  type LoomProcessLogCheck,
  type LoomProcessLogInput,
  type LoomProcessLogWriteResult,
} from './workflowLog';
import type { LoomWorkflowTaskState } from './workflowState';
import type { LoomWorkflowStore } from './workflowStore';
import type {
  LoomWorkflowCommitRecord,
  LoomWorkflowState,
  LoomWorkflowStatusRecord,
  LoomWorkflowStatusValue,
} from './workflowTypes';

export interface LoomDevRoundLlmResult {
  sessionId?: string | null;
  status: string;
  output?: string;
  error?: string;
}

export interface LoomDevRoundWorkflowInput {
  from?: string;
  taskPinId: string;
  claimPinId: string;
  chain?: string;
  fileChain?: string;
  checks: string[];
  roundNote?: string;
  developerMetaBotSlug: string;
  developerGlobalMetaId: string;
  state: LoomWorkflowTaskState;
  workflowStore: LoomWorkflowStore;
  runner: LoomCommandRunner;
  executeLlmRound: (prompt: string, cwd: string) => Promise<LoomDevRoundLlmResult>;
  writeChain: (request: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  uploadFile: (input: { filePath: string; network: string; contentType?: string }) => Promise<{ metafileUri?: string; uri?: string; pinId?: string; network?: string }>;
  writeLogFile: (input: LoomProcessLogInput & { directory: string; fileName: string }) => Promise<LoomProcessLogWriteResult>;
  now?: () => number;
  commitMessage?: string;
}

export interface LoomDevRoundPromptInput {
  task: Record<string, unknown>;
  workflow: LoomWorkflowState;
  checks: string[];
  roundNote?: string;
}

export interface LoomDevRoundWorkflowResult {
  taskPinId: string;
  claimPinId: string;
  status: LoomWorkflowStatusValue;
  branchName: string;
  workspacePath: string;
  processLogPath: string;
  processLogUri: string;
  statusPinId: string;
  commits: LoomWorkflowCommitRecord[];
  checksPassed: boolean | null;
  llmSessionId?: string | null;
}

interface CheckRun {
  command: string;
  result: LoomCommandRunResult;
}

interface GitSnapshot {
  statusPorcelain: string;
  changedFiles: string[];
}

const DEFAULT_CHAIN = 'mvc';
const DEFAULT_COMMIT_MESSAGE = 'feat: add loom dev round workflow';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function taskPayload(state: LoomWorkflowTaskState): Record<string, unknown> {
  if (!state.found || !isRecord(state.task.payload)) {
    return {};
  }
  return state.task.payload;
}

function taskTitle(payload: Record<string, unknown>): string {
  return stringField(payload, 'title') ?? 'Untitled Loom task';
}

function latestStatusSummary(workflow: LoomWorkflowState): string {
  const latest = workflow.statuses.at(-1);
  if (!latest) {
    return 'No previous local status records.';
  }
  const pieces = [
    `round=${latest.roundId}`,
    `status=${latest.status}`,
    latest.pinId ? `pin=${latest.pinId}` : '',
    latest.commits.length > 0 ? `commits=${latest.commits.map((commit) => commit.sha).join(', ')}` : 'commits=none',
    latest.checksPassed === undefined ? '' : `checksPassed=${String(latest.checksPassed)}`,
  ].filter(Boolean);
  return pieces.join('; ');
}

function listBlock(values: string[], emptyText: string): string {
  if (values.length === 0) {
    return `- ${emptyText}`;
  }
  return values.map((value) => `- ${value}`).join('\n');
}

export function buildLoomDevRoundPrompt(input: LoomDevRoundPromptInput): string {
  const title = taskTitle(input.task);
  const requirement = stringField(input.task, 'requirement') ?? 'No requirement content was provided.';
  const criteria = stringField(input.task, 'criteria') ?? 'No acceptance criteria were provided.';
  return [
    'You are executing a Loom development round.',
    '',
    `Task title: ${title}`,
    '',
    'Requirement:',
    requirement,
    '',
    'Acceptance criteria:',
    criteria,
    '',
    `Repository path: ${input.workflow.workspacePath}`,
    `Current branch: ${input.workflow.branchName}`,
    `Previous status summary: ${latestStatusSummary(input.workflow)}`,
    '',
    'Verification commands that will run after your changes:',
    listBlock(input.checks, 'No verification checks were configured for this round.'),
    '',
    'Round note:',
    input.roundNote?.trim() ? input.roundNote.trim() : 'No round note was provided.',
    '',
    'This development round is already authorized by the task owner and claimant.',
    'Do not wait for approval, confirmation, or follow-up input before implementing.',
    'Do not stop after presenting a design; use any design thinking internally, then edit the repository files.',
    'If requirements are clear enough to implement, proceed directly to code changes and local verification.',
    '',
    'Make one focused implementation round. Avoid unrelated refactors, metadata churn, and broad rewrites.',
    'Keep changes scoped to the task requirements and leave the repo committable.',
    'Do not run git commit.',
    'Do not run git push.',
    'Do not run gh pr.',
    'Do not create a pull request.',
    'Do not publish Loom protocol records or run metabot loom commands.',
    'Leave changed files in the working tree; the Loom workflow will run checks, create commits, publish status, and handle delivery.',
  ].join('\n');
}

function findClaimAuthor(state: LoomWorkflowTaskState, claimPinId: string): string | undefined {
  if (!state.found) {
    return undefined;
  }
  return state.valid.claims.find((claim) => claim.pinId === claimPinId)?.globalMetaId;
}

function workflowMatchesClaim(workflow: LoomWorkflowState, input: LoomDevRoundWorkflowInput): boolean {
  return workflow.taskPinId === input.taskPinId && workflow.claimPinId === input.claimPinId;
}

function commandDetail(result: LoomCommandRunResult): string {
  return result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`;
}

function commandOutputSummary(output: string): string {
  return output.trim();
}

function parseStatusPorcelainFiles(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .flatMap((line) => {
      const renamed = line.match(/^R. (.+) -> (.+)$/);
      if (renamed) {
        return [renamed[2]];
      }
      return [line.slice(3).trim()].filter(Boolean);
    });
}

async function readGitSnapshot(
  runner: LoomCommandRunner,
  cwd: string,
): Promise<MetabotCommandResult<GitSnapshot>> {
  const status = await runner.run({
    command: 'git',
    args: ['status', '--porcelain'],
    cwd,
  });
  if (status.exitCode !== 0) {
    return commandFailed('git_status_failed', `Failed to read git status: ${commandDetail(status)}`);
  }

  const diff = await runner.run({
    command: 'git',
    args: ['diff', '--name-only'],
    cwd,
  });
  if (diff.exitCode !== 0) {
    return commandFailed('git_diff_failed', `Failed to read git diff: ${commandDetail(diff)}`);
  }

  return commandSuccess({
    statusPorcelain: status.stdout,
    changedFiles: Array.from(new Set([
      ...parseStatusPorcelainFiles(status.stdout),
      ...diff.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    ])),
  });
}

async function runChecks(
  runner: LoomCommandRunner,
  cwd: string,
  checks: string[],
): Promise<CheckRun[]> {
  const results: CheckRun[] = [];
  for (const check of checks) {
    const result = await runner.run({
      command: check,
      args: [],
      cwd,
      shell: true,
    });
    results.push({ command: check, result });
  }
  return results;
}

function processLogChecks(checks: string[], runs: CheckRun[]): LoomProcessLogCheck[] {
  if (checks.length === 0) {
    return [{
      command: '(none)',
      status: 'skipped',
      summary: 'No verification checks were configured for this round.',
    }];
  }
  return runs.map((run) => ({
    command: run.command,
    status: run.result.exitCode === 0 ? 'passed' : 'failed',
    exitCode: run.result.exitCode,
    durationMs: run.result.durationMs,
    stdoutSummary: commandOutputSummary(run.result.stdout),
    stderrSummary: commandOutputSummary(run.result.stderr),
    summary: commandDetail(run.result),
  }));
}

async function createCommit(input: {
  runner: LoomCommandRunner;
  cwd: string;
  message: string;
}): Promise<MetabotCommandResult<LoomWorkflowCommitRecord>> {
  const add = await input.runner.run({
    command: 'git',
    args: ['add', '-A'],
    cwd: input.cwd,
  });
  if (add.exitCode !== 0) {
    return commandFailed('git_add_failed', `Failed to stage git changes: ${commandDetail(add)}`);
  }

  const commit = await input.runner.run({
    command: 'git',
    args: ['commit', '-m', input.message],
    cwd: input.cwd,
  });
  if (commit.exitCode !== 0) {
    return commandFailed('git_commit_failed', `Failed to commit git changes: ${commandDetail(commit)}`);
  }

  const revParse = await input.runner.run({
    command: 'git',
    args: ['rev-parse', 'HEAD'],
    cwd: input.cwd,
  });
  if (revParse.exitCode !== 0) {
    return commandFailed('git_rev_parse_failed', `Failed to read committed revision: ${commandDetail(revParse)}`);
  }

  const show = await input.runner.run({
    command: 'git',
    args: ['show', '--name-only', '--format=%s', 'HEAD'],
    cwd: input.cwd,
  });
  if (show.exitCode !== 0) {
    return commandFailed('git_show_failed', `Failed to read commit summary: ${commandDetail(show)}`);
  }

  const lines = show.stdout.split(/\r?\n/);
  const message = lines[0]?.trim() ?? input.message;
  const files = lines.slice(1).map((line) => line.trim()).filter(Boolean);
  return commandSuccess({
    sha: revParse.stdout.trim(),
    message,
    files,
  });
}

async function readHeadRevision(
  runner: LoomCommandRunner,
  cwd: string,
): Promise<MetabotCommandResult<string>> {
  const revParse = await runner.run({
    command: 'git',
    args: ['rev-parse', 'HEAD'],
    cwd,
  });
  if (revParse.exitCode !== 0) {
    return commandFailed('git_rev_parse_failed', `Failed to read current revision: ${commandDetail(revParse)}`);
  }
  return commandSuccess(revParse.stdout.trim());
}

async function readCommitRecord(input: {
  runner: LoomCommandRunner;
  cwd: string;
  sha: string;
}): Promise<MetabotCommandResult<LoomWorkflowCommitRecord>> {
  const show = await input.runner.run({
    command: 'git',
    args: ['show', '--name-only', '--format=%s', input.sha],
    cwd: input.cwd,
  });
  if (show.exitCode !== 0) {
    return commandFailed('git_show_failed', `Failed to read commit summary: ${commandDetail(show)}`);
  }

  const lines = show.stdout.split(/\r?\n/);
  return commandSuccess({
    sha: input.sha,
    message: lines[0]?.trim() || input.sha,
    files: lines.slice(1).map((line) => line.trim()).filter(Boolean),
  });
}

async function readCommitsSince(input: {
  runner: LoomCommandRunner;
  cwd: string;
  baseHead: string;
}): Promise<MetabotCommandResult<LoomWorkflowCommitRecord[]>> {
  const revList = await input.runner.run({
    command: 'git',
    args: ['rev-list', '--reverse', `${input.baseHead}..HEAD`],
    cwd: input.cwd,
  });
  if (revList.exitCode !== 0) {
    return commandFailed('git_rev_list_failed', `Failed to read development round commits: ${commandDetail(revList)}`);
  }

  const commits: LoomWorkflowCommitRecord[] = [];
  for (const sha of revList.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
    const commit = await readCommitRecord({
      runner: input.runner,
      cwd: input.cwd,
      sha,
    });
    if (!commit.ok) {
      return commit;
    }
    commits.push(commit.data);
  }
  return commandSuccess(commits);
}

function decideStatus(input: {
  llm: LoomDevRoundLlmResult;
  checks: string[];
  checkRuns: CheckRun[];
  commits: LoomWorkflowCommitRecord[];
}): { status: LoomWorkflowStatusValue; checksPassed: boolean | null; summary: string } {
  const acceptedTimeoutWork = input.llm.status === 'timeout' && input.commits.length > 0;
  if (input.llm.status !== 'completed' && !acceptedTimeoutWork) {
    return {
      status: 'failed',
      checksPassed: null,
      summary: `LLM round failed${input.llm.error ? `: ${input.llm.error}` : '.'}`,
    };
  }

  if (input.checks.length === 0) {
    return {
      status: 'in_progress',
      checksPassed: null,
      summary: input.commits.length > 0
        ? 'Verification was skipped because no checks were configured.'
        : 'No file changes were detected; no commit was created. Verification was skipped because no checks were configured.',
    };
  }

  const checksPassed = input.checkRuns.every((run) => run.result.exitCode === 0);
  if (checksPassed && input.commits.length > 0) {
    return {
      status: 'completed',
      checksPassed: true,
      summary: acceptedTimeoutWork
        ? `LLM runtime timed out after producing ${input.commits.length} commit(s), but all checks passing.`
        : `Completed a development round with ${input.commits.length} commit(s) and all checks passing.`,
    };
  }

  if (!checksPassed) {
    return {
      status: 'in_progress',
      checksPassed: false,
      summary: acceptedTimeoutWork
        ? 'LLM runtime timed out after producing commits, and one or more checks failed.'
        : input.commits.length > 0
        ? 'A development round was committed, but one or more checks failed.'
        : 'One or more checks failed and no file changes were detected; no commit was created.',
    };
  }

  return {
    status: 'in_progress',
    checksPassed: true,
    summary: 'No file changes were detected; no commit was created.',
  };
}

function createStatusPayload(input: {
  taskPinId: string;
  claimPinId: string;
  status: LoomWorkflowStatusValue;
  progressSummary: string;
  branchName: string;
  workspacePath: string;
  repoUri: string;
  commits: LoomWorkflowCommitRecord[];
  processLogUri: string;
}): Record<string, unknown> {
  return {
    taskPinId: input.taskPinId,
    claimPinId: input.claimPinId,
    status: input.status,
    progressSummary: input.progressSummary,
    branchName: input.branchName,
    workspacePath: input.workspacePath,
    project: {
      base: 'github',
      repoUri: input.repoUri,
    },
    commits: input.commits,
    processLogs: [input.processLogUri],
  };
}

function processLogFileName(now: number, claimPinId: string): string {
  return `dev-round-${claimPinId.slice(0, 12)}-${now}.md`;
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { value: String(error) };
}

function devRoundStatusMarkerFailed(input: {
  workflowInput: LoomDevRoundWorkflowInput;
  workflow: LoomWorkflowState;
  statusWrite: LoomProtocolRecordWriteResult;
  processLogPath: string;
  processLogUri: string;
  cause: unknown;
}): MetabotCommandResult<never> {
  const paths = input.workflowInput.workflowStore.resolve(
    input.workflowInput.taskPinId,
    input.workflowInput.claimPinId,
  );
  return commandFailed(
    'dev_round_status_marker_failed',
    `Loom status ${input.statusWrite.pinId} was written, but local dev-round marker state could not be saved. Sync and inspect local workflow state before retrying.`,
    {
      data: {
        taskPinId: input.workflowInput.taskPinId,
        claimPinId: input.workflowInput.claimPinId,
        statusPinId: input.statusWrite.pinId,
        processLogUri: input.processLogUri,
        processLogPath: input.processLogPath,
        workflowPath: paths.workflowPath,
        workspacePath: input.workflow.workspacePath,
        syncCommand: 'metabot loom sync',
        retryAfterSyncCommand: 'After sync, inspect local workflow state before deciding whether another development round is needed.',
        cause: serializeError(input.cause),
      },
    },
  );
}

async function writeAndUploadLog(input: {
  workflowInput: LoomDevRoundWorkflowInput;
  workflow: LoomWorkflowState;
  taskPayload: Record<string, unknown>;
  llm: LoomDevRoundLlmResult;
  checks: LoomProcessLogCheck[];
  git: GitSnapshot;
  commits: LoomWorkflowCommitRecord[];
  decision: { status: LoomWorkflowStatusValue; summary: string };
  statusPayloadPreview: Record<string, unknown>;
  errors: unknown[];
  now: number;
}): Promise<MetabotCommandResult<{ path: string; uri: string }>> {
  const workflowPaths = input.workflowInput.workflowStore.resolve(
    input.workflowInput.taskPinId,
    input.workflowInput.claimPinId,
  );
  let logFile: LoomProcessLogWriteResult;
  try {
    logFile = await input.workflowInput.writeLogFile({
      directory: workflowPaths.taskLogsRoot,
      fileName: processLogFileName(input.now, input.workflowInput.claimPinId),
      taskPinId: input.workflowInput.taskPinId,
      claimPinId: input.workflowInput.claimPinId,
      actor: {
        slug: input.workflowInput.developerMetaBotSlug,
        globalMetaId: input.workflowInput.developerGlobalMetaId,
      },
      repo: {
        uri: input.workflow.repoUri,
        branch: input.workflow.branchName,
        workspacePath: input.workflow.workspacePath,
      },
      roundNote: input.workflowInput.roundNote,
      llm: {
        sessionId: input.llm.sessionId ?? null,
      },
      checks: input.checks,
      git: {
        changes: input.git.changedFiles,
        commits: input.commits,
      },
      statusDecision: input.decision,
      payloadPreview: input.statusPayloadPreview,
      errors: input.errors,
      rawLog: [
        `Task title: ${taskTitle(input.taskPayload)}`,
        `LLM status: ${input.llm.status}`,
        input.llm.output ? `LLM output:\n${input.llm.output}` : '',
        input.llm.error ? `LLM error:\n${input.llm.error}` : '',
        `Git status porcelain:\n${input.git.statusPorcelain || '(clean)'}`,
        input.commits.length === 0 ? 'No file changes were detected; no commit was created.' : '',
      ].filter(Boolean).join('\n\n'),
    });
  } catch (error) {
    return commandFailed('process_log_write_failed', `Failed to write Loom process log: ${error instanceof Error ? error.message : String(error)}`, {
      data: { cause: serializeError(error) },
    });
  }

  let uploaded: { metafileUri?: string; uri?: string };
  try {
    uploaded = await input.workflowInput.uploadFile({
      filePath: logFile.path,
      contentType: 'text/markdown',
      network: selectProcessLogFileChain(input.workflowInput.chain ?? DEFAULT_CHAIN, input.workflowInput.fileChain),
    });
  } catch (error) {
    return commandFailed('process_log_upload_failed', `Failed to upload Loom process log: ${error instanceof Error ? error.message : String(error)}`, {
      data: { processLogPath: logFile.path, cause: serializeError(error) },
    });
  }

  const uri = uploaded.metafileUri ?? uploaded.uri;
  if (!uri) {
    return commandFailed('process_log_upload_failed', 'Failed to upload Loom process log: uploader returned no metafile URI.', {
      data: { processLogPath: logFile.path },
    });
  }

  return commandSuccess({ path: logFile.path, uri });
}

async function writeStatus(input: {
  workflowInput: LoomDevRoundWorkflowInput;
  payload: Record<string, unknown>;
}): Promise<MetabotCommandResult<LoomProtocolRecordWriteResult>> {
  return writeLoomProtocolRecord({
    protocol: 'status',
    payload: input.payload,
    from: input.workflowInput.from,
    chain: input.workflowInput.chain ?? DEFAULT_CHAIN,
    writeChain: input.workflowInput.writeChain,
  });
}

export async function runLoomDevRoundWorkflow(
  input: LoomDevRoundWorkflowInput,
): Promise<MetabotCommandResult<LoomDevRoundWorkflowResult>> {
  const now = input.now?.() ?? Date.now();
  if (!input.state.found) {
    return commandFailed('task_not_found', input.state.message);
  }

  const claimAuthor = findClaimAuthor(input.state, input.claimPinId);
  if (claimAuthor && claimAuthor !== input.developerGlobalMetaId) {
    return commandFailed('permission_denied', `Loom claim ${input.claimPinId} belongs to another developer.`);
  }

  const workflow = await input.workflowStore.read(input.taskPinId, input.claimPinId);
  if (!workflow) {
    return commandFailed('claim_not_found', `Local Loom workflow state was not found for claim ${input.claimPinId}.`);
  }
  if (!workflowMatchesClaim(workflow, input)) {
    return commandFailed('invalid_loom_state', `Local Loom workflow state does not match task ${input.taskPinId} and claim ${input.claimPinId}.`);
  }
  if (workflow.developerGlobalMetaId && workflow.developerGlobalMetaId !== input.developerGlobalMetaId) {
    return commandFailed('permission_denied', `Loom claim ${input.claimPinId} belongs to another developer.`);
  }

  const payload = taskPayload(input.state);
  const prompt = buildLoomDevRoundPrompt({
    task: payload,
    workflow,
    checks: input.checks,
    roundNote: input.roundNote,
  });

  const baseHead = await readHeadRevision(input.runner, workflow.workspacePath);
  if (!baseHead.ok) {
    return baseHead;
  }

  const llm = await input.executeLlmRound(prompt, workflow.workspacePath);
  const errors: unknown[] = [];
  let git: GitSnapshot = { statusPorcelain: '', changedFiles: [] };
  let checkRuns: CheckRun[] = [];
  let commits: LoomWorkflowCommitRecord[] = [];

  if (llm.status === 'completed' || llm.status === 'timeout') {
    checkRuns = await runChecks(input.runner, workflow.workspacePath, input.checks);
    const snapshot = await readGitSnapshot(input.runner, workflow.workspacePath);
    if (!snapshot.ok) {
      return snapshot;
    }
    git = snapshot.data;

    if (git.changedFiles.length > 0) {
      const commit = await createCommit({
        runner: input.runner,
        cwd: workflow.workspacePath,
        message: input.commitMessage ?? DEFAULT_COMMIT_MESSAGE,
      });
      if (!commit.ok) {
        return commit;
      }
      commits = [commit.data];
    }

    const commitsSinceBase = await readCommitsSince({
      runner: input.runner,
      cwd: workflow.workspacePath,
      baseHead: baseHead.data,
    });
    if (!commitsSinceBase.ok) {
      return commitsSinceBase;
    }
    if (commitsSinceBase.data.length > 0) {
      commits = commitsSinceBase.data;
    }
  } else {
    errors.push(llm.error ?? `LLM runtime ended with status ${llm.status}.`);
  }
  if (llm.status === 'timeout') {
    errors.push(llm.error ?? 'LLM runtime timed out.');
  }

  const decision = decideStatus({
    llm,
    checks: input.checks,
    checkRuns,
    commits,
  });
  const payloadPreview = createStatusPayload({
    taskPinId: input.taskPinId,
    claimPinId: input.claimPinId,
    status: decision.status,
    progressSummary: decision.summary,
    branchName: workflow.branchName,
    workspacePath: workflow.workspacePath,
    repoUri: workflow.repoUri,
    commits,
    processLogUri: '(pending process log upload)',
  });
  const logUpload = await writeAndUploadLog({
    workflowInput: input,
    workflow,
    taskPayload: payload,
    llm,
    checks: processLogChecks(input.checks, checkRuns),
    git,
    commits,
    decision,
    statusPayloadPreview: payloadPreview,
    errors,
    now,
  });
  if (!logUpload.ok) {
    return logUpload;
  }

  const statusPayload = createStatusPayload({
    taskPinId: input.taskPinId,
    claimPinId: input.claimPinId,
    status: decision.status,
    progressSummary: decision.summary,
    branchName: workflow.branchName,
    workspacePath: workflow.workspacePath,
    repoUri: workflow.repoUri,
    commits,
    processLogUri: logUpload.data.uri,
  });
  const statusWrite = await writeStatus({ workflowInput: input, payload: statusPayload });
  if (!statusWrite.ok) {
    return statusWrite;
  }

  const statusRecord: LoomWorkflowStatusRecord = {
    roundId: `dev-round-${now}`,
    status: decision.status,
    pinId: statusWrite.data.pinId,
    processLogPath: logUpload.data.path,
    processLogUri: logUpload.data.uri,
    llmSessionId: llm.sessionId ?? null,
    commits,
    checksPassed: decision.checksPassed,
  };
  let updatedWorkflow: LoomWorkflowState;
  try {
    updatedWorkflow = await input.workflowStore.write({
      ...workflow,
      statuses: [...workflow.statuses, statusRecord],
      updatedAt: new Date(now).toISOString(),
    });
  } catch (error) {
    return devRoundStatusMarkerFailed({
      workflowInput: input,
      workflow,
      statusWrite: statusWrite.data,
      processLogPath: logUpload.data.path,
      processLogUri: logUpload.data.uri,
      cause: error,
    });
  }
  const writtenStatus = updatedWorkflow.statuses.at(-1) ?? statusRecord;

  return commandSuccess({
    taskPinId: input.taskPinId,
    claimPinId: input.claimPinId,
    status: writtenStatus.status,
    branchName: workflow.branchName,
    workspacePath: workflow.workspacePath,
    processLogPath: logUpload.data.path,
    processLogUri: logUpload.data.uri,
    statusPinId: statusWrite.data.pinId,
    commits,
    checksPassed: decision.checksPassed,
    llmSessionId: llm.sessionId ?? null,
  });
}
