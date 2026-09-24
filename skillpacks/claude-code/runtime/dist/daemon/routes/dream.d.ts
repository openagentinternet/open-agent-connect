/**
 * /api/dream/* routes. Thin dispatch onto handlers.dream; every response is a
 * MetabotCommandResult JSON body with HTTP 200, matching the schedule route
 * style. Reads are GET (query string), the manual run is POST (JSON body).
 */
import type { RouteHandler } from './types';
export declare const handleDreamRoutes: RouteHandler;
