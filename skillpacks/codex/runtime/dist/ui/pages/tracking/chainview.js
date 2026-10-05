"use strict";
/**
 * Pure geometry helpers for the tracking page's chain view (UI doc §7.2).
 * Kept importable (node:test, no DOM) so the vm-sandbox page test can unit
 * test the edge path math and the race-front tip selection over a fixture;
 * the page script embeds the same small algorithms.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.edgePath = edgePath;
exports.raceTip = raceTip;
/**
 * Cubic bezier path string connecting two card rects along the work-flow
 * direction (from the parent's right edge to the child's left edge), control
 * points at the horizontal midpoint — the mock's edge shape.
 */
function edgePath(from, to) {
    const x1 = from.left + from.width;
    const y1 = from.top + from.height / 2;
    const x2 = to.left;
    const y2 = to.top + to.height / 2;
    const mid = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}
/**
 * Race-front tip selection (§4.2): among unverified live candidates, maximize
 * (live ancestor coverage counted in NODES — each parent pin adds 1 — then
 * passVotes, then earliest atMs). Returns null when nothing is racing.
 */
function raceTip(candidates) {
    const byPin = new Map(candidates.map((cand) => [cand.pinId, cand]));
    const live = candidates.filter((cand) => !cand.failed && !cand.superseded && !cand.verified);
    if (live.length === 0)
        return null;
    const coverage = (cand, seen = new Set()) => {
        let count = 0;
        for (const pin of Object.values(cand.parentrefs ?? {})) {
            if (seen.has(pin))
                continue;
            const parent = byPin.get(pin);
            if (!parent || parent.failed || parent.superseded || parent.verified)
                continue;
            seen.add(pin);
            count += 1 + coverage(parent, seen);
        }
        return count;
    };
    let best = null;
    let bestKey = { coverage: -1, passVotes: -1, atMs: Number.POSITIVE_INFINITY };
    for (const cand of live) {
        const key = { coverage: coverage(cand), passVotes: cand.passVotes, atMs: cand.atMs };
        if (key.coverage > bestKey.coverage
            || (key.coverage === bestKey.coverage && key.passVotes > bestKey.passVotes)
            || (key.coverage === bestKey.coverage && key.passVotes === bestKey.passVotes && key.atMs < bestKey.atMs)) {
            best = cand;
            bestKey = key;
        }
    }
    return best;
}
