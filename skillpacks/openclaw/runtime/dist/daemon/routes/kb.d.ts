/**
 * /api/kb/* routes — knowledge-base management plus the nightly study-job
 * surface (enqueue/status/retry, drained by the daemon nightly tick). Thin
 * dispatch onto handlers.kb; every response is a MetabotCommandResult JSON
 * body with HTTP 200, matching the schedule route style. `study/status` is
 * the DSH `metaweb_study_status` equivalent: it lists this bot's study jobs.
 */
import type { RouteHandler } from './types';
export declare const handleKbRoutes: RouteHandler;
