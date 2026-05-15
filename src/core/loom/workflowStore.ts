import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveMetabotPaths, type MetabotPaths } from '../state/paths';
import type { LoomWorkflowState } from './workflowTypes';

export interface LoomWorkflowPathInput {
  taskPinId: string;
  claimPinId: string;
  localRunId?: string;
}

export interface LoomWorkflowPaths {
  loomRoot: string;
  workflowPath: string;
  workspaceRepoPath: string;
  stagingRepoPath: string;
}

export interface LoomWorkflowStore {
  paths: MetabotPaths;
  resolve(taskPinId: string, claimPinId: string, localRunId?: string): LoomWorkflowPaths;
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
  const loomRoot = path.join(paths.runtimeRoot, 'loom');
  const taskSegment = sanitizePathSegment(input.taskPinId);
  const claimSegment = sanitizePathSegment(input.claimPinId);
  const runSegment = sanitizePathSegment(input.localRunId ?? input.claimPinId);

  return {
    loomRoot,
    workflowPath: path.join(loomRoot, 'workflows', taskSegment, `${claimSegment}.json`),
    workspaceRepoPath: path.join(loomRoot, 'workspaces', taskSegment, claimSegment, 'repo'),
    stagingRepoPath: path.join(loomRoot, 'staging', taskSegment, runSegment, 'repo'),
  };
}

function normalizeWorkflowState(state: LoomWorkflowState): LoomWorkflowState {
  return {
    ...state,
    version: 1,
    statuses: Array.isArray(state.statuses) ? state.statuses : [],
    updatedAt: new Date().toISOString(),
  };
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
    && Array.isArray(record.statuses);
}

export function createLoomWorkflowStore(homeDirOrPaths: string | MetabotPaths): LoomWorkflowStore {
  const paths = resolvePaths(homeDirOrPaths);

  return {
    paths,
    resolve(taskPinId: string, claimPinId: string, localRunId?: string): LoomWorkflowPaths {
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
        return isWorkflowStateForClaim(parsed, taskPinId, claimPinId) ? parsed : null;
      } catch {
        return null;
      }
    },
    async write(state: LoomWorkflowState): Promise<LoomWorkflowState> {
      const normalized = normalizeWorkflowState(state);
      const resolved = resolveLoomWorkflowPaths(paths, normalized);

      await Promise.all([
        fs.mkdir(path.dirname(resolved.workflowPath), { recursive: true }),
        fs.mkdir(resolved.workspaceRepoPath, { recursive: true }),
        fs.mkdir(resolved.stagingRepoPath, { recursive: true }),
      ]);
      await fs.writeFile(resolved.workflowPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');

      return normalized;
    },
  };
}
