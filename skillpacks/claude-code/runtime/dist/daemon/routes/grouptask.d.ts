/**
 * /api/grouptask/* routes. Thin dispatch onto handlers.grouptask; every
 * response is a MetabotCommandResult JSON body with HTTP 200 (the result
 * envelope carries success/failure), matching the chat/buzz route style.
 */
import type { RouteHandler } from './types';
export declare const handleGroupTaskRoutes: RouteHandler;
