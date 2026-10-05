/**
 * MetaTask watch service (P7 — OAC port of the IDBots watchService): the
 * daemon tick's local, cheap checks over the refreshed projections — never a
 * chain read on its own:
 *
 *  - my-claim TTL expiring soon (holder is a local bot, no submission yet)
 *  - status changes on nodes a local bot holds or submitted
 *  - publisher closing-drive: a task I publish whose aggregation nodes sit
 *    open with no activity for a day (the pilot #02 stall pattern)
 *
 * Alerts decay after 48h; one-shot notices are deduped per kind+node (the
 * closing-drive dedupe key regression is pinned by a ported test). In-app
 * surfacing only — both UIs read them from the board payload.
 */
import type { MetaTaskAlert } from './engine/types';
import type { MetaTaskStore } from './store';
export interface MetaTaskWatchDeps {
    store: () => MetaTaskStore;
    rosterMetaIds: () => Promise<string[]> | string[];
    /** Push hook fired when new alerts landed. */
    onAlerts?: (alerts: MetaTaskAlert[]) => void;
}
export declare class MetaTaskWatchService {
    private readonly deps;
    constructor(deps: MetaTaskWatchDeps);
    run(nowMs: number): Promise<void>;
}
