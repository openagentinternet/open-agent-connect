import {
  commandFailed,
  commandSuccess,
  type MetabotCommandResult,
} from '../contracts/commandResult';
import type { LoomCommandRunner } from './commandRunner';
import { buildLoomChainWriteRequest, type LoomChainWriteRequest } from './chainRequest';
import type {
  CreateLoomPullRequestInput,
  CreateLoomPullRequestResult,
  PushLoomBranchInput,
  PushLoomBranchResult,
} from './githubWorkflow';
import { normalizeGitHubRepoUri } from './githubWorkflow';
import type { LoomWorkflowTaskState } from './workflowState';
import type { LoomWorkflowStore } from './workflowStore';
import type { LoomWorkflowState } from './workflowTypes';
import { writeLoomProtocolRecord, type LoomProtocolRecordWriteResult } from './workflowChain';

export type LoomDeliverChainWritePreviewRequest = LoomChainWriteRequest & {
  from?: string;
  network?: string;
};

export interface LoomDeliverDryRunResult {
  dryRun: true;
  push: {
    workspacePath: string;
    forkRemote: string;
    branchName: string;
  };
  pullRequest: {
    baseBranch: string;
    head: string;
    title: string;
    body: string;
  };
  deliveryPayload: Record<string, unknown>;
  chainWritePreview: {
    request: LoomDeliverChainWritePreviewRequest;
  };
}

export interface LoomDeliverWorkflowResult {
  dryRun: false;
  taskPinId: string;
  claimPinId: string;
  deliveryPinId: string;
  prUrl: string;
  prTitle: string;
  branchName: string;
  baseBranch: string;
  workspacePath: string;
}

export interface LoomDeliverWorkflowInput {
  from?: string;
  taskPinId: string;
  claimPinId: string;
  chain?: string;
  prTitle?: string;
  deliverySummary?: string;
  dryRun?: boolean;
  developerMetaBotSlug: string;
  developerGlobalMetaId: string;
  state: LoomWorkflowTaskState;
  workflowStore: LoomWorkflowStore;
  runner: LoomCommandRunner;
  github: {
    pushLoomBranch(input: PushLoomBranchInput): Promise<MetabotCommandResult<PushLoomBranchResult>>;
    createLoomPullRequest(input: CreateLoomPullRequestInput): Promise<MetabotCommandResult<CreateLoomPullRequestResult>>;
  };
  writeChain: (request: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  now?: () => number;
}

const DEFAULT_CHAIN = 'mvc';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function taskPayload(state: LoomWorkflowTaskState): Record<string, unknown> {
  if (!state.found || !isRecord(state.task.payload)) {
    return {};
  }
  return state.task.payload;
}

function taskTitle(payload: Record<string, unknown>): string {
  return nonEmptyString(payload.title) ?? 'Loom task delivery';
}

function taskCriteria(payload: Record<string, unknown>): string {
  return nonEmptyString(payload.criteria) ?? 'Review the delivered work.';
}

function findClaimAuthor(state: LoomWorkflowTaskState, claimPinId: string): string | undefined {
  if (!state.found) {
    return undefined;
  }
  return state.valid.claims.find((claim) => claim.pinId === claimPinId)?.globalMetaId;
}

function workflowMatchesClaim(workflow: LoomWorkflowState, input: LoomDeliverWorkflowInput): boolean {
  return workflow.taskPinId === input.taskPinId && workflow.claimPinId === input.claimPinId;
}

function latestChecksPassed(workflow: LoomWorkflowState): boolean {
  return workflow.statuses.at(-1)?.checksPassed === true;
}

function parseChecklist(criteria: string): Array<{ item: string; status: 'passed' }> {
  const items = criteria
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => {
      const match = /^(?:[-*+]\s+|\d+[.)]\s+)(.+)$/.exec(line);
      return match?.[1]?.trim();
    })
    .filter((item): item is string => Boolean(item));

  const fallback = criteria.trim().replace(/\s+/g, ' ');
  const checklist = items.length > 0 ? items : [fallback || 'Review the delivered work.'];
  return checklist.map((item) => ({ item, status: 'passed' }));
}

function forkOwner(workflow: LoomWorkflowState): MetabotCommandResult<string> {
  const forkRepo = nonEmptyString(workflow.forkRepo);
  if (!forkRepo) {
    return commandFailed('invalid_loom_state', 'Local Loom workflow state is missing forkRepo, so a pull request head cannot be resolved.');
  }

  try {
    return commandSuccess(normalizeGitHubRepoUri(forkRepo).owner);
  } catch (error) {
    return commandFailed(
      'invalid_loom_state',
      error instanceof Error ? error.message : `Invalid Loom workflow forkRepo: ${forkRepo}`,
    );
  }
}

function buildPullRequestBody(input: {
  deliverySummary: string;
  taskPinId: string;
  claimPinId: string;
  branchName: string;
  checklist: Array<{ item: string; status: 'passed' }>;
}): string {
  return [
    input.deliverySummary,
    '',
    `Task PIN: ${input.taskPinId}`,
    `Claim PIN: ${input.claimPinId}`,
    `Branch: ${input.branchName}`,
    '',
    'Review checklist:',
    ...input.checklist.map((entry) => `- [x] ${entry.item}`),
  ].join('\n');
}

function createDeliveryPayload(input: {
  taskPinId: string;
  claimPinId: string;
  deliverySummary: string;
  prUrl: string;
  prBranch: string;
  prBaseBranch: string;
  prTitle: string;
  reviewChecklist: Array<{ item: string; status: 'passed' }>;
}): Record<string, unknown> {
  return {
    taskPinId: input.taskPinId,
    claimPinId: input.claimPinId,
    deliveryBase: 'github',
    deliverySummary: input.deliverySummary,
    delivery: {
      prUrl: input.prUrl,
      prBranch: input.prBranch,
      prBaseBranch: input.prBaseBranch,
      prTitle: input.prTitle,
    },
    reviewChecklist: input.reviewChecklist,
  };
}

function buildPreviewChainWriteRequest(input: {
  payload: Record<string, unknown>;
  from?: string;
  chain: string;
}): MetabotCommandResult<LoomDeliverChainWritePreviewRequest> {
  const built = buildLoomChainWriteRequest('delivery', input.payload);
  if (built.request === null) {
    return commandFailed(
      'invalid_payload',
      `Loom delivery payload is invalid: ${built.validation.errors.map((error) => `${error.path}: ${error.message}`).join('; ')}`,
    );
  }
  return commandSuccess({
    ...built.request,
    ...(input.from ? { from: input.from } : {}),
    network: input.chain,
  });
}

function serializeError(error: unknown): Record<string, unknown> | unknown {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return error;
}

function deliveryMarkerFailed(input: {
  workflowInput: LoomDeliverWorkflowInput;
  workflow: LoomWorkflowState;
  deliveryWrite: LoomProtocolRecordWriteResult;
  prUrl: string;
  cause: unknown;
}): MetabotCommandResult<never> {
  const paths = input.workflowInput.workflowStore.resolve(
    input.workflowInput.taskPinId,
    input.workflowInput.claimPinId,
  );
  return commandFailed(
    'delivery_marker_failed',
    `Loom delivery ${input.deliveryWrite.pinId} was written, but local delivery state could not be saved. Run loom sync before retrying.`,
    {
      data: {
        taskPinId: input.workflowInput.taskPinId,
        claimPinId: input.workflowInput.claimPinId,
        deliveryPinId: input.deliveryWrite.pinId,
        prUrl: input.prUrl,
        workflowPath: paths.workflowPath,
        workspacePath: input.workflow.workspacePath,
        syncCommand: 'metabot loom sync',
        retryAfterSyncCommand: 'After sync, inspect local workflow state before deciding whether another delivery attempt is needed.',
        cause: serializeError(input.cause),
      },
    },
  );
}

export async function runLoomDeliverWorkflow(
  input: LoomDeliverWorkflowInput,
): Promise<MetabotCommandResult<LoomDeliverDryRunResult | LoomDeliverWorkflowResult>> {
  const now = input.now?.() ?? Date.now();
  const chain = input.chain ?? DEFAULT_CHAIN;

  if (!input.state.found) {
    return commandFailed('task_not_found', input.state.message);
  }

  const claimAuthor = findClaimAuthor(input.state, input.claimPinId);
  if (!claimAuthor) {
    return commandFailed('claim_not_found', `Loom claim ${input.claimPinId} was not found for task ${input.taskPinId}.`);
  }
  if (claimAuthor !== input.developerGlobalMetaId) {
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
  if (!latestChecksPassed(workflow)) {
    return commandFailed('check_failed', 'Latest local Loom workflow status does not have passing checks.');
  }

  const owner = forkOwner(workflow);
  if (!owner.ok) {
    return owner;
  }

  const payload = taskPayload(input.state);
  const title = nonEmptyString(input.prTitle) ?? `Deliver: ${taskTitle(payload)}`;
  const deliverySummary = nonEmptyString(input.deliverySummary) ?? `Delivery for ${taskTitle(payload)}.`;
  const reviewChecklist = parseChecklist(taskCriteria(payload));
  const head = `${owner.data}:${workflow.branchName}`;
  const body = buildPullRequestBody({
    deliverySummary,
    taskPinId: input.taskPinId,
    claimPinId: input.claimPinId,
    branchName: workflow.branchName,
    checklist: reviewChecklist,
  });

  if (input.dryRun) {
    const dryRunPayload = createDeliveryPayload({
      taskPinId: input.taskPinId,
      claimPinId: input.claimPinId,
      deliverySummary,
      prUrl: '(pending pull request URL)',
      prBranch: workflow.branchName,
      prBaseBranch: workflow.baseBranch,
      prTitle: title,
      reviewChecklist,
    });
    const preview = buildPreviewChainWriteRequest({
      payload: dryRunPayload,
      from: input.from,
      chain,
    });
    if (!preview.ok) {
      return preview;
    }
    return commandSuccess({
      dryRun: true,
      push: {
        workspacePath: workflow.workspacePath,
        forkRemote: workflow.forkRemote,
        branchName: workflow.branchName,
      },
      pullRequest: {
        baseBranch: workflow.baseBranch,
        head,
        title,
        body,
      },
      deliveryPayload: dryRunPayload,
      chainWritePreview: {
        request: preview.data,
      },
    });
  }

  const push = await input.github.pushLoomBranch({
    runner: input.runner,
    workspacePath: workflow.workspacePath,
    forkRemote: workflow.forkRemote,
    branchName: workflow.branchName,
  });
  if (!push.ok) {
    return push;
  }

  const pr = await input.github.createLoomPullRequest({
    runner: input.runner,
    workspacePath: workflow.workspacePath,
    baseBranch: workflow.baseBranch,
    head,
    title,
    body,
  });
  if (!pr.ok) {
    return pr;
  }

  const deliveryPayload = createDeliveryPayload({
    taskPinId: input.taskPinId,
    claimPinId: input.claimPinId,
    deliverySummary,
    prUrl: pr.data.url,
    prBranch: workflow.branchName,
    prBaseBranch: workflow.baseBranch,
    prTitle: title,
    reviewChecklist,
  });
  const deliveryWrite = await writeLoomProtocolRecord({
    protocol: 'delivery',
    payload: deliveryPayload,
    from: input.from,
    chain,
    writeChain: input.writeChain,
  });
  if (!deliveryWrite.ok) {
    return deliveryWrite;
  }

  try {
    await input.workflowStore.write({
      ...workflow,
      delivery: {
        pinId: deliveryWrite.data.pinId,
        prUrl: pr.data.url,
        prTitle: title,
      },
      updatedAt: new Date(now).toISOString(),
    });
  } catch (error) {
    return deliveryMarkerFailed({
      workflowInput: input,
      workflow,
      deliveryWrite: deliveryWrite.data,
      prUrl: pr.data.url,
      cause: error,
    });
  }

  return commandSuccess({
    dryRun: false,
    taskPinId: input.taskPinId,
    claimPinId: input.claimPinId,
    deliveryPinId: deliveryWrite.data.pinId,
    prUrl: pr.data.url,
    prTitle: title,
    branchName: workflow.branchName,
    baseBranch: workflow.baseBranch,
    workspacePath: workflow.workspacePath,
  });
}
