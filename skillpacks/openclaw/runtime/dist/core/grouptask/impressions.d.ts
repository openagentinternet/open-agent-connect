/**
 * Chair→collaborator impression sedimentation (IDBots
 * openTeamImpressionService parity, scoped to close/kick outcomes):
 * deterministic collaboration facts recorded into the CHAIR profile's
 * impression ledger on task close and member kick. Future staffing searches
 * read them back as boost/demote/block verdicts — the memory that keeps a
 * kicked seat from being re-staffed blindly.
 */
import { type GroupTaskServiceContext } from './service';
import type { GroupTaskMember, GroupTaskRecord } from './types';
/** Task close: every still-seated member gets a done/cancelled fact. */
export declare function recordTaskCloseImpressions(ctx: GroupTaskServiceContext, chairSlug: string, task: Pick<GroupTaskRecord, 'id' | 'title'>, members: GroupTaskMember[], outcome: 'done' | 'cancelled'): Promise<void>;
/** Kick: the removed member gets a kicked fact immediately. The seat role
 *  comes from the staffing proposal so the search-side block branch (a kicked
 *  member on the same seat) stays reachable; without a proposal the fact is
 *  recorded unseated and only the generic demote applies. */
export declare function recordKickImpression(ctx: GroupTaskServiceContext, chairSlug: string, task: Pick<GroupTaskRecord, 'id' | 'title'>, member: Pick<GroupTaskMember, 'globalMetaId' | 'role' | 'slug'>): Promise<void>;
