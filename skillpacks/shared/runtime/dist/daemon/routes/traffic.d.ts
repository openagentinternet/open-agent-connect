import type { RouteHandler } from './types';
/**
 * Traffic (流量 account-quota gas credit) routes. All owner-scoped: the
 * machine-wide owner identity binds the account, so no actor selection ever
 * applies. Every verb is a POST with a JSON body — the CLI verbs in
 * src/cli/commands/traffic.ts are thin clients over these.
 */
export declare const handleTrafficRoutes: RouteHandler;
