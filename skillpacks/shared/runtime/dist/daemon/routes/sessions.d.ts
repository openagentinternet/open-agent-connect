/**
 * /api/sessions/* routes — the local session directory and mail queue
 * (`metabot sessions *` CLI + `metabot mcp` server over HTTP, local session
 * adapters P1/P2a). `list` is a GET that also refreshes machine-local
 * presence from the passive discovery scans; register/inbox/message verbs
 * are POSTs (all localhost-only like the rest of the daemon). All responses
 * are MetabotCommandResult JSON bodies with HTTP 200.
 */
import type { RouteHandler } from './types';
export declare const handleSessionsRoutes: RouteHandler;
