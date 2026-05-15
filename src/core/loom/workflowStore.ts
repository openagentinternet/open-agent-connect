import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveMetabotPaths, type MetabotPaths } from '../state/paths';
import type { LoomWorkflowState } from './workflowTypes';

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
    return typeof value === 'string' && value.trim().length > 0;
  });
}

function isWorkflowStateForClaim(
  value: unknown,
  taskPinId: string,
  claimPinId: string,
): value is LoomWorkflowState {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Partial<LoomWorkflowState>;
  return record.version === 1
    && record.taskPinId === taskPinId
    && record.claimPinId === claimPinId
    && hasRequiredStringFields(record)
    && (record.statuses === undefined || Array.isArray(record.statuses));
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
        return isWorkflowStateForClaim(parsed, taskPinId, claimPinId)
          ? normalizeWorkflowState(parsed, { refreshUpdatedAt: false })
          : null;
      } catch {
        return null;
      }
    },
    async write(state: LoomWorkflowState): Promise<LoomWorkflowState> {
      const normalized = normalizeWorkflowState(state, { refreshUpdatedAt: true });
      const resolved = resolveLoomWorkflowPaths(paths, normalized);

      await fs.mkdir(path.dirname(resolved.workflowPath), { recursive: true });
      await fs.writeFile(resolved.workflowPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');

      return normalized;
    },
  };
}
