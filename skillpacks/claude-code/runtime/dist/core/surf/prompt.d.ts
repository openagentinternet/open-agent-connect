/**
 * The unattended MetaWeb surf session prompt + run-report contract. OAC port
 * of the IDBots surfPrompt.
 *
 * The prompt turns the stage-0 SurfBriefing into one persona-driven overnight
 * session: review the fresh digest, search & learn old content, engage as the
 * bot's own character would (budget-capped, never scripted), handle chain
 * notifications addressed to the bot, then emit one ```json run report. The
 * parser below is tolerant: a malformed report never fails the run — the
 * digest and watermarks are already banked.
 */
import type { MetawebSurfSeenAction } from './store.js';
import type { SurfSessionContext, SurfSessionResult } from './service.js';
/** KB adds cap for one surf run (metaweb-source documents). */
export declare const SURF_KB_ADD_BUDGET = 40;
/** Deep-read guidance rendered into the prompt (soft cap; tools stay honest). */
export declare const SURF_DEEP_READ_GUIDANCE = 40;
export declare function buildSurfSessionPrompt(context: SurfSessionContext): string;
export interface ParsedSurfRunReport extends SurfSessionResult {
    /** Reported per-pin actions for the seen ledger (best-effort, LLM-reported). */
    seenActions: Array<{
        pinId: string;
        action: MetawebSurfSeenAction;
    }>;
    summary: string;
}
/** Longest previous-surf notes carried into the next prompt (prompt-bloat cap). */
export declare const SURF_PREVIOUS_NOTES_MAX_CHARS = 2000;
/**
 * Pull the "notes for next surf" field out of a stored reportJson — the
 * channel that lets one run hand hard-won lessons to the next.
 */
export declare function extractSurfNotesFromReportJson(reportJson: string | null | undefined): string | null;
/**
 * Parse the surf session's final reply. Contract: the last ```json fence
 * carries the report object; bare JSON replies are also accepted. Tolerant by
 * design — any parseable object yields a report, and a total miss returns an
 * empty-but-valid report (the run still completes; see the surf service).
 */
export declare function parseSurfRunReport(replyText: string): ParsedSurfRunReport;
