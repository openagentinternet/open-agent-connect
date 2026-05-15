import {
  commandFailed,
  commandSuccess,
  type MetabotCommandResult,
} from '../contracts/commandResult';
import type { LoomCommandRunner } from './commandRunner';
import {
  buildLoomBranchName,
  normalizeGitHubRepoUri,
  type GitHubToolCheckResult,
  type PrepareGitHubForkWorkspaceInput,
  type PrepareGitHubForkWorkspaceResult,
} from './githubWorkflow';
import type { LoomCachedRecord } from './rawCache';
import type { LoomProtocolName } from './protocols';
import { validateLoomPayload } from './validation';
import { writeLoomProtocolRecord, type LoomProtocolRecordWriteResult } from './workflowChain';
import {
  renderLoomProcessLog,
  selectProcessLogFileChain,
  type LoomProcessLogInput,
  type LoomProcessLogWriteResult,
} from './workflowLog';
import type { LoomWorkflowState, LoomWorkflowStatusRecord } from './workflowTypes';
import type { LoomWorkflowStore } from './workflowStore';
import type { LoomWorkflowTaskState } from './workflowState';

export interface LoomClaimAndStartWorkflowDryRunResult {
  dryRun: true;
  claimPayload: Record<string, unknown>;
  statusPayload: Record<string, unknown>;
  preview: {
    claimPinId: string;
    branchName: string;
    stagingRepoPath: string;
    workspaceRepoPath: string;
    processLogFileChain: string;
  };
}

export interface LoomClaimAndStartWorkflowResult {
  dryRun: false;
  taskPinId: string;
  claimPinId: string;
  statusPinId: string;
  branchName: string;
  workspacePath: string;
  processLogPath: string;
  processLogUri: string;
  workflowPath: string;
}

export interface LoomClaimAndStartWorkflowInput {
  from?: string;
  taskPinId: string;
  payoutAddress?: string;
  claimPinId?: string;
  chain?: string;
  fileChain?: string;
  message?: string;
  dryRun?: boolean;
  resetWorkspace?: boolean;
  developerMetaBotSlug: string;
  developerGlobalMetaId: string;
  state?: LoomWorkflowTaskState;
  stateProvider?: (taskPinId: string) => Promise<LoomWorkflowTaskState> | LoomWorkflowTaskState;
  workflowStore: LoomWorkflowStore;
  runner: LoomCommandRunner;
  github: {
    assertToolsReady(input: { runner: LoomCommandRunner }): Promise<MetabotCommandResult<GitHubToolCheckResult>>;
    prepareForkWorkspace(input: PrepareGitHubForkWorkspaceInput): Promise<MetabotCommandResult<PrepareGitHubForkWorkspaceResult>>;
  };
  writeChain: (request: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  uploadFile: (input: { filePath: string; network: string; contentType?: string }) => Promise<{ metafileUri?: string; uri?: string; pinId?: string; network?: string }>;
  writeLogFile: (input: LoomProcessLogInput & { directory: string; fileName: string }) => Promise<LoomProcessLogWriteResult>;
  removePath: (targetPath: string) => Promise<void>;
  renamePath: (from: string, to: string) => Promise<void>;
  pathExists: (targetPath: string) => Promise<boolean>;
  now?: () => number;
  localRunId?: string;
}

interface GitHubTaskProject {
  repoUri: string;
  baseBranch: string;
}

const PENDING_CLAIM_ID = 'pending-claim';
const DRY_RUN_CLAIM_PIN_ID = `${'0'.repeat(64)}i0`;
const DEFAULT_CHAIN = 'mvc';
const DEFAULT_BASE_BRANCH = 'main';
const DEFAULT_UPSTREAM_REMOTE = 'origin';
const DEFAULT_FORK_REMOTE = 'fork';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function validationMessage(protocol: string, errors: { path: string; message: string }[]): string {
  if (errors.length === 0) {
    return `Loom ${protocol} payload is invalid.`;
  }
  return `Loom ${protocol} payload is invalid: ${errors.map((error) => `${error.path}: ${error.message}`).join('; ')}`;
}

function invalidPayload(protocol: LoomProtocolName, payload: Record<string, unknown>): MetabotCommandResult<never> | null {
  const validation = validateLoomPayload(protocol, payload);
  if (validation.valid) {
    return null;
  }
  return commandFailed('invalid_payload', validationMessage(protocol, validation.errors));
}

async function resolveState(input: LoomClaimAndStartWorkflowInput): Promise<MetabotCommandResult<LoomWorkflowTaskState>> {
  if (input.state) {
    return commandSuccess(input.state);
  }
  if (!input.stateProvider) {
    return commandFailed('dependency_unavailable', 'Loom workflow task state is unavailable.');
  }
  return commandSuccess(await input.stateProvider(input.taskPinId));
}

function resolveGitHubProject(state: LoomWorkflowTaskState): MetabotCommandResult<GitHubTaskProject> {
  if (!state.found) {
    return commandFailed('task_not_found', state.message, { data: { state } });
  }

  const payload = isRecord(state.task.payload) ? state.task.payload : {};
  if (payload.projectBase !== 'github') {
    return commandFailed('unsupported_project_base', 'Loom claim-and-start currently supports GitHub-backed tasks only.');
  }

  const project = isRecord(payload.project) ? payload.project : {};
  const repoUri = nonEmptyString(project.repoUri);
  const baseBranch = nonEmptyString(project.baseBranch) ?? DEFAULT_BASE_BRANCH;
  if (!repoUri) {
    return commandFailed('invalid_project', 'GitHub Loom task project.repoUri is required.');
  }

  try {
    normalizeGitHubRepoUri(repoUri);
  } catch (error) {
    return commandFailed(
      'invalid_project',
      error instanceof Error ? error.message : `Invalid GitHub repository URI: ${repoUri}`,
    );
  }

  return commandSuccess({ repoUri, baseBranch });
}

function createClaimPayload(input: LoomClaimAndStartWorkflowInput, now: number): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    taskPinId: input.taskPinId,
    payoutAddress: input.payoutAddress,
    estimatedStartAt: now,
  };
  if (input.message) {
    payload.message = input.message;
  }
  return payload;
}

function createStartedStatusPayload(input: {
  taskPinId: string;
  claimPinId: string;
  branchName: string;
  workspacePath: string;
  repoUri: string;
  processLogUri?: string;
}): Record<string, unknown> {
  return {
    taskPinId: input.taskPinId,
    claimPinId: input.claimPinId,
    status: 'started',
    progressSummary: `Started work on ${input.branchName}.`,
    branchName: input.branchName,
    workspacePath: input.workspacePath,
    project: {
      base: 'github',
      repoUri: input.repoUri,
    },
    commits: [],
    ...(input.processLogUri ? { processLogs: [input.processLogUri] } : {}),
  };
}

function findClaim(state: LoomWorkflowTaskState, claimPinId: string): LoomCachedRecord | null {
  if (!state.found) {
    return null;
  }
  return state.valid.claims.find((claim) => claim.pinId === claimPinId) ?? null;
}

function claimAuthorMatches(claim: LoomCachedRecord, developerGlobalMetaId: string): boolean {
  return claim.globalMetaId === developerGlobalMetaId;
}

function workflowAuthorMatches(workflow: LoomWorkflowState, developerGlobalMetaId: string): boolean {
  return workflow.developerGlobalMetaId === developerGlobalMetaId;
}

function causeData(error: unknown): unknown {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return error;
}

function retryCommand(input: LoomClaimAndStartWorkflowInput, claimPinId: string): string {
  const parts = [
    'metabot',
    'loom',
    'claim-and-start',
    '--task-pin-id',
    input.taskPinId,
    '--claim-pin-id',
    claimPinId,
  ];
  if (input.from) parts.push('--from', input.from);
  if (input.chain) parts.push('--chain', input.chain);
  if (input.fileChain) parts.push('--file-chain', input.fileChain);
  return parts.join(' ');
}

function claimWrittenStartFailed(
  input: LoomClaimAndStartWorkflowInput,
  claimPinId: string,
  cause: unknown,
  paths: {
    stagingRepoPath: string;
    workspaceRepoPath: string;
  },
): MetabotCommandResult<never> {
  return commandFailed(
    'claim_written_start_failed',
    `Loom claim ${claimPinId} was written, but startup failed. Retry with --claim-pin-id.`,
    {
      data: {
        claimPinId,
        retryCommand: retryCommand(input, claimPinId),
        stagingRepoPath: paths.stagingRepoPath,
        workspaceRepoPath: paths.workspaceRepoPath,
        cause: causeData(cause),
      },
    },
  );
}

async function resolveRecoveryClaim(input: {
  workflowInput: LoomClaimAndStartWorkflowInput;
  state: LoomWorkflowTaskState;
  claimPinId: string;
}): Promise<MetabotCommandResult<{ workflow?: LoomWorkflowState }>> {
  const claim = findClaim(input.state, input.claimPinId);
  if (claim) {
    if (!claimAuthorMatches(claim, input.workflowInput.developerGlobalMetaId)) {
      return commandFailed('permission_denied', `Loom claim ${input.claimPinId} belongs to another developer.`);
    }
    return commandSuccess({});
  }

  const localWorkflow = await input.workflowInput.workflowStore.read(
    input.workflowInput.taskPinId,
    input.claimPinId,
  );
  if (!localWorkflow) {
    return commandFailed('claim_not_found', `Loom claim not found in cache or local workflow state: ${input.claimPinId}`);
  }
  if (!workflowAuthorMatches(localWorkflow, input.workflowInput.developerGlobalMetaId)) {
    return commandFailed('permission_denied', `Loom claim ${input.claimPinId} belongs to another developer.`);
  }
  return commandSuccess({ workflow: localWorkflow });
}

async function writeProtocolRecord(input: {
  protocol: 'claim' | 'status';
  payload: Record<string, unknown>;
  from?: string;
  chain: string;
  writeChain: (request: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
}): Promise<MetabotCommandResult<LoomProtocolRecordWriteResult>> {
  return writeLoomProtocolRecord({
    protocol: input.protocol,
    payload: input.payload,
    from: input.from,
    chain: input.chain,
    writeChain: input.writeChain,
  });
}

async function checkoutFinalBranch(input: {
  runner: LoomCommandRunner;
  workspacePath: string;
  branchName: string;
}): Promise<MetabotCommandResult<{ branchName: string }>> {
  const checkout = await input.runner.run({
    command: 'git',
    args: ['checkout', '-B', input.branchName],
    cwd: input.workspacePath,
  });
  if (checkout.exitCode !== 0) {
    const detail = checkout.stderr.trim() || checkout.stdout.trim();
    return commandFailed('git_checkout_failed', detail ? `Failed to create final Loom branch: ${detail}` : 'Failed to create final Loom branch.');
  }
  return commandSuccess({ branchName: input.branchName });
}

function createClaimWorkflowState(input: {
  taskPinId: string;
  claimPinId: string;
  developerMetaBotSlug: string;
  developerGlobalMetaId: string;
  repoUri: string;
  baseBranch: string;
  forkRepo?: string;
  branchName: string;
  workspacePath: string;
  claimWrite?: LoomProtocolRecordWriteResult;
  nowIso: string;
}): LoomWorkflowState {
  return {
    version: 1,
    taskPinId: input.taskPinId,
    claimPinId: input.claimPinId,
    developerMetaBotSlug: input.developerMetaBotSlug,
    developerGlobalMetaId: input.developerGlobalMetaId,
    repoUri: input.repoUri,
    baseBranch: input.baseBranch,
    upstreamRemote: DEFAULT_UPSTREAM_REMOTE,
    forkRemote: DEFAULT_FORK_REMOTE,
    ...(input.forkRepo ? { forkRepo: input.forkRepo } : {}),
    branchName: input.branchName,
    workspacePath: input.workspacePath,
    claim: {
      pinId: input.claimPinId,
      txids: input.claimWrite?.txids,
    },
    statuses: [],
    updatedAt: input.nowIso,
  };
}

function createWorkflowState(input: {
  taskPinId: string;
  claimPinId: string;
  developerMetaBotSlug: string;
  developerGlobalMetaId: string;
  repoUri: string;
  baseBranch: string;
  forkRepo?: string;
  branchName: string;
  workspacePath: string;
  claimWrite?: LoomProtocolRecordWriteResult;
  statusWrite: LoomProtocolRecordWriteResult;
  processLogPath: string;
  processLogUri: string;
  nowIso: string;
}): LoomWorkflowState {
  const status: LoomWorkflowStatusRecord = {
    roundId: 'start',
    status: 'started',
    pinId: input.statusWrite.pinId,
    processLogPath: input.processLogPath,
    processLogUri: input.processLogUri,
    llmSessionId: null,
    commits: [],
    checksPassed: null,
  };

  return {
    version: 1,
    taskPinId: input.taskPinId,
    claimPinId: input.claimPinId,
    developerMetaBotSlug: input.developerMetaBotSlug,
    developerGlobalMetaId: input.developerGlobalMetaId,
    repoUri: input.repoUri,
    baseBranch: input.baseBranch,
    upstreamRemote: DEFAULT_UPSTREAM_REMOTE,
    forkRemote: DEFAULT_FORK_REMOTE,
    ...(input.forkRepo ? { forkRepo: input.forkRepo } : {}),
    branchName: input.branchName,
    workspacePath: input.workspacePath,
    claim: {
      pinId: input.claimPinId,
      txids: input.claimWrite?.txids,
    },
    statuses: [status],
    updatedAt: input.nowIso,
  };
}

export async function runLoomClaimAndStartWorkflow(
  input: LoomClaimAndStartWorkflowInput,
): Promise<MetabotCommandResult<LoomClaimAndStartWorkflowDryRunResult | LoomClaimAndStartWorkflowResult>> {
  const now = input.now?.() ?? Date.now();
  const chain = input.chain ?? DEFAULT_CHAIN;
  const localRunId = input.localRunId ?? String(now);
  const recoveryMode = Boolean(input.claimPinId);

  const resolvedState = await resolveState(input);
  if (!resolvedState.ok) {
    return resolvedState;
  }
  const state = resolvedState.data;
  const nowIso = new Date(now).toISOString();

  const project = resolveGitHubProject(state);
  if (!project.ok) {
    return project;
  }

  const pendingPaths = input.workflowStore.resolve(input.taskPinId, undefined, localRunId);
  const failurePaths = (claimPinId: string): { stagingRepoPath: string; workspaceRepoPath: string } => ({
    stagingRepoPath: pendingPaths.stagingRepoPath,
    workspaceRepoPath: input.workflowStore.resolve(input.taskPinId, claimPinId).workspaceRepoPath,
  });
  const pendingBranchName = `loom/${input.taskPinId.slice(0, 8)}-pending-${localRunId}`;
  const previewClaimPinId = input.claimPinId ?? PENDING_CLAIM_ID;
  const previewPaths = input.workflowStore.resolve(input.taskPinId, previewClaimPinId, localRunId);
  const plannedClaimPinId = input.claimPinId ?? DRY_RUN_CLAIM_PIN_ID;
  const plannedBranchName = input.claimPinId
    ? buildLoomBranchName(input.taskPinId, input.claimPinId)
    : pendingBranchName;

  let claimPayload: Record<string, unknown> | undefined;
  if (!recoveryMode) {
    claimPayload = createClaimPayload(input, now);
    const invalidClaim = invalidPayload('claim', claimPayload);
    if (invalidClaim) {
      return invalidClaim;
    }
  }

  const plannedStatusPayload = createStartedStatusPayload({
    taskPinId: input.taskPinId,
    claimPinId: plannedClaimPinId,
    branchName: plannedBranchName,
    workspacePath: previewPaths.workspaceRepoPath,
    repoUri: project.data.repoUri,
  });
  const invalidStatus = invalidPayload('status', plannedStatusPayload);
  if (invalidStatus) {
    return invalidStatus;
  }

  let processLogFileChain: string;
  try {
    processLogFileChain = selectProcessLogFileChain(chain, input.fileChain);
  } catch (error) {
    return commandFailed('invalid_file_chain', error instanceof Error ? error.message : String(error));
  }

  const tools = await input.github.assertToolsReady({ runner: input.runner });
  if (!tools.ok) {
    return tools;
  }

  if (input.dryRun) {
    return commandSuccess({
      dryRun: true,
      claimPayload: claimPayload ?? {
        taskPinId: input.taskPinId,
        claimPinId: input.claimPinId,
      },
      statusPayload: plannedStatusPayload,
      preview: {
        claimPinId: previewClaimPinId,
        branchName: plannedBranchName,
        stagingRepoPath: pendingPaths.stagingRepoPath,
        workspaceRepoPath: previewPaths.workspaceRepoPath,
        processLogFileChain,
      },
    });
  }

  let recoveryWorkflow: LoomWorkflowState | undefined;
  if (recoveryMode) {
    const recoveryClaim = await resolveRecoveryClaim({
      workflowInput: input,
      state,
      claimPinId: input.claimPinId as string,
    });
    if (!recoveryClaim.ok) {
      return recoveryClaim;
    }
    recoveryWorkflow = recoveryClaim.data.workflow;
  }

  const scopedPaths = recoveryMode
    ? input.workflowStore.resolve(input.taskPinId, input.claimPinId)
    : pendingPaths;
  if (input.resetWorkspace) {
    try {
      await input.removePath(recoveryMode ? scopedPaths.workspaceRepoPath : scopedPaths.stagingRepoPath);
    } catch (error) {
      if (recoveryMode) {
        return claimWrittenStartFailed(
          input,
          input.claimPinId as string,
          error,
          failurePaths(input.claimPinId as string),
        );
      }
      throw error;
    }
  }

  const prepareBranchName = recoveryMode
    ? buildLoomBranchName(input.taskPinId, input.claimPinId as string)
    : pendingBranchName;
  const prepareWorkspacePath = recoveryMode ? scopedPaths.workspaceRepoPath : pendingPaths.stagingRepoPath;
  let reuseRecoveryWorkspace = false;
  if (recoveryMode && !input.resetWorkspace) {
    try {
      reuseRecoveryWorkspace = await input.pathExists(scopedPaths.workspaceRepoPath);
    } catch (error) {
      return claimWrittenStartFailed(
        input,
        input.claimPinId as string,
        error,
        failurePaths(input.claimPinId as string),
      );
    }
  }
  let prepared: PrepareGitHubForkWorkspaceResult | undefined;
  if (!reuseRecoveryWorkspace) {
    const preparedResult = await input.github.prepareForkWorkspace({
      runner: input.runner,
      repoUri: project.data.repoUri,
      workspaceRepoPath: prepareWorkspacePath,
      branchName: prepareBranchName,
      baseBranch: project.data.baseBranch,
      upstreamRemote: DEFAULT_UPSTREAM_REMOTE,
      forkRemote: DEFAULT_FORK_REMOTE,
    });
    if (!preparedResult.ok) {
      return recoveryMode
        ? claimWrittenStartFailed(
          input,
          input.claimPinId as string,
          preparedResult,
          failurePaths(input.claimPinId as string),
        )
        : preparedResult;
    }
    prepared = preparedResult.data;
  }

  let claimWrite: LoomProtocolRecordWriteResult | undefined;
  let finalClaimPinId = input.claimPinId;
  if (!recoveryMode) {
    const claimResult = await writeProtocolRecord({
      protocol: 'claim',
      payload: claimPayload as Record<string, unknown>,
      from: input.from,
      chain,
      writeChain: input.writeChain,
    });
    if (!claimResult.ok) {
      return claimResult;
    }
    claimWrite = claimResult.data;
    finalClaimPinId = claimWrite.pinId;
  }

  const finalPaths = input.workflowStore.resolve(input.taskPinId, finalClaimPinId);
  const finalBranchName = buildLoomBranchName(input.taskPinId, finalClaimPinId as string);
  try {
    if (claimWrite) {
      await input.workflowStore.write(createClaimWorkflowState({
        taskPinId: input.taskPinId,
        claimPinId: finalClaimPinId as string,
        developerMetaBotSlug: input.developerMetaBotSlug,
        developerGlobalMetaId: input.developerGlobalMetaId,
        repoUri: project.data.repoUri,
        baseBranch: project.data.baseBranch,
        forkRepo: prepared?.forkRepo.fullName,
        branchName: finalBranchName,
        workspacePath: finalPaths.workspaceRepoPath,
        claimWrite,
        nowIso,
      }));
    }

    if (!recoveryMode) {
      await input.renamePath(pendingPaths.stagingRepoPath, finalPaths.workspaceRepoPath);
    }

    const checkout = await checkoutFinalBranch({
      runner: input.runner,
      workspacePath: finalPaths.workspaceRepoPath,
      branchName: finalBranchName,
    });
    if (!checkout.ok) {
      return claimWrite || recoveryMode
        ? claimWrittenStartFailed(input, finalClaimPinId as string, checkout, failurePaths(finalClaimPinId as string))
        : checkout;
    }

    const statusPayloadWithoutLog = createStartedStatusPayload({
      taskPinId: input.taskPinId,
      claimPinId: finalClaimPinId as string,
      branchName: finalBranchName,
      workspacePath: finalPaths.workspaceRepoPath,
      repoUri: project.data.repoUri,
    });
    const logInput: LoomProcessLogInput & { directory: string; fileName: string } = {
      directory: finalPaths.taskLogsRoot,
      fileName: `${finalClaimPinId}-started.md`,
      taskPinId: input.taskPinId,
      claimPinId: finalClaimPinId,
      actor: {
        slug: input.developerMetaBotSlug,
        globalMetaId: input.developerGlobalMetaId,
      },
      repo: {
        uri: project.data.repoUri,
        branch: finalBranchName,
        workspacePath: finalPaths.workspaceRepoPath,
      },
      statusDecision: {
        status: 'started',
        summary: statusPayloadWithoutLog.progressSummary as string,
      },
      payloadPreview: statusPayloadWithoutLog,
      rawLog: renderLoomProcessLog({
        taskPinId: input.taskPinId,
        claimPinId: finalClaimPinId,
        statusDecision: {
          status: 'started',
          summary: statusPayloadWithoutLog.progressSummary as string,
        },
      }),
    };
    const logFile = await input.writeLogFile(logInput);
    const uploadedLog = await input.uploadFile({
      filePath: logFile.path,
      network: processLogFileChain,
      contentType: 'text/markdown',
    });
    const processLogUri = nonEmptyString(uploadedLog.metafileUri)
      ?? nonEmptyString(uploadedLog.uri)
      ?? (nonEmptyString(uploadedLog.pinId) ? `metafile://${uploadedLog.pinId}` : undefined);
    if (!processLogUri) {
      throw new Error('Loom process log upload did not return a metafile URI.');
    }

    const statusPayload = createStartedStatusPayload({
      taskPinId: input.taskPinId,
      claimPinId: finalClaimPinId as string,
      branchName: finalBranchName,
      workspacePath: finalPaths.workspaceRepoPath,
      repoUri: project.data.repoUri,
      processLogUri,
    });
    const invalidFinalStatus = invalidPayload('status', statusPayload);
    if (invalidFinalStatus) {
      return claimWrite || recoveryMode
        ? claimWrittenStartFailed(input, finalClaimPinId as string, invalidFinalStatus, failurePaths(finalClaimPinId as string))
        : invalidFinalStatus;
    }

    const statusWrite = await writeProtocolRecord({
      protocol: 'status',
      payload: statusPayload,
      from: input.from,
      chain,
      writeChain: input.writeChain,
    });
    if (!statusWrite.ok) {
      return claimWrite || recoveryMode
        ? claimWrittenStartFailed(input, finalClaimPinId as string, statusWrite, failurePaths(finalClaimPinId as string))
        : statusWrite;
    }

    const workflowState = createWorkflowState({
      taskPinId: input.taskPinId,
      claimPinId: finalClaimPinId as string,
      developerMetaBotSlug: input.developerMetaBotSlug,
      developerGlobalMetaId: input.developerGlobalMetaId,
      repoUri: project.data.repoUri,
      baseBranch: project.data.baseBranch,
      forkRepo: prepared?.forkRepo.fullName ?? recoveryWorkflow?.forkRepo,
      branchName: finalBranchName,
      workspacePath: finalPaths.workspaceRepoPath,
      claimWrite,
      statusWrite: statusWrite.data,
      processLogPath: logFile.path,
      processLogUri,
      nowIso,
    });
    const persisted = await input.workflowStore.write(workflowState);

    return commandSuccess({
      dryRun: false,
      taskPinId: input.taskPinId,
      claimPinId: finalClaimPinId as string,
      statusPinId: statusWrite.data.pinId,
      branchName: finalBranchName,
      workspacePath: finalPaths.workspaceRepoPath,
      processLogPath: logFile.path,
      processLogUri,
      workflowPath: input.workflowStore.resolve(persisted.taskPinId, persisted.claimPinId).workflowPath,
    });
  } catch (error) {
    if (claimWrite || recoveryMode) {
      return claimWrittenStartFailed(input, finalClaimPinId as string, error, failurePaths(finalClaimPinId as string));
    }
    throw error;
  }
}
