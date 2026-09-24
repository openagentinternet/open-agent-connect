/**
 * /api/user/* routes — the machine-wide human owner identity (the `metabot
 * user *` CLI surface over HTTP, additive next to the Bot-profile
 * /api/identity/* routes). `who` is the read verb (GET); every write is POST,
 * so the local-daemon cross-site boundary guards them exactly like the
 * sibling write routes. All responses are MetabotCommandResult JSON bodies
 * with HTTP 200, matching the schedule route style.
 */
import type { RouteHandler } from './types';
export declare const handleUserRoutes: RouteHandler;
