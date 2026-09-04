/**
 * /api/schedule/* routes. Thin dispatch onto handlers.schedule; every
 * response is a MetabotCommandResult JSON body with HTTP 200, matching the
 * grouptask/chat route style. The heartbeat verb is the host lease — it is
 * in-memory only, so the daemon process owns it and it never reaches disk.
 */
import type { RouteHandler } from './types';
export declare const handleScheduleRoutes: RouteHandler;
