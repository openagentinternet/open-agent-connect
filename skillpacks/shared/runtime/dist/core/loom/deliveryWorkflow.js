"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runLoomDeliverWorkflow = runLoomDeliverWorkflow;
const commandResult_1 = require("../contracts/commandResult");
const chainRequest_1 = require("./chainRequest");
const githubWorkflow_1 = require("./githubWorkflow");
const workflowChain_1 = require("./workflowChain");
const DEFAULT_CHAIN = 'mvc';
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmptyString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function taskPayload(state) {
    if (!state.found || !isRecord(state.task.payload)) {
        return {};
    }
    return state.task.payload;
}
function taskTitle(payload) {
    return nonEmptyString(payload.title) ?? 'Loom task delivery';
}
function taskCriteria(payload) {
    return nonEmptyString(payload.criteria) ?? 'Review the delivered work.';
}
function resolveGitHubProject(payload) {
    if (payload.projectBase !== 'github') {
        return (0, commandResult_1.commandFailed)('unsupported_project_base', 'Loom deliver currently supports GitHub-backed tasks only.');
    }
    const project = isRecord(payload.project) ? payload.project : {};
    const repoUri = nonEmptyString(project.repoUri);
    const baseBranch = nonEmptyString(project.baseBranch);
    if (!repoUri) {
        return (0, commandResult_1.commandFailed)('invalid_project', 'GitHub Loom task project.repoUri is required.');
    }
    if (!baseBranch) {
        return (0, commandResult_1.commandFailed)('invalid_project', 'GitHub Loom task project.baseBranch is required.');
    }
    try {
        const upstreamRepo = (0, githubWorkflow_1.normalizeGitHubRepoUri)(repoUri);
        return (0, commandResult_1.commandSuccess)({ repoUri, baseBranch, upstreamRepoFullName: upstreamRepo.fullName });
    }
    catch (error) {
        return (0, commandResult_1.commandFailed)('invalid_project', error instanceof Error ? error.message : `Invalid GitHub repository URI: ${repoUri}`);
    }
}
function findClaimAuthor(state, claimPinId) {
    if (!state.found) {
        return undefined;
    }
    return state.valid.claims.find((claim) => claim.pinId === claimPinId)?.globalMetaId;
}
function workflowMatchesClaim(workflow, input) {
    return workflow.taskPinId === input.taskPinId && workflow.claimPinId === input.claimPinId;
}
function latestChecksPassed(workflow) {
    return workflow.statuses.at(-1)?.checksPassed === true;
}
function deliveryPayloadPrUrl(record) {
    if (!isRecord(record.payload)) {
        return undefined;
    }
    const delivery = record.payload.delivery;
    if (!isRecord(delivery)) {
        return undefined;
    }
    return nonEmptyString(delivery.prUrl);
}
function deliveryPayloadPrTitle(record) {
    if (!isRecord(record.payload)) {
        return undefined;
    }
    const delivery = record.payload.delivery;
    if (!isRecord(delivery)) {
        return undefined;
    }
    return nonEmptyString(delivery.prTitle);
}
function existingChainDelivery(state, claimPinId) {
    if (!state.found) {
        return null;
    }
    const delivery = state.valid.deliveries.find((record) => {
        if (!isRecord(record.payload)) {
            return false;
        }
        return record.payload.claimPinId === claimPinId;
    });
    if (!delivery) {
        return null;
    }
    return {
        pinId: delivery.pinId,
        prUrl: deliveryPayloadPrUrl(delivery),
        prTitle: deliveryPayloadPrTitle(delivery),
    };
}
function alreadyDelivered(input) {
    return (0, commandResult_1.commandFailed)('already_delivered', `Loom claim already has a delivery: ${input.deliveryPinId}.`, {
        data: {
            source: input.source,
            deliveryPinId: input.deliveryPinId,
            ...(input.prUrl ? { prUrl: input.prUrl } : {}),
            ...(input.prTitle ? { prTitle: input.prTitle } : {}),
        },
    });
}
function parseChecklist(criteria) {
    const items = criteria
        .split(/\r?\n/)
        .map((line) => line.trim())
        .map((line) => {
        const match = /^(?:[-*+]\s+|\d+[.)]\s+)(.+)$/.exec(line);
        return match?.[1]?.trim();
    })
        .filter((item) => Boolean(item));
    const fallback = criteria.trim().replace(/\s+/g, ' ');
    const checklist = items.length > 0 ? items : [fallback || 'Review the delivered work.'];
    return checklist.map((item) => ({ item, status: 'passed' }));
}
function forkOwner(workflow) {
    const forkRepo = nonEmptyString(workflow.forkRepo);
    if (!forkRepo) {
        return (0, commandResult_1.commandFailed)('invalid_loom_state', 'Local Loom workflow state is missing forkRepo, so a pull request head cannot be resolved.');
    }
    try {
        return (0, commandResult_1.commandSuccess)((0, githubWorkflow_1.normalizeGitHubRepoUri)(forkRepo).owner);
    }
    catch (error) {
        return (0, commandResult_1.commandFailed)('invalid_loom_state', error instanceof Error ? error.message : `Invalid Loom workflow forkRepo: ${forkRepo}`);
    }
}
function buildPullRequestBody(input) {
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
function createDeliveryPayload(input) {
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
function buildPreviewChainWriteRequest(input) {
    const built = (0, chainRequest_1.buildLoomChainWriteRequest)('delivery', input.payload);
    if (built.request === null) {
        return (0, commandResult_1.commandFailed)('invalid_payload', `Loom delivery payload is invalid: ${built.validation.errors.map((error) => `${error.path}: ${error.message}`).join('; ')}`);
    }
    return (0, commandResult_1.commandSuccess)({
        ...built.request,
        ...(input.from ? { from: input.from } : {}),
        network: input.chain,
    });
}
function serializeError(error) {
    if (error instanceof Error) {
        return { name: error.name, message: error.message };
    }
    return error;
}
function deliveryMarkerFailed(input) {
    const paths = input.workflowInput.workflowStore.resolve(input.workflowInput.taskPinId, input.workflowInput.claimPinId);
    return (0, commandResult_1.commandFailed)('delivery_marker_failed', `Loom delivery ${input.deliveryWrite.pinId} was written, but local delivery state could not be saved. Run loom sync before retrying.`, {
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
    });
}
async function runLoomDeliverWorkflow(input) {
    const now = input.now?.() ?? Date.now();
    const chain = input.chain ?? DEFAULT_CHAIN;
    if (!input.state.found) {
        return (0, commandResult_1.commandFailed)('task_not_found', input.state.message);
    }
    const claimAuthor = findClaimAuthor(input.state, input.claimPinId);
    if (!claimAuthor) {
        return (0, commandResult_1.commandFailed)('claim_not_found', `Loom claim ${input.claimPinId} was not found for task ${input.taskPinId}.`);
    }
    if (claimAuthor !== input.developerGlobalMetaId) {
        return (0, commandResult_1.commandFailed)('permission_denied', `Loom claim ${input.claimPinId} belongs to another developer.`);
    }
    const workflow = await input.workflowStore.read(input.taskPinId, input.claimPinId);
    if (!workflow) {
        return (0, commandResult_1.commandFailed)('claim_not_found', `Local Loom workflow state was not found for claim ${input.claimPinId}.`);
    }
    if (!workflowMatchesClaim(workflow, input)) {
        return (0, commandResult_1.commandFailed)('invalid_loom_state', `Local Loom workflow state does not match task ${input.taskPinId} and claim ${input.claimPinId}.`);
    }
    if (workflow.developerGlobalMetaId && workflow.developerGlobalMetaId !== input.developerGlobalMetaId) {
        return (0, commandResult_1.commandFailed)('permission_denied', `Loom claim ${input.claimPinId} belongs to another developer.`);
    }
    if (workflow.delivery?.pinId) {
        return alreadyDelivered({
            source: 'local_workflow',
            deliveryPinId: workflow.delivery.pinId,
            prUrl: workflow.delivery.prUrl,
            prTitle: workflow.delivery.prTitle,
        });
    }
    const projectedDelivery = existingChainDelivery(input.state, input.claimPinId);
    if (projectedDelivery) {
        return alreadyDelivered({
            source: 'chain_projection',
            deliveryPinId: projectedDelivery.pinId,
            prUrl: projectedDelivery.prUrl,
            prTitle: projectedDelivery.prTitle,
        });
    }
    if (!latestChecksPassed(workflow)) {
        return (0, commandResult_1.commandFailed)('check_failed', 'Latest local Loom workflow status does not have passing checks.');
    }
    const payload = taskPayload(input.state);
    const project = resolveGitHubProject(payload);
    if (!project.ok) {
        return project;
    }
    const owner = forkOwner(workflow);
    if (!owner.ok) {
        return owner;
    }
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
            prBaseBranch: project.data.baseBranch,
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
        return (0, commandResult_1.commandSuccess)({
            dryRun: true,
            push: {
                workspacePath: workflow.workspacePath,
                forkRemote: workflow.forkRemote,
                branchName: workflow.branchName,
            },
            pullRequest: {
                repo: project.data.upstreamRepoFullName,
                baseBranch: project.data.baseBranch,
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
    const tools = await input.github.assertToolsReady({ runner: input.runner });
    if (!tools.ok) {
        return tools;
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
        repo: project.data.upstreamRepoFullName,
        baseBranch: project.data.baseBranch,
        head,
        title,
        body,
    });
    if (!pr.ok) {
        return pr;
    }
    if (!nonEmptyString(pr.data.url)) {
        return (0, commandResult_1.commandFailed)('invalid_pull_request', 'GitHub pull request creation returned an empty pull request URL.');
    }
    const deliveryPayload = createDeliveryPayload({
        taskPinId: input.taskPinId,
        claimPinId: input.claimPinId,
        deliverySummary,
        prUrl: pr.data.url,
        prBranch: workflow.branchName,
        prBaseBranch: project.data.baseBranch,
        prTitle: title,
        reviewChecklist,
    });
    const deliveryWrite = await (0, workflowChain_1.writeLoomProtocolRecord)({
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
    }
    catch (error) {
        return deliveryMarkerFailed({
            workflowInput: input,
            workflow,
            deliveryWrite: deliveryWrite.data,
            prUrl: pr.data.url,
            cause: error,
        });
    }
    return (0, commandResult_1.commandSuccess)({
        dryRun: false,
        taskPinId: input.taskPinId,
        claimPinId: input.claimPinId,
        deliveryPinId: deliveryWrite.data.pinId,
        prUrl: pr.data.url,
        prTitle: title,
        branchName: workflow.branchName,
        baseBranch: project.data.baseBranch,
        workspacePath: workflow.workspacePath,
    });
}
