"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runLoomClaimAndStartWorkflow = runLoomClaimAndStartWorkflow;
const commandResult_1 = require("../contracts/commandResult");
const chainRequest_1 = require("./chainRequest");
const githubWorkflow_1 = require("./githubWorkflow");
const protocols_1 = require("./protocols");
const validation_1 = require("./validation");
const workflowChain_1 = require("./workflowChain");
const workflowLog_1 = require("./workflowLog");
const PENDING_CLAIM_MARKER = 'pending-claim';
const DEFAULT_CHAIN = 'mvc';
const DEFAULT_BASE_BRANCH = 'main';
const DEFAULT_UPSTREAM_REMOTE = 'origin';
const DEFAULT_FORK_REMOTE = 'fork';
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmptyString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function validationMessage(protocol, errors) {
    if (errors.length === 0) {
        return `Loom ${protocol} payload is invalid.`;
    }
    return `Loom ${protocol} payload is invalid: ${errors.map((error) => `${error.path}: ${error.message}`).join('; ')}`;
}
function invalidPayload(protocol, payload) {
    const validation = (0, validation_1.validateLoomPayload)(protocol, payload);
    if (validation.valid) {
        return null;
    }
    return (0, commandResult_1.commandFailed)('invalid_payload', validationMessage(protocol, validation.errors));
}
async function resolveState(input) {
    if (input.state) {
        return (0, commandResult_1.commandSuccess)(input.state);
    }
    if (!input.stateProvider) {
        return (0, commandResult_1.commandFailed)('dependency_unavailable', 'Loom workflow task state is unavailable.');
    }
    return (0, commandResult_1.commandSuccess)(await input.stateProvider(input.taskPinId));
}
function resolveGitHubProject(state) {
    if (!state.found) {
        return (0, commandResult_1.commandFailed)('task_not_found', state.message, { data: { state } });
    }
    const payload = isRecord(state.task.payload) ? state.task.payload : {};
    if (payload.projectBase !== 'github') {
        return (0, commandResult_1.commandFailed)('unsupported_project_base', 'Loom claim-and-start currently supports GitHub-backed tasks only.');
    }
    const project = isRecord(payload.project) ? payload.project : {};
    const repoUri = nonEmptyString(project.repoUri);
    const baseBranch = nonEmptyString(project.baseBranch) ?? DEFAULT_BASE_BRANCH;
    if (!repoUri) {
        return (0, commandResult_1.commandFailed)('invalid_project', 'GitHub Loom task project.repoUri is required.');
    }
    try {
        const upstreamRepo = (0, githubWorkflow_1.normalizeGitHubRepoUri)(repoUri);
        return (0, commandResult_1.commandSuccess)({ repoUri, baseBranch, upstreamRepo });
    }
    catch (error) {
        return (0, commandResult_1.commandFailed)('invalid_project', error instanceof Error ? error.message : `Invalid GitHub repository URI: ${repoUri}`);
    }
}
function createClaimPayload(input, now) {
    const payload = {
        taskPinId: input.taskPinId,
        payoutAddress: input.payoutAddress,
        estimatedStartAt: now,
    };
    if (input.message) {
        payload.message = input.message;
    }
    return payload;
}
function createStartedStatusPayload(input) {
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
function buildPreviewChainWriteRequest(input) {
    const built = (0, chainRequest_1.buildLoomChainWriteRequest)(input.protocol, input.payload);
    if (built.request === null) {
        return (0, commandResult_1.commandFailed)('invalid_payload', validationMessage(input.protocol, built.validation.errors));
    }
    return (0, commandResult_1.commandSuccess)({
        ...built.request,
        ...(input.from ? { from: input.from } : {}),
        network: input.chain,
    });
}
function buildUncheckedPreviewChainWriteRequest(input) {
    const spec = protocols_1.LOOM_PROTOCOLS[input.protocol];
    return {
        operation: 'create',
        path: spec.path,
        encryption: '0',
        version: spec.version,
        contentType: spec.contentType,
        payload: JSON.stringify(input.payload),
        ...(input.from ? { from: input.from } : {}),
        network: input.chain,
    };
}
function findClaim(state, claimPinId) {
    if (!state.found) {
        return null;
    }
    return state.valid.claims.find((claim) => claim.pinId === claimPinId) ?? null;
}
function claimAuthorMatches(claim, developerGlobalMetaId) {
    return claim.globalMetaId === developerGlobalMetaId;
}
function workflowAuthorMatches(workflow, developerGlobalMetaId) {
    return workflow.developerGlobalMetaId === developerGlobalMetaId;
}
function causeData(error) {
    if (error instanceof Error) {
        return { name: error.name, message: error.message };
    }
    return error;
}
function retryCommand(input, claimPinId) {
    const parts = [
        'metabot',
        'loom',
        'claim-and-start',
        '--task-pin-id',
        input.taskPinId,
        '--claim-pin-id',
        claimPinId,
    ];
    if (input.from)
        parts.push('--from', input.from);
    if (input.chain)
        parts.push('--chain', input.chain);
    if (input.fileChain)
        parts.push('--file-chain', input.fileChain);
    return parts.join(' ');
}
function syncBeforeRetryData(input, claimPinId, cause, paths, extra) {
    return {
        claimPinId,
        ...(extra ?? {}),
        stagingRepoPath: paths.stagingRepoPath,
        workspaceRepoPath: paths.workspaceRepoPath,
        syncCommand: 'metabot loom sync',
        retryAfterSyncCommand: retryCommand(input, claimPinId),
        cause: causeData(cause),
    };
}
function claimWrittenStartFailed(input, claimPinId, cause, paths) {
    return (0, commandResult_1.commandFailed)('claim_written_start_failed', `Loom claim ${claimPinId} was written, but startup failed. Retry with --claim-pin-id.`, {
        data: {
            claimPinId,
            retryCommand: retryCommand(input, claimPinId),
            stagingRepoPath: paths.stagingRepoPath,
            workspaceRepoPath: paths.workspaceRepoPath,
            cause: causeData(cause),
        },
    });
}
function claimWrittenMarkerFailed(input, claimPinId, cause, paths) {
    return (0, commandResult_1.commandFailed)('claim_written_marker_failed', `Loom claim ${claimPinId} was written, but local recovery state could not be saved. Run loom sync before retrying with --claim-pin-id.`, {
        data: syncBeforeRetryData(input, claimPinId, cause, paths),
    });
}
function claimRecoveryStateUnavailable(input, claimPinId, cause, paths) {
    return (0, commandResult_1.commandFailed)('claim_recovery_state_unavailable', `Loom claim ${claimPinId} was not found in raw cache and local recovery state could not be read. Run loom sync before retrying with --claim-pin-id.`, {
        data: syncBeforeRetryData(input, claimPinId, cause, paths),
    });
}
function claimStartedMarkerFailed(input, claimPinId, statusPinId, cause, paths) {
    return (0, commandResult_1.commandFailed)('claim_started_marker_failed', `Loom claim ${claimPinId} and started status ${statusPinId} were written, but local workflow state could not be saved. Run loom sync before retrying with --claim-pin-id.`, {
        data: syncBeforeRetryData(input, claimPinId, cause, paths, { statusPinId }),
    });
}
async function resolveRecoveryClaim(input) {
    const claim = findClaim(input.state, input.claimPinId);
    if (claim) {
        if (!claimAuthorMatches(claim, input.workflowInput.developerGlobalMetaId)) {
            return (0, commandResult_1.commandFailed)('permission_denied', `Loom claim ${input.claimPinId} belongs to another developer.`);
        }
        return (0, commandResult_1.commandSuccess)({});
    }
    const localWorkflow = await input.workflowInput.workflowStore.read(input.workflowInput.taskPinId, input.claimPinId);
    if (!localWorkflow) {
        return (0, commandResult_1.commandFailed)('claim_not_found', `Loom claim not found in cache or local workflow state: ${input.claimPinId}`);
    }
    if (!workflowAuthorMatches(localWorkflow, input.workflowInput.developerGlobalMetaId)) {
        return (0, commandResult_1.commandFailed)('permission_denied', `Loom claim ${input.claimPinId} belongs to another developer.`);
    }
    return (0, commandResult_1.commandSuccess)({ workflow: localWorkflow });
}
async function writeProtocolRecord(input) {
    return (0, workflowChain_1.writeLoomProtocolRecord)({
        protocol: input.protocol,
        payload: input.payload,
        from: input.from,
        chain: input.chain,
        writeChain: input.writeChain,
    });
}
async function checkoutFinalBranch(input) {
    const checkout = await input.runner.run({
        command: 'git',
        args: ['checkout', '-B', input.branchName],
        cwd: input.workspacePath,
    });
    if (checkout.exitCode !== 0) {
        const detail = checkout.stderr.trim() || checkout.stdout.trim();
        return (0, commandResult_1.commandFailed)('git_checkout_failed', detail ? `Failed to create final Loom branch: ${detail}` : 'Failed to create final Loom branch.');
    }
    return (0, commandResult_1.commandSuccess)({ branchName: input.branchName });
}
function createClaimWorkflowState(input) {
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
function createWorkflowState(input) {
    const status = {
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
async function runLoomClaimAndStartWorkflow(input) {
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
    const failurePaths = (claimPinId) => ({
        stagingRepoPath: pendingPaths.stagingRepoPath,
        workspaceRepoPath: input.workflowStore.resolve(input.taskPinId, claimPinId).workspaceRepoPath,
    });
    const pendingBranchName = `loom/${input.taskPinId.slice(0, 8)}-pending-${localRunId}`;
    const plannedClaimPinId = input.claimPinId ?? PENDING_CLAIM_MARKER;
    const plannedBranchName = recoveryMode
        ? (0, githubWorkflow_1.buildLoomBranchName)(input.taskPinId, plannedClaimPinId)
        : `loom/${input.taskPinId.slice(0, 8)}-${PENDING_CLAIM_MARKER}`;
    const previewPaths = input.workflowStore.resolve(input.taskPinId, plannedClaimPinId, localRunId);
    let claimPayload;
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
    if (recoveryMode) {
        const invalidStatus = invalidPayload('status', plannedStatusPayload);
        if (invalidStatus) {
            return invalidStatus;
        }
    }
    let claimChainWritePreview;
    let statusChainWritePreviewRequest;
    if (recoveryMode) {
        claimChainWritePreview = {
            skipped: true,
            claimPinId: input.claimPinId,
            reason: 'Recovery mode uses the existing claim and does not write a duplicate claim.',
        };
        const statusPreviewRequest = buildPreviewChainWriteRequest({
            protocol: 'status',
            payload: plannedStatusPayload,
            from: input.from,
            chain,
        });
        if (!statusPreviewRequest.ok) {
            return statusPreviewRequest;
        }
        statusChainWritePreviewRequest = statusPreviewRequest.data;
    }
    else {
        const claimPreviewRequest = buildPreviewChainWriteRequest({
            protocol: 'claim',
            payload: claimPayload,
            from: input.from,
            chain,
        });
        if (!claimPreviewRequest.ok) {
            return claimPreviewRequest;
        }
        claimChainWritePreview = {
            skipped: false,
            request: claimPreviewRequest.data,
        };
        statusChainWritePreviewRequest = buildUncheckedPreviewChainWriteRequest({
            protocol: 'status',
            payload: plannedStatusPayload,
            from: input.from,
            chain,
        });
    }
    let processLogFileChain;
    try {
        processLogFileChain = (0, workflowLog_1.selectProcessLogFileChain)(chain, input.fileChain);
    }
    catch (error) {
        return (0, commandResult_1.commandFailed)('invalid_file_chain', error instanceof Error ? error.message : String(error));
    }
    const tools = await input.github.assertToolsReady({ runner: input.runner });
    if (!tools.ok) {
        return tools;
    }
    let recoveryWorkflow;
    if (recoveryMode) {
        let recoveryClaim;
        try {
            recoveryClaim = await resolveRecoveryClaim({
                workflowInput: input,
                state,
                claimPinId: input.claimPinId,
            });
        }
        catch (error) {
            return claimRecoveryStateUnavailable(input, input.claimPinId, error, failurePaths(input.claimPinId));
        }
        if (!recoveryClaim.ok) {
            return recoveryClaim;
        }
        recoveryWorkflow = recoveryClaim.data.workflow;
    }
    if (input.dryRun) {
        return (0, commandResult_1.commandSuccess)({
            dryRun: true,
            claimPayload: claimPayload ?? {
                taskPinId: input.taskPinId,
                claimPinId: input.claimPinId,
            },
            statusPayload: plannedStatusPayload,
            github: {
                repoUri: project.data.repoUri,
                baseBranch: project.data.baseBranch,
                upstreamRemote: DEFAULT_UPSTREAM_REMOTE,
                forkRemote: DEFAULT_FORK_REMOTE,
                upstreamRepo: project.data.upstreamRepo,
            },
            chainWritePreviews: {
                claim: claimChainWritePreview,
                status: {
                    skipped: false,
                    request: statusChainWritePreviewRequest,
                },
            },
            preview: {
                claimPinId: plannedClaimPinId,
                branchName: plannedBranchName,
                stagingRepoPath: pendingPaths.stagingRepoPath,
                workspaceRepoPath: previewPaths.workspaceRepoPath,
                processLogFileChain,
            },
        });
    }
    const scopedPaths = recoveryMode
        ? input.workflowStore.resolve(input.taskPinId, input.claimPinId)
        : pendingPaths;
    if (input.resetWorkspace) {
        try {
            await input.removePath(recoveryMode ? scopedPaths.workspaceRepoPath : scopedPaths.stagingRepoPath);
        }
        catch (error) {
            if (recoveryMode) {
                return claimWrittenStartFailed(input, input.claimPinId, error, failurePaths(input.claimPinId));
            }
            throw error;
        }
    }
    const prepareBranchName = recoveryMode
        ? (0, githubWorkflow_1.buildLoomBranchName)(input.taskPinId, input.claimPinId)
        : pendingBranchName;
    const prepareWorkspacePath = recoveryMode ? scopedPaths.workspaceRepoPath : pendingPaths.stagingRepoPath;
    let reuseRecoveryWorkspace = false;
    if (recoveryMode && !input.resetWorkspace) {
        try {
            reuseRecoveryWorkspace = await input.pathExists(scopedPaths.workspaceRepoPath);
        }
        catch (error) {
            return claimWrittenStartFailed(input, input.claimPinId, error, failurePaths(input.claimPinId));
        }
    }
    let prepared;
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
                ? claimWrittenStartFailed(input, input.claimPinId, preparedResult, failurePaths(input.claimPinId))
                : preparedResult;
        }
        prepared = preparedResult.data;
    }
    let claimWrite;
    let finalClaimPinId = input.claimPinId;
    if (!recoveryMode) {
        const claimResult = await writeProtocolRecord({
            protocol: 'claim',
            payload: claimPayload,
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
    const finalBranchName = (0, githubWorkflow_1.buildLoomBranchName)(input.taskPinId, finalClaimPinId);
    try {
        if (claimWrite) {
            try {
                await input.workflowStore.write(createClaimWorkflowState({
                    taskPinId: input.taskPinId,
                    claimPinId: finalClaimPinId,
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
            catch (error) {
                return claimWrittenMarkerFailed(input, finalClaimPinId, error, failurePaths(finalClaimPinId));
            }
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
                ? claimWrittenStartFailed(input, finalClaimPinId, checkout, failurePaths(finalClaimPinId))
                : checkout;
        }
        const statusPayloadWithoutLog = createStartedStatusPayload({
            taskPinId: input.taskPinId,
            claimPinId: finalClaimPinId,
            branchName: finalBranchName,
            workspacePath: finalPaths.workspaceRepoPath,
            repoUri: project.data.repoUri,
        });
        const logInput = {
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
                summary: statusPayloadWithoutLog.progressSummary,
            },
            payloadPreview: statusPayloadWithoutLog,
            rawLog: (0, workflowLog_1.renderLoomProcessLog)({
                taskPinId: input.taskPinId,
                claimPinId: finalClaimPinId,
                statusDecision: {
                    status: 'started',
                    summary: statusPayloadWithoutLog.progressSummary,
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
            claimPinId: finalClaimPinId,
            branchName: finalBranchName,
            workspacePath: finalPaths.workspaceRepoPath,
            repoUri: project.data.repoUri,
            processLogUri,
        });
        const invalidFinalStatus = invalidPayload('status', statusPayload);
        if (invalidFinalStatus) {
            return claimWrite || recoveryMode
                ? claimWrittenStartFailed(input, finalClaimPinId, invalidFinalStatus, failurePaths(finalClaimPinId))
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
                ? claimWrittenStartFailed(input, finalClaimPinId, statusWrite, failurePaths(finalClaimPinId))
                : statusWrite;
        }
        const workflowState = createWorkflowState({
            taskPinId: input.taskPinId,
            claimPinId: finalClaimPinId,
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
        let persisted;
        try {
            persisted = await input.workflowStore.write(workflowState);
        }
        catch (error) {
            return claimStartedMarkerFailed(input, finalClaimPinId, statusWrite.data.pinId, error, failurePaths(finalClaimPinId));
        }
        return (0, commandResult_1.commandSuccess)({
            dryRun: false,
            taskPinId: input.taskPinId,
            claimPinId: finalClaimPinId,
            statusPinId: statusWrite.data.pinId,
            branchName: finalBranchName,
            workspacePath: finalPaths.workspaceRepoPath,
            processLogPath: logFile.path,
            processLogUri,
            workflowPath: input.workflowStore.resolve(persisted.taskPinId, persisted.claimPinId).workflowPath,
        });
    }
    catch (error) {
        if (claimWrite || recoveryMode) {
            return claimWrittenStartFailed(input, finalClaimPinId, error, failurePaths(finalClaimPinId));
        }
        throw error;
    }
}
