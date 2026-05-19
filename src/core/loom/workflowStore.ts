import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveMetabotPaths, type MetabotPaths } from '../state/paths';
import type {
  LoomWorkflowCommitRecord,
  LoomWorkflowState,
  LoomWorkflowStatusRecord,
  LoomWorkflowStatusValue,
} from './workflowTypes';

export interface LoomWorkflowPathInput {
  taskPinId: string;
  claimPinId?: string;
  localRunId?: string;
}

export interface LoomWorkflowPaths {
  loomRuntimeRoot: string;
  workflowsRoot: string;
  stagingRoot: string;
  workspacesRoot: string;
  logsRoot: string;
  workflowPath: string;
  stagingRepoPath: string;
  workspaceRepoPath: string;
  taskLogsRoot: string;
}

export interface LoomWorkflowStore {
  paths: MetabotPaths;
  resolve(taskPinId: string, claimPinId?: string, localRunId?: string): LoomWorkflowPaths;
  read(taskPinId: string, claimPinId: string): Promise<LoomWorkflowState | null>;
  write(state: LoomWorkflowState): Promise<LoomWorkflowState>;
}

function resolvePaths(homeDirOrPaths: string | MetabotPaths): MetabotPaths {
  return typeof homeDirOrPaths === 'string'
    ? resolveMetabotPaths(homeDirOrPaths)
    : homeDirOrPaths;
}

function sanitizePathSegment(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]/g, '_');
  return sanitized || 'unknown';
}

export function resolveLoomWorkflowPaths(
  homeDirOrPaths: string | MetabotPaths,
  input: LoomWorkflowPathInput,
): LoomWorkflowPaths {
  const paths = resolvePaths(homeDirOrPaths);
  const loomRuntimeRoot = path.join(paths.runtimeRoot, 'loom');
  const workflowsRoot = path.join(loomRuntimeRoot, 'workflows');
  const stagingRoot = path.join(loomRuntimeRoot, 'staging');
  const workspacesRoot = path.join(loomRuntimeRoot, 'workspaces');
  const logsRoot = path.join(loomRuntimeRoot, 'logs');
  const taskSegment = sanitizePathSegment(input.taskPinId);
  const claimSegment = sanitizePathSegment(input.claimPinId ?? 'pending-claim');
  const runSegment = sanitizePathSegment(input.localRunId ?? 'run');
  const taskLogsRoot = path.join(logsRoot, taskSegment);

  return {
    loomRuntimeRoot,
    workflowsRoot,
    stagingRoot,
    workspacesRoot,
    logsRoot,
    workflowPath: path.join(workflowsRoot, taskSegment, `${claimSegment}.json`),
    stagingRepoPath: path.join(stagingRoot, taskSegment, runSegment, 'repo'),
    workspaceRepoPath: path.join(workspacesRoot, taskSegment, claimSegment, 'repo'),
    taskLogsRoot,
  };
}

function normalizeWorkflowState(
  state: LoomWorkflowState,
  options: { refreshUpdatedAt: boolean },
): LoomWorkflowState {
  return {
    ...state,
    version: 1,
    statuses: Array.isArray(state.statuses) ? state.statuses : [],
    updatedAt: options.refreshUpdatedAt ? new Date().toISOString() : state.updatedAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

const requiredStringFields: Array<keyof Pick<
  LoomWorkflowState,
  | 'developerMetaBotSlug'
  | 'repoUri'
  | 'baseBranch'
  | 'upstreamRemote'
  | 'forkRemote'
  | 'branchName'
  | 'workspacePath'
  | 'updatedAt'
>> = [
  'developerMetaBotSlug',
  'repoUri',
  'baseBranch',
  'upstreamRemote',
  'forkRemote',
  'branchName',
  'workspacePath',
  'updatedAt',
];

function hasRequiredStringFields(record: Partial<LoomWorkflowState>): boolean {
  return requiredStringFields.every((field) => {
    const value = record[field];
    return isNonEmptyString(value);
  });
}

const statusValues = new Set<LoomWorkflowStatusValue>([
  'started',
  'in_progress',
  'completed',
  'failed',
]);

function isStringIfPresent(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isStringOrNullIfPresent(value: unknown): value is string | null | undefined {
  return value === undefined || typeof value === 'string' || value === null;
}

function isBooleanOrNullIfPresent(value: unknown): value is boolean | null | undefined {
  return value === undefined || typeof value === 'boolean' || value === null;
}

function normalizeCommitRecord(value: unknown): LoomWorkflowCommitRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  if (!isNonEmptyString(value.sha) || typeof value.message !== 'string') {
    return null;
  }

  if (!Array.isArray(value.files) || !value.files.every((file) => typeof file === 'string')) {
    return null;
  }

  return {
    sha: value.sha,
    message: value.message,
    files: value.files,
  };
}

function normalizeStatusRecord(value: unknown): LoomWorkflowStatusRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  if (!isNonEmptyString(value.roundId) || typeof value.status !== 'string') {
    return null;
  }

  if (!statusValues.has(value.status as LoomWorkflowStatusValue)) {
    return null;
  }

  const pinId = value.pinId;
  const processLogPath = value.processLogPath;
  const processLogUri = value.processLogUri;
  const llmSessionId = value.llmSessionId;
  const checksPassed = value.checksPassed;

  if (!isStringIfPresent(pinId)
    || !isStringIfPresent(processLogPath)
    || !isStringIfPresent(processLogUri)
    || !isStringOrNullIfPresent(llmSessionId)
    || !isBooleanOrNullIfPresent(checksPassed)) {
    return null;
  }

  if (!Array.isArray(value.commits)) {
    return null;
  }

  const commits = value.commits.map(normalizeCommitRecord);
  if (commits.some((commit) => commit === null)) {
    return null;
  }

  return {
    roundId: value.roundId,
    status: value.status as LoomWorkflowStatusValue,
    ...(pinId !== undefined ? { pinId } : {}),
    ...(processLogPath !== undefined ? { processLogPath } : {}),
    ...(processLogUri !== undefined ? { processLogUri } : {}),
    ...(llmSessionId !== undefined ? { llmSessionId } : {}),
    commits: commits as LoomWorkflowCommitRecord[],
    ...(checksPassed !== undefined ? { checksPassed } : {}),
  };
}

function normalizeStatusRecords(value: unknown): LoomWorkflowStatusRecord[] | null {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const statuses = value.map(normalizeStatusRecord);
  return statuses.some((status) => status === null)
    ? null
    : statuses as LoomWorkflowStatusRecord[];
}

function normalizeWorkflowStateForRead(
  value: unknown,
  taskPinId: string,
  claimPinId: string,
): LoomWorkflowState | null {
  if (!isRecord(value)) {
    return null;
  }

  const record = value as Partial<LoomWorkflowState>;
  if (!(record.version === 1
    && record.taskPinId === taskPinId
    && record.claimPinId === claimPinId
    && hasRequiredStringFields(record))) {
    return null;
  }

  const statuses = normalizeStatusRecords(record.statuses);
  if (!statuses) {
    return null;
  }

  return normalizeWorkflowState(
    {
      ...record,
      version: 1,
      taskPinId,
      claimPinId,
      statuses,
    } as LoomWorkflowState,
    { refreshUpdatedAt: false },
  );
}

async function writeJsonFileAtomically(filePath: string, payload: string): Promise<void> {
  const directory = path.dirname(filePath);
  const basename = path.basename(filePath);
  const tmpPath = path.join(
    directory,
    `${basename}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
  );

  try {
    await fs.writeFile(tmpPath, payload, 'utf8');
    await fs.rename(tmpPath, filePath);
  } catch (error) {
    try {
      await fs.unlink(tmpPath);
    } catch {
      // Best-effort cleanup after a failed atomic write attempt.
    }
    throw error;
  }
}

export function createLoomWorkflowStore(homeDirOrPaths: string | MetabotPaths): LoomWorkflowStore {
  const paths = resolvePaths(homeDirOrPaths);

  return {
    paths,
    resolve(taskPinId: string, claimPinId?: string, localRunId?: string): LoomWorkflowPaths {
      return resolveLoomWorkflowPaths(paths, { taskPinId, claimPinId, localRunId });
    },
    async read(taskPinId: string, claimPinId: string): Promise<LoomWorkflowState | null> {
      const resolved = resolveLoomWorkflowPaths(paths, { taskPinId, claimPinId });
      let raw: string;
      try {
        raw = await fs.readFile(resolved.workflowPath, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return null;
        }
        throw error;
      }

      try {
        const parsed = JSON.parse(raw) as unknown;
        return normalizeWorkflowStateForRead(parsed, taskPinId, claimPinId);
      } catch {
        return null;
      }
    },
    async write(state: LoomWorkflowState): Promise<LoomWorkflowState> {
      const normalized = normalizeWorkflowState(state, { refreshUpdatedAt: true });
      const resolved = resolveLoomWorkflowPaths(paths, normalized);

      await fs.mkdir(path.dirname(resolved.workflowPath), { recursive: true });
      await writeJsonFileAtomically(
        resolved.workflowPath,
        `${JSON.stringify(normalized, null, 2)}\n`,
      );

      return normalized;
    },
  };
}
