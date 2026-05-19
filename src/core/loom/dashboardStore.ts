import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveMetabotPaths, type MetabotPaths } from '../state/paths';
import type { LoomDashboardState } from './dashboardTypes';

export interface LoomDashboardStore {
  indexPath: string;
  read(): Promise<LoomDashboardState | null>;
  write(state: LoomDashboardState): Promise<LoomDashboardState>;
}

function resolvePaths(homeDirOrPaths: string | MetabotPaths): MetabotPaths {
  return typeof homeDirOrPaths === 'string'
    ? resolveMetabotPaths(homeDirOrPaths)
    : homeDirOrPaths;
}

export function resolveLoomDashboardIndexPath(homeDirOrPaths: string | MetabotPaths): string {
  const paths = resolvePaths(homeDirOrPaths);
  return path.join(paths.runtimeRoot, 'loom', 'dashboard', 'index.json');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isArrayIfPresent(value: unknown): value is unknown[] | undefined {
  return value === undefined || Array.isArray(value);
}

function isStringIfPresent(value: unknown): value is string | undefined {
  return value === undefined || isString(value);
}

function isStringOrNullIfPresent(value: unknown): value is string | null | undefined {
  return value === undefined || isString(value) || value === null;
}

function isFiniteNumberIfPresent(value: unknown): value is number | undefined {
  return value === undefined || isFiniteNumber(value);
}

function isRecordArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isRecord);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isSerializable(value: unknown): boolean {
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}

const requiredSummaryNumberFields = [
  'totalTasks',
  'open',
  'claimed',
  'inProgress',
  'delivered',
  'revisionNeeded',
  'rejected',
  'acceptedPaid',
  'failed',
  'invalidRecords',
  'needsMyAction',
];

const dashboardTaskStates = new Set([
  'open',
  'claimed',
  'in_progress',
  'delivered',
  'revision_needed',
  'rejected',
  'accepted_paid',
  'failed',
]);

const dashboardStateTones = new Set([
  'neutral',
  'info',
  'progress',
  'review',
  'warning',
  'success',
  'danger',
]);

const dashboardColumnIds = new Set([
  'open',
  'claimed',
  'working',
  'review',
  'revision',
  'closed',
]);

const actorContextRoles = new Set([
  'requester',
  'developer',
  'both',
  'none',
]);

function isSetValue(value: unknown, allowed: Set<string>): value is string {
  return isString(value) && allowed.has(value);
}

function isValidSummary(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return requiredSummaryNumberFields.every((field) => isFiniteNumber(value[field]))
    && isFiniteNumberIfPresent(value.newestActivityAt);
}

function isValidRefresh(value: unknown): boolean {
  return isRecord(value)
    && isBoolean(value.requested)
    && isBoolean(value.succeeded)
    && isFiniteNumberIfPresent(value.updatedAt)
    && isStringOrNullIfPresent(value.warning);
}

function isValidFilters(value: unknown): boolean {
  return isRecord(value)
    && isStringIfPresent(value.state)
    && isStringIfPresent(value.role)
    && isStringIfPresent(value.query)
    && isFiniteNumberIfPresent(value.limit);
}

function isValidBotIdentity(value: unknown): boolean {
  return isRecord(value)
    && isString(value.role)
    && isString(value.displayName)
    && isString(value.fallbackLabel)
    && isString(value.initials)
    && isStringIfPresent(value.globalMetaId)
    && isStringIfPresent(value.address)
    && isStringIfPresent(value.avatarUri);
}

function isValidOptionalBotIdentity(value: unknown): boolean {
  return value === undefined || isValidBotIdentity(value);
}

function isValidActorContext(value: unknown): boolean {
  return isRecord(value)
    && isBoolean(value.isRequester)
    && isBoolean(value.isDeveloper)
    && isBoolean(value.needsMyAction)
    && isSetValue(value.role, actorContextRoles);
}

function isValidBounty(value: unknown): boolean {
  return value === undefined
    || (
      isRecord(value)
      && isStringIfPresent(value.amount)
      && isStringIfPresent(value.currency)
    );
}

function isValidRepo(value: unknown): boolean {
  return value === undefined
    || (
      isRecord(value)
      && isStringIfPresent(value.repoUri)
      && isStringIfPresent(value.baseBranch)
    );
}

function isValidWarning(value: unknown): boolean {
  return isRecord(value)
    && isString(value.taskPinId)
    && isString(value.recordPinId)
    && isString(value.protocol)
    && isString(value.code)
    && isString(value.message)
    && isFiniteNumber(value.timestamp);
}

function isValidTaskCard(value: unknown): boolean {
  return isRecord(value)
    && isString(value.taskPinId)
    && isSetValue(value.state, dashboardTaskStates)
    && isSetValue(value.stateTone, dashboardStateTones)
    && isSetValue(value.columnId, dashboardColumnIds)
    && isString(value.title)
    && isValidBotIdentity(value.requester)
    && isValidOptionalBotIdentity(value.developer)
    && isValidBounty(value.bounty)
    && isValidRepo(value.repo)
    && isStringArray(value.tags)
    && isFiniteNumber(value.createdAt)
    && isFiniteNumber(value.updatedAt)
    && isFiniteNumber(value.activeClaimCount)
    && isFiniteNumber(value.warningCount)
    && isValidActorContext(value.actorContext)
    && isStringIfPresent(value.latestStatusSummary)
    && isStringIfPresent(value.prUrl)
    && isStringIfPresent(value.paymentTxId)
    && (value.local === undefined || isValidLocalWorkflow(value.local));
}

function isValidColumn(value: unknown): boolean {
  return isRecord(value)
    && isSetValue(value.id, dashboardColumnIds)
    && isString(value.title)
    && isStringArray(value.states)
    && value.states.every((state) => dashboardTaskStates.has(state))
    && Array.isArray(value.cards)
    && value.cards.every(isValidTaskCard);
}

function isValidTimelineEvent(value: unknown): boolean {
  return isRecord(value)
    && isString(value.id)
    && isString(value.kind)
    && isString(value.taskPinId)
    && isFiniteNumber(value.timestamp)
    && isString(value.title);
}

function isValidClaimSummary(value: unknown): boolean {
  return isRecord(value)
    && isString(value.pinId)
    && isString(value.taskPinId)
    && isFiniteNumber(value.timestamp)
    && isBoolean(value.active)
    && isValidBotIdentity(value.developer);
}

function isValidLocalWorkflow(value: unknown): boolean {
  return isRecord(value)
    && isString(value.claimPinId)
    && isString(value.developerMetaBotSlug)
    && isString(value.branchName)
    && isString(value.workspacePath)
    && isString(value.updatedAt)
    && isStringArray(value.llmSessionIds)
    && isStringArray(value.processLogPaths)
    && isStringArray(value.processLogUris)
    && isRecordArray(value.commits);
}

function isValidRecordsBucket(value: unknown): boolean {
  return isRecord(value)
    && isRecordArray(value.claims)
    && isRecordArray(value.statuses)
    && isRecordArray(value.deliveries)
    && isRecordArray(value.acceptances)
    && isRecordArray(value.claimRejects);
}

function isValidTaskDetail(value: unknown): boolean {
  return isRecord(value)
    && isString(value.taskPinId)
    && isSetValue(value.state, dashboardTaskStates)
    && isSetValue(value.columnId, dashboardColumnIds)
    && isString(value.title)
    && isValidBotIdentity(value.requester)
    && Array.isArray(value.claims)
    && value.claims.every(isValidClaimSummary)
    && Array.isArray(value.warnings)
    && value.warnings.every(isValidWarning)
    && Array.isArray(value.timeline)
    && value.timeline.every(isValidTimelineEvent)
    && Array.isArray(value.localWorkflow)
    && value.localWorkflow.every(isValidLocalWorkflow)
    && isRecord(value.task)
    && isValidRecordsBucket(value.validRecords);
}

function isValidDashboardArrays(state: Partial<LoomDashboardState>): boolean {
  const columns = Array.isArray(state.columns) ? state.columns : [];
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  const details = Array.isArray(state.details) ? state.details : [];
  const warnings = Array.isArray(state.warnings) ? state.warnings : [];

  return columns.every(isValidColumn)
    && tasks.every(isValidTaskCard)
    && details.every(isValidTaskDetail)
    && warnings.every(isValidWarning);
}

function normalizeDashboardState(
  state: Partial<LoomDashboardState>,
): LoomDashboardState | null {
  if (!isRecord(state)) {
    return null;
  }

  if (!isFiniteNumber(state.rawCacheUpdatedAt)
    || !isValidSummary(state.summary)
    || !isValidFilters(state.filters)
    || !isValidRefresh(state.refresh)
    || !isArrayIfPresent(state.columns)
    || !isArrayIfPresent(state.tasks)
    || !isArrayIfPresent(state.details)
    || !isArrayIfPresent(state.warnings)
    || !isValidDashboardArrays(state)) {
    return null;
  }

  const updatedAt = isFiniteNumber(state.updatedAt) ? state.updatedAt : Date.now();

  const normalized = {
    ...state,
    version: 1,
    updatedAt,
    columns: Array.isArray(state.columns) ? state.columns : [],
    tasks: Array.isArray(state.tasks) ? state.tasks : [],
    details: Array.isArray(state.details) ? state.details : [],
    warnings: Array.isArray(state.warnings) ? state.warnings : [],
  } as LoomDashboardState;

  return isSerializable(normalized) ? normalized : null;
}

function normalizeDashboardStateForRead(value: unknown): LoomDashboardState | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.version !== 1 || !isFiniteNumber(value.updatedAt)) {
    return null;
  }

  return normalizeDashboardState(value as Partial<LoomDashboardState>);
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

export function createLoomDashboardStore(homeDirOrPaths: string | MetabotPaths): LoomDashboardStore {
  const indexPath = resolveLoomDashboardIndexPath(homeDirOrPaths);

  return {
    indexPath,
    async read(): Promise<LoomDashboardState | null> {
      let raw: string;
      try {
        raw = await fs.readFile(indexPath, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return null;
        }
        throw error;
      }

      try {
        return normalizeDashboardStateForRead(JSON.parse(raw) as unknown);
      } catch {
        return null;
      }
    },
    async write(state: LoomDashboardState): Promise<LoomDashboardState> {
      const normalized = normalizeDashboardState(state);
      if (!normalized) {
        throw new Error('Cannot write an invalid Loom dashboard index state.');
      }

      await fs.mkdir(path.dirname(indexPath), { recursive: true });
      await writeJsonFileAtomically(indexPath, `${JSON.stringify(normalized, null, 2)}\n`);

      return normalized;
    },
  };
}
