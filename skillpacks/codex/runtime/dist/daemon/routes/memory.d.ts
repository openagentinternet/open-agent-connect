/**
 * /api/memory/* routes — the standalone memory-UI surface. Thin dispatch
 * onto handlers.memory; every response is a MetabotCommandResult JSON body
 * with HTTP 200, matching the schedule route style. GET verbs carry their
 * input in the query string; POST verbs take a JSON body where `from` selects
 * the bot and every other field is the entry payload (same shape the CLI
 * verbs read from --payload-file).
 */
import type { RouteHandler } from './types';
export declare const handleMemoryRoutes: RouteHandler;
