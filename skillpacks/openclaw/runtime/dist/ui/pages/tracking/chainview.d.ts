/**
 * Pure geometry helpers for the tracking page's chain view (UI doc §7.2).
 * Kept importable (node:test, no DOM) so the vm-sandbox page test can unit
 * test the edge path math and the race-front tip selection over a fixture;
 * the page script embeds the same small algorithms.
 */
export interface Rect {
    left: number;
    top: number;
    width: number;
    height: number;
}
/**
 * Cubic bezier path string connecting two card rects along the work-flow
 * direction (from the parent's right edge to the child's left edge), control
 * points at the horizontal midpoint — the mock's edge shape.
 */
export declare function edgePath(from: Rect, to: Rect): string;
export interface TipCandidate {
    pinId: string;
    verified: boolean;
    failed: boolean;
    superseded: boolean;
    parentrefs: Record<string, string> | null;
    passVotes: number;
    atMs: number;
}
/**
 * Race-front tip selection (§4.2): among unverified live candidates, maximize
 * (live ancestor coverage counted in NODES — each parent pin adds 1 — then
 * passVotes, then earliest atMs). Returns null when nothing is racing.
 */
export declare function raceTip(candidates: TipCandidate[]): TipCandidate | null;
