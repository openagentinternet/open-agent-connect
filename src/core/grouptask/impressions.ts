/**
 * Chair→collaborator impression sedimentation (IDBots
 * openTeamImpressionService parity, scoped to close/kick outcomes):
 * deterministic collaboration facts recorded into the CHAIR profile's
 * impression ledger on task close and member kick. Future staffing searches
 * read them back as boost/demote/block verdicts — the memory that keeps a
 * kicked seat from being re-staffed blindly.
 */

import { createImpressionStore } from '../memory/impressionStore';
import { resolveMetabotPaths } from '../state/paths';
import { requireProfile, staffingStoreFor, type GroupTaskServiceContext } from './service';
import type { GroupTaskMember, GroupTaskRecord } from './types';

/** Staffing seat role per member slug, from the proposal that created the task. */
async function seatRoleBySlug(
  ctx: GroupTaskServiceContext,
  chairSlug: string,
  taskId: number,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const chair = await requireProfile(ctx, chairSlug);
    const proposals = await staffingStoreFor(ctx, chair).listProposals();
    const proposal = proposals.find((row) => row.createdTaskId === taskId);
    for (const seat of proposal?.plan.seats ?? []) {
      if (seat.source === 'local' && seat.candidateSlug) {
        map.set(seat.candidateSlug, seat.role === 'domain'
          ? `domain:${seat.domainLabel ?? 'unspecified'}`
          : seat.role);
      }
    }
  } catch {
    // Direct-created tasks have no proposal; members sediment without a seat role.
  }
  return map;
}

function logOf(ctx: GroupTaskServiceContext): (message: string) => void {
  return ctx.log ?? (() => undefined);
}

function normalizeGmid(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/** Record one chair→member fact; best-effort, never blocks the caller. */
async function recordFact(
  ctx: GroupTaskServiceContext,
  chairHomeDir: string,
  chairGmid: string,
  input: {
    subjectGlobalMetaId: string;
    task: Pick<GroupTaskRecord, 'id' | 'title'>;
    outcome: string;
    seatRole?: string;
    evidencePinIds?: string[];
  },
): Promise<void> {
  try {
    const store = createImpressionStore(resolveMetabotPaths(chairHomeDir));
    const fact = await store.appendCollaborationFact({
      observerGlobalMetaId: chairGmid,
      subjectGlobalMetaId: input.subjectGlobalMetaId,
      taskId: input.task.id,
      title: input.task.title,
      outcome: input.outcome,
      ...(input.seatRole ? { seatRole: input.seatRole } : {}),
      evidencePinIds: input.evidencePinIds ?? [],
    });
    await store.rebuildSnapshot(chairGmid, input.subjectGlobalMetaId).catch(() => undefined);
    logOf(ctx)(`[GroupTask] Impression fact ${fact.id} recorded: ${input.outcome} on "${input.task.title}"`);
  } catch (error) {
    logOf(ctx)(
      `[GroupTask] Failed to record impression fact (${input.outcome}, task ${input.task.id}): `
      + `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Task close: every still-seated member gets a done/cancelled fact. */
export async function recordTaskCloseImpressions(
  ctx: GroupTaskServiceContext,
  chairSlug: string,
  task: Pick<GroupTaskRecord, 'id' | 'title'>,
  members: GroupTaskMember[],
  outcome: 'done' | 'cancelled',
): Promise<void> {
  const chair = await requireProfile(ctx, chairSlug);
  const chairGmid = normalizeGmid(chair.globalMetaId);
  if (!chairGmid) return;
  const seatRoles = await seatRoleBySlug(ctx, chairSlug, task.id);
  for (const member of members) {
    const subject = normalizeGmid(member.globalMetaId);
    if (!subject || subject === chairGmid) continue;
    if (member.removedAt != null) continue; // kicked members sedimented at kick time
    const seatRole = member.slug ? seatRoles.get(member.slug) : undefined;
    await recordFact(ctx, chair.homeDir, chairGmid, {
      subjectGlobalMetaId: subject,
      task,
      outcome,
      ...(seatRole ? { seatRole } : {}),
    });
  }
}

/** Kick: the removed member gets a kicked fact immediately. */
export async function recordKickImpression(
  ctx: GroupTaskServiceContext,
  chairSlug: string,
  task: Pick<GroupTaskRecord, 'id' | 'title'>,
  member: Pick<GroupTaskMember, 'globalMetaId' | 'role'>,
): Promise<void> {
  const chair = await requireProfile(ctx, chairSlug);
  const chairGmid = normalizeGmid(chair.globalMetaId);
  const subject = normalizeGmid(member.globalMetaId);
  if (!chairGmid || !subject || subject === chairGmid) return;
  await recordFact(ctx, chair.homeDir, chairGmid, {
    subjectGlobalMetaId: subject,
    task,
    outcome: 'kicked',
    ...(member.role === 'worker' ? { seatRole: 'worker' } : {}),
  });
}
