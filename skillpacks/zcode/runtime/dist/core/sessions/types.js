"use strict";
/**
 * Local session registry types (local session adapters P1).
 *
 * The registry is OAC's directory of LOCAL agent sessions on this machine —
 * Claude Code, Codex, and later other hosts — so remote Bot messages can be
 * routed to a session the user is actually sitting in instead of only ever
 * being answered by OAC's own bot runtime. Design:
 * docs/superpowers/specs/2026-11-11-oac-local-session-adapters-design.md.
 *
 * P1 is presence-only: discovery scans and MCP/hook/claim registrations
 * populate the registry, nothing is delivered yet. Delivery (adapters,
 * routing, mail queue) lands in P2+.
 */
Object.defineProperty(exports, "__esModule", { value: true });
