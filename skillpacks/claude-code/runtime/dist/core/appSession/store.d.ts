/**
 * App Session persistence. Sessions, task-level grants, internal cursors and
 * leases are written atomically to a single JSON file under the profile
 * runtime root; leases carry `expiresAt` so fencing survives daemon restarts.
 */
import { type AppSessionGrant, type AppSessionLease, type AppSessionPersistedState, type AppSessionRecord } from './types';
export interface AppSessionStore {
    load(): Promise<AppSessionPersistedState | null>;
    save(state: AppSessionPersistedState): Promise<void>;
}
export interface AppSessionStateSnapshot {
    sessions: AppSessionRecord[];
    grants: AppSessionGrant[];
    leases: AppSessionLease[];
}
export declare function normalizePersistedAppSessionState(raw: AppSessionPersistedState | null): AppSessionPersistedState;
export declare function createAppSessionStore(runtimeRoot: string): AppSessionStore;
