"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildLoomDevRoundPrompt = buildLoomDevRoundPrompt;
exports.runLoomDevRoundWorkflow = runLoomDevRoundWorkflow;
const commandResult_1 = require("../contracts/commandResult");
const workflowChain_1 = require("./workflowChain");
const workflowLog_1 = require("./workflowLog");
const DEFAULT_CHAIN = 'mvc';
const DEFAULT_COMMIT_MESSAGE = 'feat: add loom dev round workflow';
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function stringField(record, key) {
    const value = record[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function taskPayload(state) {
    if (!state.found || !isRecord(state.task.payload)) {
        return {};
    }
    return state.task.payload;
}
function taskTitle(payload) {
    return stringField(payload, 'title') ?? 'Untitled Loom task';
}
function latestStatusSummary(workflow) {
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
function listBlock(values, emptyText) {
    if (values.length === 0) {
        return `- ${emptyText}`;
    }
    return values.map((value) => `- ${value}`).join('\n');
}
function buildLoomDevRoundPrompt(input) {
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
function findClaimAuthor(state, claimPinId) {
    if (!state.found) {
        return undefined;
    }
    return state.valid.claims.find((claim) => claim.pinId === claimPinId)?.globalMetaId;
}
function workflowMatchesClaim(workflow, input) {
    return workflow.taskPinId === input.taskPinId && workflow.claimPinId === input.claimPinId;
}
function commandDetail(result) {
    return result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`;
}
function commandOutputSummary(output) {
    return output.trim();
}
function parseStatusPorcelainFiles(output) {
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
async function readGitSnapshot(runner, cwd) {
    const status = await runner.run({
        command: 'git',
        args: ['status', '--porcelain'],
        cwd,
    });
    if (status.exitCode !== 0) {
        return (0, commandResult_1.commandFailed)('git_status_failed', `Failed to read git status: ${commandDetail(status)}`);
    }
    const diff = await runner.run({
        command: 'git',
        args: ['diff', '--name-only'],
        cwd,
    });
    if (diff.exitCode !== 0) {
        return (0, commandResult_1.commandFailed)('git_diff_failed', `Failed to read git diff: ${commandDetail(diff)}`);
    }
    return (0, commandResult_1.commandSuccess)({
        statusPorcelain: status.stdout,
        changedFiles: Array.from(new Set([
            ...parseStatusPorcelainFiles(status.stdout),
            ...diff.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
        ])),
    });
}
async function runChecks(runner, cwd, checks) {
    const results = [];
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
function processLogChecks(checks, runs) {
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
async function createCommit(input) {
    const add = await input.runner.run({
        command: 'git',
        args: ['add', '-A'],
        cwd: input.cwd,
    });
    if (add.exitCode !== 0) {
        return (0, commandResult_1.commandFailed)('git_add_failed', `Failed to stage git changes: ${commandDetail(add)}`);
    }
    const commit = await input.runner.run({
        command: 'git',
        args: ['commit', '-m', input.message],
        cwd: input.cwd,
    });
    if (commit.exitCode !== 0) {
        return (0, commandResult_1.commandFailed)('git_commit_failed', `Failed to commit git changes: ${commandDetail(commit)}`);
    }
    const revParse = await input.runner.run({
        command: 'git',
        args: ['rev-parse', 'HEAD'],
        cwd: input.cwd,
    });
    if (revParse.exitCode !== 0) {
        return (0, commandResult_1.commandFailed)('git_rev_parse_failed', `Failed to read committed revision: ${commandDetail(revParse)}`);
    }
    const show = await input.runner.run({
        command: 'git',
        args: ['show', '--name-only', '--format=%s', 'HEAD'],
        cwd: input.cwd,
    });
    if (show.exitCode !== 0) {
        return (0, commandResult_1.commandFailed)('git_show_failed', `Failed to read commit summary: ${commandDetail(show)}`);
    }
    const lines = show.stdout.split(/\r?\n/);
    const message = lines[0]?.trim() ?? input.message;
    const files = lines.slice(1).map((line) => line.trim()).filter(Boolean);
    return (0, commandResult_1.commandSuccess)({
        sha: revParse.stdout.trim(),
        message,
        files,
    });
}
async function readHeadRevision(runner, cwd) {
    const revParse = await runner.run({
        command: 'git',
        args: ['rev-parse', 'HEAD'],
        cwd,
    });
    if (revParse.exitCode !== 0) {
        return (0, commandResult_1.commandFailed)('git_rev_parse_failed', `Failed to read current revision: ${commandDetail(revParse)}`);
    }
    return (0, commandResult_1.commandSuccess)(revParse.stdout.trim());
}
async function readCommitRecord(input) {
    const show = await input.runner.run({
        command: 'git',
        args: ['show', '--name-only', '--format=%s', input.sha],
        cwd: input.cwd,
    });
    if (show.exitCode !== 0) {
        return (0, commandResult_1.commandFailed)('git_show_failed', `Failed to read commit summary: ${commandDetail(show)}`);
    }
    const lines = show.stdout.split(/\r?\n/);
    return (0, commandResult_1.commandSuccess)({
        sha: input.sha,
        message: lines[0]?.trim() || input.sha,
        files: lines.slice(1).map((line) => line.trim()).filter(Boolean),
    });
}
async function readCommitsSince(input) {
    const revList = await input.runner.run({
        command: 'git',
        args: ['rev-list', '--reverse', `${input.baseHead}..HEAD`],
        cwd: input.cwd,
    });
    if (revList.exitCode !== 0) {
        return (0, commandResult_1.commandFailed)('git_rev_list_failed', `Failed to read development round commits: ${commandDetail(revList)}`);
    }
    const commits = [];
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
    return (0, commandResult_1.commandSuccess)(commits);
}
function decideStatus(input) {
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
function createStatusPayload(input) {
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
function processLogFileName(now, claimPinId) {
    return `dev-round-${claimPinId.slice(0, 12)}-${now}.md`;
}
function serializeError(error) {
    if (error instanceof Error) {
        return { name: error.name, message: error.message };
    }
    return { value: String(error) };
}
function devRoundStatusMarkerFailed(input) {
    const paths = input.workflowInput.workflowStore.resolve(input.workflowInput.taskPinId, input.workflowInput.claimPinId);
    return (0, commandResult_1.commandFailed)('dev_round_status_marker_failed', `Loom status ${input.statusWrite.pinId} was written, but local dev-round marker state could not be saved. Sync and inspect local workflow state before retrying.`, {
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
    });
}
async function writeAndUploadLog(input) {
    const workflowPaths = input.workflowInput.workflowStore.resolve(input.workflowInput.taskPinId, input.workflowInput.claimPinId);
    let logFile;
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
    }
    catch (error) {
        return (0, commandResult_1.commandFailed)('process_log_write_failed', `Failed to write Loom process log: ${error instanceof Error ? error.message : String(error)}`, {
            data: { cause: serializeError(error) },
        });
    }
    let uploaded;
    try {
        uploaded = await input.workflowInput.uploadFile({
            filePath: logFile.path,
            contentType: 'text/markdown',
            network: (0, workflowLog_1.selectProcessLogFileChain)(input.workflowInput.chain ?? DEFAULT_CHAIN, input.workflowInput.fileChain),
        });
    }
    catch (error) {
        return (0, commandResult_1.commandFailed)('process_log_upload_failed', `Failed to upload Loom process log: ${error instanceof Error ? error.message : String(error)}`, {
            data: { processLogPath: logFile.path, cause: serializeError(error) },
        });
    }
    const uri = uploaded.metafileUri ?? uploaded.uri;
    if (!uri) {
        return (0, commandResult_1.commandFailed)('process_log_upload_failed', 'Failed to upload Loom process log: uploader returned no metafile URI.', {
            data: { processLogPath: logFile.path },
        });
    }
    return (0, commandResult_1.commandSuccess)({ path: logFile.path, uri });
}
async function writeStatus(input) {
    return (0, workflowChain_1.writeLoomProtocolRecord)({
        protocol: 'status',
        payload: input.payload,
        from: input.workflowInput.from,
        chain: input.workflowInput.chain ?? DEFAULT_CHAIN,
        writeChain: input.workflowInput.writeChain,
    });
}
async function runLoomDevRoundWorkflow(input) {
    const now = input.now?.() ?? Date.now();
    if (!input.state.found) {
        return (0, commandResult_1.commandFailed)('task_not_found', input.state.message);
    }
    const claimAuthor = findClaimAuthor(input.state, input.claimPinId);
    if (claimAuthor && claimAuthor !== input.developerGlobalMetaId) {
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
    const errors = [];
    let git = { statusPorcelain: '', changedFiles: [] };
    let checkRuns = [];
    let commits = [];
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
    }
    else {
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
    const statusRecord = {
        roundId: `dev-round-${now}`,
        status: decision.status,
        pinId: statusWrite.data.pinId,
        processLogPath: logUpload.data.path,
        processLogUri: logUpload.data.uri,
        llmSessionId: llm.sessionId ?? null,
        commits,
        checksPassed: decision.checksPassed,
    };
    let updatedWorkflow;
    try {
        updatedWorkflow = await input.workflowStore.write({
            ...workflow,
            statuses: [...workflow.statuses, statusRecord],
            updatedAt: new Date(now).toISOString(),
        });
    }
    catch (error) {
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
    return (0, commandResult_1.commandSuccess)({
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
