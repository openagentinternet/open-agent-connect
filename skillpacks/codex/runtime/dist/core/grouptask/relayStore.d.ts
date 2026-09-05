/**
 * Source-session relay store: milestone rows the DSH host drains and injects
 * back into the chat that originated the task ("哪里发起哪里结束"). Rows carry
 * the origin DSH session id; rows without one are never emitted. Layout:
 * `.runtime/grouptask/relay.json` under the CHAIR profile's runtime root.
 * The daemon is the only writer; the CLI `grouptask relay drain` verb returns
 * pending rows and marks them drained in one step.
 */
import type { MetabotPaths } from '../state/paths';
import type { GroupTaskRelayKind, GroupTaskRelayRow } from './types';
export interface GroupTaskRelayStateFile {
    seq: number;
    rows: GroupTaskRelayRow[];
}
export interface AddGroupTaskRelayInput {
    taskId: number;
    groupId: string | null;
    sessionId: string;
    kind: GroupTaskRelayKind;
    title: string;
    text: string;
}
export interface GroupTaskRelayStore {
    readonly root: string;
    add(input: AddGroupTaskRelayInput): Promise<GroupTaskRelayRow>;
    listPending(): Promise<GroupTaskRelayRow[]>;
    /** Drain semantics: return the pending rows and mark them drained. */
    drain(): Promise<GroupTaskRelayRow[]>;
}
export declare function resolveGroupTaskRelayPath(paths: MetabotPaths): string;
export declare function createGroupTaskRelayStore(paths: MetabotPaths): GroupTaskRelayStore;
