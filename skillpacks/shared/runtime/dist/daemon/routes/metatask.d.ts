/**
 * /api/metatask/* routes. Thin dispatch onto handlers.metatask; every response
 * is a MetabotCommandResult JSON body with HTTP 200 (the result envelope
 * carries success/failure), matching the grouptask route style. The board and
 * task shapes are the shared data contract for both UIs (DSH plugin panel +
 * src/ui tracking page) and the CLI read verbs.
 */
import type { RouteHandler } from './types';
export declare const handleMetaTaskRoutes: RouteHandler;
