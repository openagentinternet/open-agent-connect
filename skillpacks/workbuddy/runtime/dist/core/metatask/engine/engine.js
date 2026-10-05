"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.taskDirtyKey = exports.PROJECTION_FORMAT_VERSION = void 0;
exports.taskEventSet = taskEventSet;
exports.replayMetaTask = replayMetaTask;
const constants_1 = require("./constants");
const canon_1 = require("./canon");
const BIG = 10 ** 12;
const asNum = (value, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const asStr = (value, fallback = '') => typeof value === 'string' ? value : fallback;
const truthyStr = (value) => typeof value === 'string' && value.trim().length > 0;
const orderKey = (event) => [
    event.height >= 0 ? event.height : BIG,
    asNum(event.txIndex),
    asNum(event.timestampMs),
    event.pinId,
];
const compareByOrderKey = (a, b) => {
    const ka = orderKey(a);
    const kb = orderKey(b);
    for (let i = 0; i < 4; i += 1) {
        if (ka[i] !== kb[i])
            return ka[i] < kb[i] ? -1 : 1;
    }
    return 0;
};
/**
 * Settlement weight table (shared by both modes): the effective tree's integer
 * weights when every node carries 1..10000 summing to exactly 10000, else the
 * legacy uniform floor(10000/N) fallback with the residue deliberately
 * discarded (rev-2 ruling: never to the root).
 */
const resolveNodeWeights = (effectiveTree) => {
    const weights = new Map();
    const nodeCount = effectiveTree.size;
    let weightsValid = nodeCount > 0;
    let totalWeight = 0;
    if (weightsValid) {
        for (const node of effectiveTree.values()) {
            const w = node.weight;
            if (typeof w !== 'number' || !Number.isInteger(w) || w < 1 || w > 10000) {
                weightsValid = false;
                break;
            }
            weights.set(node.id, w);
            totalWeight += w;
        }
        if (totalWeight !== 10000)
            weightsValid = false;
    }
    if (!weightsValid) {
        weights.clear();
        const uniform = nodeCount > 0 ? Math.floor(10000 / nodeCount) : 0;
        for (const id of effectiveTree.keys())
            weights.set(id, uniform);
    }
    return weights;
};
/** Laplace-smoothed reviewer accuracy a(r), clamped to the protocol floor. */
const reviewerAccuracy = (participants) => {
    const accuracy = new Map();
    for (const stats of participants.values()) {
        const smoothed = Math.floor((10000 * (stats.reviewCorrect + 1)) / (stats.reviewTerminal + 2));
        accuracy.set(stats.metaId, Math.min(10000, Math.max(constants_1.REVIEWER_ACCURACY_FLOOR_BP, smoothed)));
    }
    return accuracy;
};
const ensureShareParts = (parts, metaId) => {
    let entry = parts.get(metaId);
    if (!entry) {
        entry = { submittedBP: 0, reviewedBP: 0 };
        parts.set(metaId, entry);
    }
    return entry;
};
/** #8/#9 vote validity gates: apply only to events at/after hAct (engine ruling, H_ACT=190000). */
const voteInvalidReason = (body, height, hAct) => {
    if (height < hAct)
        return null; // v1.1 semantics below the switch point
    if (!truthyStr(body.semantic_check))
        return 'missing_semantic_check';
    if (body.verdict === 'fail' && !truthyStr(body.failreason))
        return 'missing_failreason';
    return null;
};
const sameSide = (rosterGroups, a, b) => {
    if (!a || !b)
        return false;
    if (a === b)
        return true;
    return rosterGroups.some((group) => group.includes(a) && group.includes(b));
};
const rosterGroupsFor = (rosterBody) => {
    if (!rosterBody || typeof rosterBody !== 'object')
        return [];
    const record = rosterBody;
    const raw = Array.isArray(record.groups)
        ? record.groups
        : Array.isArray(rosterBody)
            ? rosterBody
            : [];
    return raw
        .filter((group) => Array.isArray(group))
        .map((group) => group.filter((id) => typeof id === 'string'));
};
const isAcyclic = (nodes) => {
    for (const startId of nodes.keys()) {
        const seen = new Set();
        let cursor = startId;
        while (cursor) {
            if (seen.has(cursor))
                return false;
            seen.add(cursor);
            cursor = nodes.get(cursor)?.parent ?? null;
        }
    }
    return true;
};
const sumWeights = (nodes) => {
    let total = 0;
    for (const node of nodes.values()) {
        const w = node.weight;
        if (typeof w !== 'number' || !Number.isInteger(w) || w < 1 || w > 10000)
            return -1;
        total += w;
    }
    return total;
};
/**
 * Fold amends (v1.2, H_ACT2-gated). Publisher authority, bases version chain
 * with earliest-wins conflicts, frozen-on-start nodes, and the four fold
 * invariants. Any failure ignores the WHOLE amend (recorded).
 */
const foldAmends = (input) => {
    const ignored = [];
    const nodes = new Map(input.initialNodes);
    const takenBases = new Set();
    let head = input.treePinId;
    /** Frozen-on-start: the node's first effective claim landed BEFORE this amend. */
    const frozenAt = (nodeId, amendKey) => {
        const claimKey = input.firstClaimOrder.get(nodeId);
        if (!claimKey)
            return false;
        for (let i = 0; i < 4; i += 1) {
            if (claimKey[i] !== amendKey[i])
                return claimKey[i] < amendKey[i];
        }
        return false;
    };
    for (const amend of input.amends) {
        const amendKey = orderKey(amend);
        const body = amend.body;
        if (amend.height < input.hAct2) {
            ignored.push({ pinId: amend.pinId, reason: 'below_h_act2' });
            continue;
        }
        if (amend.author !== input.rootAuthor) {
            ignored.push({ pinId: amend.pinId, reason: 'amend_not_publisher' });
            continue;
        }
        if (input.rootVerified) {
            ignored.push({ pinId: amend.pinId, reason: 'amend_task_finalized' });
            continue;
        }
        if (asStr(body.bases) !== head) {
            ignored.push({
                pinId: amend.pinId,
                reason: takenBases.has(asStr(body.bases)) ? 'amend_conflict' : 'amend_stale',
            });
            continue;
        }
        takenBases.add(asStr(body.bases));
        // Apply ops to a scratch copy; commit only if every invariant holds.
        const scratch = new Map(Array.from(nodes, ([id, node]) => [id, { ...node }]));
        let ok = true;
        const ops = Array.isArray(body.ops) ? body.ops : [];
        for (const rawOp of ops) {
            if (!rawOp || typeof rawOp !== 'object') {
                ok = false;
                break;
            }
            const op = rawOp;
            const kind = asStr(op.op);
            const targetId = asStr(op.node);
            if (kind === 'add_node') {
                const raw = (op.newNode ?? op.node);
                const id = asStr(raw?.id);
                const parent = asStr(raw?.parent);
                if (!raw || !id || nodes.has(id) || scratch.has(id)) {
                    ok = false;
                    break;
                }
                const parentNode = scratch.get(parent) ?? nodes.get(parent);
                if (!parentNode || input.verifiedNodeIds.has(parent) || input.activeCycleNodeIds.has(parent)) {
                    ok = false;
                    break;
                }
                const w = raw.weight;
                scratch.set(id, {
                    id,
                    parent,
                    title: asStr(raw.title),
                    kind: asStr(raw.kind, 'proof'),
                    specid: typeof raw.specid === 'string' ? raw.specid : null,
                    params: (raw.params && typeof raw.params === 'object' ? raw.params : {}),
                    deps: Array.isArray(raw.deps) ? raw.deps.filter((d) => typeof d === 'string') : [],
                    weight: typeof w === 'number' ? w : undefined,
                });
            }
            else if (kind === 'remove_node') {
                const target = scratch.get(targetId);
                if (!target || target.parent === null) {
                    ok = false;
                    break;
                }
                const stack = [targetId];
                while (stack.length && ok) {
                    const current = stack.pop();
                    if (frozenAt(current, amendKey)) {
                        ok = false;
                        break;
                    }
                    for (const [id, node] of scratch) {
                        if (node.parent === current)
                            stack.push(id);
                    }
                }
                if (!ok)
                    break;
                scratch.delete(targetId);
            }
            else if (kind === 'reweight') {
                const target = scratch.get(targetId);
                const w = op.weight;
                if (!target ||
                    frozenAt(targetId, amendKey) ||
                    typeof w !== 'number' ||
                    !Number.isInteger(w) ||
                    w < 1 ||
                    w > 10000) {
                    ok = false;
                    break;
                }
                target.weight = w;
            }
            else if (kind === 'retitle') {
                const target = scratch.get(targetId);
                if (!target || frozenAt(targetId, amendKey) || !truthyStr(op.title)) {
                    ok = false;
                    break;
                }
                target.title = asStr(op.title);
            }
            else if (kind === 'respec') {
                const target = scratch.get(targetId);
                if (!target || frozenAt(targetId, amendKey) || !truthyStr(op.specid)) {
                    ok = false;
                    break;
                }
                target.specid = asStr(op.specid);
            }
            else {
                ok = false;
                break;
            }
        }
        if (!ok || sumWeights(scratch) !== 10000 || !isAcyclic(scratch)) {
            ignored.push({ pinId: amend.pinId, reason: 'amend_invariant_violation' });
            continue;
        }
        nodes.clear();
        for (const [id, node] of scratch)
            nodes.set(id, node);
        head = amend.pinId;
    }
    return { nodes, ignored, head };
};
const compDepsOf = (tree, nodeId) => {
    const node = tree.get(nodeId);
    return node && Array.isArray(node.deps)
        ? node.deps.filter((dep) => typeof dep === 'string')
        : [];
};
/** Nodes no other node lists in `deps` (the draft §3.1 sink definition). */
const compSinkNodeIds = (tree) => {
    const referenced = new Set();
    for (const node of tree.values()) {
        for (const dep of compDepsOf(tree, node.id))
            referenced.add(dep);
    }
    return Array.from(tree.keys()).filter((id) => !referenced.has(id));
};
const compDepsRefsValid = (tree) => {
    for (const id of tree.keys()) {
        for (const dep of compDepsOf(tree, id)) {
            if (!tree.has(dep))
                return false;
        }
    }
    return true;
};
const compDepsAcyclic = (tree) => {
    const state = new Map(); // 1 = on the DFS stack, 2 = done
    const visit = (id) => {
        const mark = state.get(id);
        if (mark === 2)
            return true;
        if (mark === 1)
            return false;
        state.set(id, 1);
        for (const dep of compDepsOf(tree, id)) {
            if (!tree.has(dep))
                continue; // dangling refs are ruled by compDepsRefsValid
            if (!visit(dep))
                return false;
        }
        state.set(id, 2);
        return true;
    };
    for (const id of tree.keys()) {
        if (!visit(id))
            return false;
    }
    return true;
};
/**
 * Terminal node resolution (draft §3.1/§3.6): `policy.finalnode` wins when it
 * names a live node; when absent/invalid, fall back to the UNIQUE deps-sink;
 * a multi-sink task without a valid finalnode never completes (the draft
 * rejects such tasks at publish; replay stays deterministic on them).
 */
const compFinalNode = (tree, finalnode) => {
    if (finalnode && tree.has(finalnode))
        return finalnode;
    const sinks = compSinkNodeIds(tree);
    return sinks.length === 1 ? sinks[0] : null;
};
/**
 * Structural parentrefs validation (draft §3.3) against a tree snapshot:
 * exactly one existing same-task submission pin per deps entry, sitting on
 * that dep node; entry nodes must omit parentrefs (an empty object carries no
 * references and counts as omitted). A referenced parent need NOT be verified
 * or even valid itself — optimistic pipelining — that is what chain-validity
 * (not admission) is for. The draft does not require the parent to predate
 * the child, so no ordering check is applied here.
 */
const compParentrefsValid = (sub, tree, submissionByPin) => {
    if (!tree.has(sub.node))
        return false;
    const deps = compDepsOf(tree, sub.node);
    if (deps.length === 0)
        return sub.parentrefs === null || Object.keys(sub.parentrefs).length === 0;
    const refs = sub.parentrefs;
    if (!refs)
        return false;
    const keys = Object.keys(refs);
    if (keys.length !== deps.length)
        return false;
    for (const dep of deps) {
        const ref = refs[dep];
        if (typeof ref !== 'string' || ref.length === 0)
            return false;
        const target = submissionByPin.get(ref);
        if (!target || target.node !== dep)
            return false;
    }
    return true;
};
/**
 * Chain-validity oracle over a tree snapshot (draft §3.1): a submission is
 * chain-valid iff it is verified AND every parentref is recursively
 * chain-valid. Evaluated over boundary-final vote state; superseded
 * submissions are never chain-valid, which is what makes a superseded
 * submission's descendants chain-invalid (§3.4). The in-progress marker keeps
 * malformed dep cycles (publish-forbidden) deterministic instead of recursing
 * forever. Memos make each oracle O(submissions + deps edges) per snapshot.
 */
const makeCompOracle = (tree, submissions, submissionByPin, finalnode) => {
    const byNode = new Map();
    for (const sub of submissions) {
        const list = byNode.get(sub.node) ?? [];
        list.push(sub);
        byNode.set(sub.node, list);
    }
    const validMemo = new Map();
    const structurallyValid = (sub) => {
        let value = validMemo.get(sub.pinId);
        if (value === undefined) {
            value = compParentrefsValid(sub, tree, submissionByPin);
            validMemo.set(sub.pinId, value);
        }
        return value;
    };
    const chainMemo = new Map();
    const chainValid = (sub) => {
        const memoized = chainMemo.get(sub.pinId);
        if (memoized !== undefined)
            return memoized;
        chainMemo.set(sub.pinId, false); // cycle guard
        let result = false;
        if (structurallyValid(sub) && sub.verified && !sub.superseded) {
            result = compDepsOf(tree, sub.node).every((dep) => {
                const target = submissionByPin.get(asStr(sub.parentrefs?.[dep]));
                return Boolean(target) && chainValid(target);
            });
        }
        chainMemo.set(sub.pinId, result);
        return result;
    };
    const satisfied = (nodeId, asOfKey) => (byNode.get(nodeId) ?? []).some((sub) => {
        if (!chainValid(sub))
            return false;
        if (!asOfKey)
            return true;
        const verifiedAt = sub.verifiedVote
            ? [
                sub.verifiedVote.height >= 0 ? sub.verifiedVote.height : BIG,
                sub.verifiedVote.txIndex,
                sub.verifiedVote.timestampMs,
                sub.verifiedVote.pinId,
            ]
            : [BIG, 0, 0, ''];
        for (let i = 0; i < 4; i += 1) {
            if (verifiedAt[i] !== asOfKey[i])
                return verifiedAt[i] < asOfKey[i];
        }
        return false; // same order key: not strictly before
    });
    return {
        satisfied,
        chainValid,
        structurallyValid,
        finalNode: compFinalNode(tree, finalnode),
    };
};
/**
 * Amend fold for competitive mode (draft §3.9). Publisher authority, the bases
 * version chain (earliest-wins conflicts) and the tree-mode fold invariants
 * (Σweight=10000, parent-acyclic) are unchanged. The freeze condition becomes
 * "the node has ≥1 chain-valid verified submission": satisfaction is evaluated
 * POINT-IN-TIME (the candidate's verified time must lie strictly before the
 * amend's order key — the "frozen once it has" reading), while chain-validity
 * itself is boundary-evaluated (§3.1; the same hindsight component tree mode's
 * verifiedNodeIds fold gate already carries — a later ancestor kill can
 * retroactively un-freeze, deterministic per event set). Two deps-aware rules
 * are added: remove_node is rejected when any other node lists the target in
 * deps, and add_node may introduce deps edges only onto unfrozen existing
 * nodes. Every applied amend must additionally preserve deps-referential
 * integrity, deps-acyclicity and the PINNED TERMINAL structure (draft §3.9):
 * the resolved terminal node (policy.finalnode when it names a live node,
 * else the unique sink, §3.1) must be the SAME live node before and after the
 * fold and must still be a deps sink. An add_node growing a new layer ABOVE
 * the finalnode (deps onto the finalnode) moves the sink off it and is
 * rejected — terminal upward extension, including finalnode reassignment, is
 * deferred to the multi-sink extension (§9 Q1); a middle-layer or isolated
 * side-branch add_node keeps the sink/terminal at finalnode and applies.
 * Any failure ignores the WHOLE amend (recorded), exactly as in tree mode.
 */
const foldCompetitiveAmends = (input) => {
    const ignored = [];
    const nodes = new Map(input.initialNodes);
    const takenBases = new Set();
    let head = input.treePinId;
    for (const amend of input.amends) {
        const amendKey = orderKey(amend);
        const body = amend.body;
        if (amend.height < input.hAct2) {
            ignored.push({ pinId: amend.pinId, reason: 'below_h_act2' });
            continue;
        }
        if (amend.author !== input.rootAuthor) {
            ignored.push({ pinId: amend.pinId, reason: 'amend_not_publisher' });
            continue;
        }
        const committedOracle = makeCompOracle(nodes, input.submissions, input.submissionByPin, input.finalnode);
        if (committedOracle.finalNode !== null &&
            committedOracle.satisfied(committedOracle.finalNode, amendKey)) {
            ignored.push({ pinId: amend.pinId, reason: 'amend_task_finalized' });
            continue;
        }
        if (asStr(body.bases) !== head) {
            ignored.push({
                pinId: amend.pinId,
                reason: takenBases.has(asStr(body.bases)) ? 'amend_conflict' : 'amend_stale',
            });
            continue;
        }
        takenBases.add(asStr(body.bases));
        // Apply ops to a scratch copy; commit only if every invariant holds.
        const scratch = new Map(Array.from(nodes, ([id, node]) => [id, { ...node }]));
        let ok = true;
        const ops = Array.isArray(body.ops) ? body.ops : [];
        for (const rawOp of ops) {
            if (!rawOp || typeof rawOp !== 'object') {
                ok = false;
                break;
            }
            const op = rawOp;
            const kind = asStr(op.op);
            const targetId = asStr(op.node);
            // Freeze oracle over the CURRENT scratch (earlier ops of this amend included).
            const oracle = makeCompOracle(scratch, input.submissions, input.submissionByPin, input.finalnode);
            if (kind === 'add_node') {
                const raw = (op.newNode ?? op.node);
                const id = asStr(raw?.id);
                const parent = asStr(raw?.parent);
                if (!raw || !id || nodes.has(id) || scratch.has(id)) {
                    ok = false;
                    break;
                }
                const parentNode = scratch.get(parent);
                if (!parentNode || oracle.satisfied(parent, amendKey)) {
                    ok = false;
                    break;
                }
                const newDeps = Array.isArray(raw.deps)
                    ? raw.deps.filter((d) => typeof d === 'string')
                    : [];
                // New deps edges may only land on unfrozen existing nodes (§3.9).
                let depsOk = true;
                for (const dep of newDeps) {
                    if (!scratch.has(dep) || oracle.satisfied(dep, amendKey)) {
                        depsOk = false;
                        break;
                    }
                }
                if (!depsOk) {
                    ok = false;
                    break;
                }
                const w = raw.weight;
                scratch.set(id, {
                    id,
                    parent,
                    title: asStr(raw.title),
                    kind: asStr(raw.kind, 'proof'),
                    specid: typeof raw.specid === 'string' ? raw.specid : null,
                    params: (raw.params && typeof raw.params === 'object' ? raw.params : {}),
                    deps: newDeps,
                    weight: typeof w === 'number' ? w : undefined,
                });
            }
            else if (kind === 'remove_node') {
                const target = scratch.get(targetId);
                if (!target || target.parent === null) {
                    ok = false;
                    break;
                }
                const stack = [targetId];
                while (stack.length && ok) {
                    const current = stack.pop();
                    if (oracle.satisfied(current, amendKey)) {
                        ok = false;
                        break;
                    }
                    for (const [id, node] of scratch) {
                        if (node.parent === current)
                            stack.push(id);
                    }
                }
                if (!ok)
                    break;
                // Competitive rule (§3.9): rejected when any other node lists the
                // target in deps (the depsRefsValid invariant below is the backstop).
                let referenced = false;
                for (const [id, node] of scratch) {
                    if (id === targetId)
                        continue;
                    if (compDepsOf(scratch, id).includes(targetId)) {
                        referenced = true;
                        break;
                    }
                }
                if (referenced) {
                    ok = false;
                    break;
                }
                scratch.delete(targetId);
            }
            else if (kind === 'reweight') {
                const target = scratch.get(targetId);
                const w = op.weight;
                if (!target ||
                    oracle.satisfied(targetId, amendKey) ||
                    typeof w !== 'number' ||
                    !Number.isInteger(w) ||
                    w < 1 ||
                    w > 10000) {
                    ok = false;
                    break;
                }
                target.weight = w;
            }
            else if (kind === 'retitle') {
                const target = scratch.get(targetId);
                if (!target || oracle.satisfied(targetId, amendKey) || !truthyStr(op.title)) {
                    ok = false;
                    break;
                }
                target.title = asStr(op.title);
            }
            else if (kind === 'respec') {
                const target = scratch.get(targetId);
                if (!target || oracle.satisfied(targetId, amendKey) || !truthyStr(op.specid)) {
                    ok = false;
                    break;
                }
                target.specid = asStr(op.specid);
            }
            else {
                ok = false;
                break;
            }
        }
        // Terminal pinning (draft §3.9): the resolved terminal must be the same
        // live node before and after the fold and must still be a deps sink.
        // Growing a new layer above the finalnode (a new node whose deps include
        // it) would move the sink off finalnode — rejected; middle-layer /
        // side-branch additions leave finalnode a sink and pass.
        const terminalBefore = compFinalNode(nodes, input.finalnode);
        const terminalAfter = compFinalNode(scratch, input.finalnode);
        const terminalPinned = terminalBefore !== null &&
            terminalAfter !== null &&
            terminalAfter === terminalBefore &&
            compSinkNodeIds(scratch).includes(terminalAfter);
        if (!ok ||
            sumWeights(scratch) !== 10000 ||
            !isAcyclic(scratch) ||
            !compDepsRefsValid(scratch) ||
            !compDepsAcyclic(scratch) ||
            !terminalPinned) {
            ignored.push({ pinId: amend.pinId, reason: 'amend_invariant_violation' });
            continue;
        }
        nodes.clear();
        for (const [id, node] of scratch)
            nodes.set(id, node);
        head = amend.pinId;
    }
    return { nodes, ignored, head };
};
/**
 * Competitive-mode replay (v1.3 draft §3): no claim locks, competing candidate
 * submissions per node, deps enforced via parentrefs, chain-validity recursion,
 * first fully-verified chain to the terminal node wins, winner-chain-only
 * settlement. Vote semantics (#8/#9 gates, last-valid-vote, identity and
 * same-side roster filters) are the shared pre-pass — unchanged from v1.2.1.
 */
const replayCompetitiveTask = (ctx) => {
    const { taskSet } = ctx;
    const rootPin = taskSet.rootPin;
    const rootAuthor = taskSet.rootAuthor;
    const taskBody = taskSet.taskBody;
    const policy = ctx.policy;
    const quorum = ctx.quorum;
    const now = ctx.now;
    const ignoredEvents = ctx.ignoredEvents;
    const finalnode = asStr(policy.finalnode);
    // -- walk: submissions + acting votes (claims/releases are intent only) -----
    // Claims never gate, never expire and never gate submissions (§3.2), so the
    // walk does not read them; they remain eventSetHash members via taskEventSet.
    const submissionByPin = new Map();
    const compSubs = [];
    /** Latest non-superseded submission per (node, author) — the supersede tip. */
    const tipByNodeAuthor = new Map();
    const actingVotes = (ctx.byPath.get('verify') ?? []).filter((pin) => ctx.lastVoteByPin.has(pin.pinId));
    const timeline = [...taskSet.submissions, ...actingVotes].sort(compareByOrderKey);
    for (const pin of timeline) {
        if (pin.path === 'submission') {
            const node = asStr(pin.body.node);
            if (!node)
                continue; // malformed: parity with tree mode's silent skip
            const rawRefs = pin.body.parentrefs;
            const sub = {
                pinId: pin.pinId,
                node,
                author: pin.author,
                atMs: asNum(pin.timestampMs),
                height: pin.height,
                txIndex: asNum(pin.txIndex),
                parentrefs: rawRefs && typeof rawRefs === 'object' && !Array.isArray(rawRefs)
                    ? rawRefs
                    : null,
                supersedeid: typeof pin.body.supersedeid === 'string' && pin.body.supersedeid ? pin.body.supersedeid : null,
                passVoters: new Map(),
                failed: false,
                verified: false,
                verifiedVote: null,
                superseded: false,
            };
            if (!sub.supersedeid) {
                // Unbounded competition (§3.4): no claim, no duplicate rejection.
                submissionByPin.set(sub.pinId, sub);
                compSubs.push(sub);
                tipByNodeAuthor.set(`${node} ${sub.author}`, sub);
                continue;
            }
            // Supersede = author self-replacement, same six predicates as v1.2.1
            // (§3.4): the target exists among the author's own submissions on the
            // SAME node, it is that author's current tip there, it is not the new
            // pin itself, it is not already superseded, it has not reached quorum at
            // this point of the walk, and both pins sit at/after H_ACT2.
            const tip = tipByNodeAuthor.get(`${node} ${sub.author}`);
            const target = tip && tip.pinId === sub.supersedeid ? tip : null;
            if (target &&
                target.pinId !== sub.pinId &&
                !target.superseded &&
                !target.verified &&
                pin.height >= ctx.hAct2 &&
                target.height >= ctx.hAct2) {
                target.superseded = true;
                submissionByPin.set(sub.pinId, sub);
                compSubs.push(sub);
                tipByNodeAuthor.set(`${node} ${sub.author}`, sub);
            }
            else {
                ignoredEvents.push({ pinId: pin.pinId, reason: 'supersede_predicate_failed' });
            }
            continue;
        }
        // verify: only last-valid votes act (pre-pass already applied #8/#9 + roster).
        const vote = ctx.lastVoteByPin.get(pin.pinId);
        if (!vote)
            continue;
        const target = submissionByPin.get(asStr(vote.body.targetid));
        if (!target)
            continue; // unknown or supersede-rejected target: never state
        if (vote.body.verdict === 'fail') {
            // A counted fail verdict kills only its target submission (§3.4). As in
            // tree mode (ruling three) the kill is NOT identity-filtered; it is
            // terminal — later passes never revive the submission (§3.1: only the
            // ancestor POSITION can be re-verified, by a new submission).
            target.failed = true;
            target.verified = false;
            continue;
        }
        if (vote.body.verdict === 'pass') {
            if (vote.bot === target.author || vote.bot === rootAuthor)
                continue; // identity: never counts
            if (!target.passVoters.has(vote.bot))
                target.passVoters.set(vote.bot, vote.pinId);
            if (!target.failed && !target.verified && target.passVoters.size >= quorum) {
                target.verified = true;
                // Verified time (§3.1): the full order key of THIS quorum-reaching vote.
                target.verifiedVote = {
                    height: pin.height,
                    txIndex: asNum(pin.txIndex),
                    timestampMs: asNum(pin.timestampMs),
                    pinId: pin.pinId,
                };
            }
        }
    }
    // -- amend fold (competitive freeze condition + deps rules) -----------------
    const treePin = taskSet.treePin;
    const initialTree = treePin ? treePin.body : null;
    const initialNodes = new Map();
    if (initialTree && Array.isArray(initialTree.nodes)) {
        for (const raw of initialTree.nodes) {
            if (!raw || typeof raw !== 'object')
                continue;
            initialNodes.set(String(raw.id), raw);
        }
    }
    const amendResult = foldCompetitiveAmends({
        amends: (ctx.byPath.get('amend') ?? []).filter((p) => asStr(p.body.taskid) === rootPin.pinId),
        rootAuthor,
        treePinId: taskSet.treePinId,
        initialNodes,
        submissions: compSubs,
        submissionByPin,
        finalnode,
        hAct2: ctx.hAct2,
    });
    ignoredEvents.push(...amendResult.ignored);
    const effectiveTree = amendResult.nodes;
    const amendHead = amendResult.head;
    // -- effective-tree filter + final structural validation --------------------
    // Same node-universe rule as tree mode: events naming a node outside the
    // effective (post-amend) tree are chain facts about a node this task does
    // not have. parentrefs are validated against the effective tree; a node's
    // deps are immutable once it exists, so validation is stable across amends.
    const effectiveNodeIds = new Set(effectiveTree.keys());
    const alreadyIgnoredPins = new Set(ignoredEvents.map((entry) => entry.pinId));
    const markIgnored = (pinId, reason) => {
        if (alreadyIgnoredPins.has(pinId))
            return;
        alreadyIgnoredPins.add(pinId);
        ignoredEvents.push({ pinId, reason });
    };
    for (const claim of ctx.byPath.get('claim') ?? []) {
        if (asStr(claim.body.taskid) !== rootPin.pinId)
            continue;
        if (!effectiveNodeIds.has(asStr(claim.body.node)))
            markIgnored(claim.pinId, 'unknown_node');
    }
    const finalOracle = makeCompOracle(effectiveTree, compSubs, submissionByPin, finalnode);
    const validSubs = [];
    const validByNode = new Map();
    for (const sub of compSubs) {
        if (!effectiveNodeIds.has(sub.node)) {
            markIgnored(sub.pinId, 'unknown_node');
            continue;
        }
        if (!finalOracle.structurallyValid(sub)) {
            markIgnored(sub.pinId, 'invalid_reference');
            continue;
        }
        validSubs.push(sub);
        const list = validByNode.get(sub.node) ?? [];
        list.push(sub);
        validByNode.set(sub.node, list);
    }
    // -- node satisfaction, completion, winning chain (§3.4/§3.6) ----------------
    const normHeight = (height) => (height >= 0 ? height : BIG);
    // Leader order (§3.6): smallest verified time (height, txIndex of the
    // quorum-reaching counted pass vote); ties broken by the submission's own
    // (height, txIndex, pinId).
    const leaderLess = (a, b) => {
        const av = a.verifiedVote ?? { height: -1, txIndex: 0 };
        const bv = b.verifiedVote ?? { height: -1, txIndex: 0 };
        if (normHeight(av.height) !== normHeight(bv.height))
            return normHeight(av.height) < normHeight(bv.height);
        if (av.txIndex !== bv.txIndex)
            return av.txIndex < bv.txIndex;
        if (normHeight(a.height) !== normHeight(b.height))
            return normHeight(a.height) < normHeight(b.height);
        if (a.txIndex !== b.txIndex)
            return a.txIndex < b.txIndex;
        return a.pinId < b.pinId;
    };
    const leaderOf = (nodeId) => {
        let best = null;
        for (const sub of validByNode.get(nodeId) ?? []) {
            if (!(sub.verified && finalOracle.chainValid(sub)))
                continue;
            if (!best || leaderLess(sub, best))
                best = sub;
        }
        return best;
    };
    const finalNode = finalOracle.finalNode;
    const winner = finalNode !== null ? leaderOf(finalNode) : null;
    const taskComplete = winner !== null;
    // Winning chain = the winner plus the recursive parentrefs closure (§3.6).
    // Exactly one parent per dep and a single sink ⇒ at most one submission per
    // node, so the closure walk is unambiguous.
    const winningChainByNode = new Map();
    if (winner) {
        const stack = [winner];
        while (stack.length) {
            const sub = stack.pop();
            if (winningChainByNode.has(sub.node))
                continue;
            winningChainByNode.set(sub.node, sub);
            for (const dep of compDepsOf(effectiveTree, sub.node)) {
                const parent = submissionByPin.get(asStr(sub.parentrefs?.[dep]));
                if (parent)
                    stack.push(parent);
            }
        }
    }
    // The draft does not fix a winningChain array order; node-id ascending is
    // deterministic and trivially auditable against the manifest's node table.
    const winningChain = Array.from(winningChainByNode.keys())
        .sort()
        .map((nodeId) => winningChainByNode.get(nodeId).pinId);
    const winningPinIds = new Set(winningChain);
    // -- challenges (H_ACT2-gated; target = current chain-valid verified) --------
    const openChallenges = new Map();
    if (ctx.hAct2 !== Number.POSITIVE_INFINITY) {
        // Challenge pins carry no taskid; they scope by target (a task submission).
        const challenges = (ctx.byPath.get('challenge') ?? []).filter((p) => taskSet.knownTargets.has(asStr(p.body.targetid)));
        for (const ch of challenges) {
            const body = ch.body;
            const target = asStr(body.targetid);
            const targetSub = submissionByPin.get(target) ?? null;
            const submitter = ctx.submissionAuthorByPin.get(target) ?? '';
            if (ch.height < ctx.hAct2) {
                ignoredEvents.push({ pinId: ch.pinId, reason: 'below_h_act2' });
                continue;
            }
            if (ch.author === submitter || ch.author === rootAuthor || !truthyStr(body.evidence)) {
                ignoredEvents.push({ pinId: ch.pinId, reason: 'challenge_gate_failed' });
                continue;
            }
            if (body.withdraw) {
                for (const [key, open] of openChallenges) {
                    if (open.author === ch.author && open.target === target)
                        openChallenges.delete(key);
                }
                continue;
            }
            const key = `${target} ${ch.author}`;
            if (openChallenges.has(key)) {
                ignoredEvents.push({ pinId: ch.pinId, reason: 'duplicate_open_challenge' });
                continue;
            }
            // §3.8: the target must be a currently chain-valid verified submission —
            // boundary-evaluated, so a target killed by a fail verdict (directly or
            // via ancestor cascade) resolves the challenge as overturned here and it
            // never revives (v1.2.1 parity).
            if (!targetSub || !finalOracle.chainValid(targetSub)) {
                ignoredEvents.push({ pinId: ch.pinId, reason: 'target_not_active_verified' });
                continue;
            }
            if (now !== null &&
                asNum(ch.timestampMs) > 0 &&
                now - asNum(ch.timestampMs) > ctx.challengeTtlDays * 86_400_000) {
                ignoredEvents.push({ pinId: ch.pinId, reason: 'challenge_expired' });
                continue;
            }
            openChallenges.set(key, { pinId: ch.pinId, node: targetSub.node, author: ch.author, target });
        }
    }
    const disputedNodeIds = new Set();
    for (const open of openChallenges.values())
        disputedNodeIds.add(open.node);
    // -- node projections + participant stats -----------------------------------
    const nodeStates = {};
    const participants = new Map();
    const bump = (metaId) => {
        let stats = participants.get(metaId);
        if (!stats) {
            stats = {
                metaId,
                effectiveClaims: 0,
                submissions: 0,
                verifiedContrib: 0,
                reviewVotes: 0,
                reviewCorrect: 0,
                reviewTerminal: 0,
            };
            participants.set(metaId, stats);
        }
        return stats;
    };
    bump(rootAuthor);
    // Claims are intent-only in competitive mode (§3.2): they never gate work,
    // so none of them is "effective" and effectiveClaims stays 0 for everyone.
    for (const sub of validSubs) {
        bump(sub.author).submissions += 1;
        if (finalOracle.chainValid(sub))
            bump(sub.author).verifiedContrib += 1;
        // Every counted vote on a valid candidate is review activity, whether the
        // candidate leads, loses or is still open.
        for (const vote of ctx.votesByTarget.get(sub.pinId) ?? []) {
            if (vote.bot === sub.author || vote.bot === rootAuthor)
                continue;
            bump(vote.bot).reviewVotes += 1;
        }
    }
    // One vote → its display summary. Shared by the node-level leading-candidate
    // view and every per-candidate review timeline so both apply the exact same
    // counted/ignoreReason/verdict projection (identity filter = the voter is
    // neither the submission's author nor the task root author).
    const toVoteSummary = (vote, subAuthor) => {
        const identityOk = vote.bot !== subAuthor && vote.bot !== rootAuthor;
        return {
            voter: vote.bot,
            verdict: asStr(vote.body.verdict, 'invalid'),
            pinId: vote.pinId,
            counted: identityOk,
            ignoreReason: identityOk ? null : 'identity_conflict',
            semanticCheck: truthyStr(vote.body.semantic_check),
            failreason: truthyStr(vote.body.failreason),
            // Candidate-drawer review timeline inputs: the drawer filters by
            // `targetid` to rebuild one candidate's votes.
            targetid: asStr(vote.body.targetid),
            height: vote.height,
            timestampMs: vote.timestampMs,
            failreasonText: asStr(vote.body.failreason) || null,
            semanticCheckText: asStr(vote.body.semantic_check) || null,
        };
    };
    const candidateEntry = (sub) => {
        const body = ctx.submissionBodyByPin.get(sub.pinId);
        const result = body?.result;
        let passVotes = 0;
        let failVotes = 0;
        const votes = [];
        for (const vote of ctx.votesByTarget.get(sub.pinId) ?? []) {
            // Same counting rule as the tree-mode node view: passes are
            // identity-filtered, fails are not (ruling three parity).
            if (vote.body.verdict === 'pass' && vote.bot !== sub.author && vote.bot !== rootAuthor)
                passVotes += 1;
            if (vote.body.verdict === 'fail')
                failVotes += 1;
            votes.push(toVoteSummary(vote, sub.author));
        }
        return {
            pinId: sub.pinId,
            submitter: sub.author,
            atMs: sub.atMs,
            result: result && typeof result === 'object' && !Array.isArray(result)
                ? result
                : null,
            hash: asStr(body?.hash) || null,
            contentType: asStr(body?.contentType) || null,
            attachment: asStr(body?.attachment) || null,
            parentrefs: sub.parentrefs,
            verified: sub.verified,
            chainValid: finalOracle.chainValid(sub),
            superseded: sub.superseded,
            failed: sub.failed,
            passVotes,
            failVotes,
            verifiedHeight: sub.verifiedVote ? sub.verifiedVote.height : null,
            verifiedTxIndex: sub.verifiedVote ? sub.verifiedVote.txIndex : null,
            votes,
        };
    };
    const progress = { total: 0, verified: 0, claimed: 0, open: 0, disputed: 0, satisfied: 0 };
    const nodeSort = (a, b) => a.length !== b.length ? a.length - b.length : a < b ? -1 : 1;
    for (const node of Array.from(effectiveNodeIds).sort(nodeSort)) {
        const treeRec = effectiveTree.get(node);
        const candidates = validByNode.get(node) ?? [];
        const leader = leaderOf(node);
        const satisfied = leader !== null;
        // Live candidate = not killed, not replaced: the node has work in flight.
        const live = candidates.some((sub) => !sub.failed && !sub.superseded);
        const status = satisfied ? 'verified' : live ? 'claimed' : 'open';
        const disputed = disputedNodeIds.has(node);
        // The node-level vote view mirrors `submission`: the leading candidate's
        // votes (the full per-candidate timelines live in `submissions[].votes`).
        const voteList = [];
        let passVotes = 0;
        let failVotes = 0;
        if (leader) {
            for (const vote of ctx.votesByTarget.get(leader.pinId) ?? []) {
                const identityOk = vote.bot !== leader.author && vote.bot !== rootAuthor;
                if (vote.body.verdict === 'pass' && identityOk)
                    passVotes += 1;
                if (vote.body.verdict === 'fail')
                    failVotes += 1;
                voteList.push(toVoteSummary(vote, leader.author));
            }
        }
        const leaderBody = leader ? ctx.submissionBodyByPin.get(leader.pinId) : undefined;
        const leaderResult = leaderBody?.result;
        nodeStates[node] = {
            id: node,
            parent: treeRec?.parent ?? null,
            title: treeRec?.title ?? node,
            kind: treeRec?.kind ?? 'proof',
            weight: treeRec?.weight ?? null,
            params: treeRec && treeRec.params && typeof treeRec.params === 'object'
                ? treeRec.params
                : null,
            specid: treeRec?.specid ?? null,
            deps: treeRec && Array.isArray(treeRec.deps)
                ? treeRec.deps.filter((dep) => typeof dep === 'string')
                : [],
            status,
            disputed,
            holder: null, // competitive mode has no claim locks
            submission: leader
                ? {
                    pinId: leader.pinId,
                    submitter: leader.author,
                    atMs: leader.atMs,
                    superseded: false,
                    result: leaderResult && typeof leaderResult === 'object' && !Array.isArray(leaderResult)
                        ? leaderResult
                        : null,
                    hash: asStr(leaderBody?.hash) || null,
                    contentType: asStr(leaderBody?.contentType) || null,
                    attachment: asStr(leaderBody?.attachment) || null,
                    parentrefs: leader.parentrefs,
                }
                : null,
            submissions: candidates.map(candidateEntry),
            passVotes,
            failVotes,
            votes: voteList,
            cycleCount: 0, // no claim cycles in competitive mode
        };
        progress.total += 1;
        if (disputed)
            progress.disputed += 1;
        if (satisfied) {
            progress.verified += 1;
            progress.satisfied += 1;
        }
        else if (live)
            progress.claimed += 1;
        else
            progress.open += 1;
    }
    // Reviewer accuracy input: counted votes on terminally-resolved candidates
    // (verified or killed), judged against the candidate's final outcome — the
    // identity filter mirrors the settlement reviewer set exactly (tree parity).
    for (const sub of validSubs) {
        if (!sub.verified && !sub.failed)
            continue;
        for (const vote of ctx.votesByTarget.get(sub.pinId) ?? []) {
            if (vote.bot === sub.author || vote.bot === rootAuthor)
                continue;
            const stats = bump(vote.bot);
            stats.reviewTerminal += 1;
            const correct = (vote.body.verdict === 'pass' && sub.verified) || (vote.body.verdict === 'fail' && sub.failed);
            if (correct)
                stats.reviewCorrect += 1;
        }
    }
    // -- eventSetHash (recipe per rev-2, settlement section) ---------------------
    const eventSetHash = (0, canon_1.sha256Hex)((0, canon_1.canonJ)(taskSet.hashEntries));
    const boundaryBlock = taskSet.boundaryBlock;
    // -- settlement manifest (winner chain only, §3.7) ---------------------------
    let settlement = null;
    if (taskComplete && openChallenges.size === 0) {
        const weights = resolveNodeWeights(effectiveTree);
        const sigma = ctx.submitterShareBP;
        const accuracy = reviewerAccuracy(participants);
        const shareParts = new Map();
        for (const [node, sub] of winningChainByNode) {
            const w = weights.get(node) ?? 0;
            if (w <= 0)
                continue;
            const submitter = ensureShareParts(shareParts, sub.author);
            const subBP = Math.floor((w * sigma) / 10000);
            submitter.submittedBP += subBP;
            const pool = w - subBP; // defined by subtraction: no double rounding
            const subVotes = (ctx.votesByTarget.get(sub.pinId) ?? []).filter((vote) => vote.body.verdict === 'pass' && vote.bot !== sub.author && vote.bot !== rootAuthor);
            if (!subVotes.length) {
                submitter.submittedBP += pool; // defensive: empty R(n) pool goes to the submitter
                continue;
            }
            const accSum = subVotes.reduce((sum, vote) => sum + (accuracy.get(vote.bot) ?? constants_1.REVIEWER_ACCURACY_FLOOR_BP), 0);
            for (const vote of subVotes) {
                const a = accuracy.get(vote.bot) ?? constants_1.REVIEWER_ACCURACY_FLOOR_BP;
                ensureShareParts(shareParts, vote.bot).reviewedBP += Math.floor((pool * a) / accSum); // residue discarded
            }
        }
        const shares = Array.from(shareParts, ([metaId, parts]) => ({
            metaId,
            shareBP: parts.submittedBP + parts.reviewedBP,
            from: parts,
        })).sort((a, b) => b.shareBP - a.shareBP || (a.metaId < b.metaId ? -1 : 1));
        // Losing/unpaid candidates, in chain order: superseded and killed
        // candidates keep their tree-analogous audit trail; every other verified
        // candidate that is not on the winning chain is a losing fork (§3.6).
        // Open live candidates are pending work, not history.
        const unpaidHistory = [];
        for (const sub of validSubs) {
            if (sub.superseded) {
                unpaidHistory.push({ node: sub.node, author: sub.author, pinId: sub.pinId, reason: 'superseded' });
            }
            else if (sub.failed) {
                unpaidHistory.push({ node: sub.node, author: sub.author, pinId: sub.pinId, reason: 'failed' });
            }
            else if (sub.verified && !winningPinIds.has(sub.pinId)) {
                unpaidHistory.push({ node: sub.node, author: sub.author, pinId: sub.pinId, reason: 'losing_fork' });
            }
        }
        const weightsTable = Array.from(weights, ([id, w]) => ({ id, weight: w })).sort((a, b) => a.id < b.id ? -1 : 1);
        settlement = {
            taskid: rootPin.pinId,
            boundaryBlock,
            eventSetHash,
            engineAlgoVersion: constants_1.ENGINE_ALGO_VERSION_COMPETITIVE,
            shares,
            unpaidHistory,
            disputed: [],
            weightsTableHash: (0, canon_1.sha256Hex)((0, canon_1.canonJ)(weightsTable)),
            mode: 'competitive',
            winningChain,
        };
    }
    const taskScoped = taskSet.scopedByPin;
    let lastActivityMs = 0;
    for (const pin of taskScoped.values()) {
        if (asNum(pin.timestampMs) > lastActivityMs)
            lastActivityMs = asNum(pin.timestampMs);
    }
    return {
        rootPinId: rootPin.pinId,
        title: asStr(taskBody.title, rootPin.pinId),
        brief: asStr(taskBody.brief),
        publisher: rootAuthor,
        tags: Array.isArray(taskBody.tags)
            ? taskBody.tags.filter((t) => typeof t === 'string')
            : [],
        policy: {
            // claimTtlHours / verifyWindowHours are reported as published but carry
            // no semantics in competitive mode (§3.10; deadlines.ts skips them).
            claimTtlHours: ctx.ttlHours,
            verifyQuorum: quorum,
            verifyWindowHours: ctx.windowHours,
            rewardSat: asNum(policy.reward_sat, 0),
            challengeTtlDays: ctx.challengeTtlDays,
            hasSplit: Boolean(ctx.split),
            rosterid: ctx.split?.rosterid ?? null,
            submitterShareBP: ctx.submitterShareBP,
            mode: 'competitive',
            finalNode: finalnode || null,
        },
        nodes: Array.from(effectiveTree.values()),
        amendHead,
        nodeStates,
        progress,
        taskComplete,
        participants: Array.from(participants.values()).sort((a, b) => b.verifiedContrib - a.verifiedContrib || (a.metaId < b.metaId ? -1 : 1)),
        identities: {}, // enriched at the projection-store layer (local roster resolver)
        settlement,
        lastActivityMs,
        freshness: {
            boundaryBlock,
            evaluatedAtMs: ctx.evaluatedAtMs,
            eventCount: taskScoped.size,
            eventSetHash,
            expiryApplied: now !== null,
        },
        ignoredEvents,
    };
};
/**
 * Compute a task's replay-relevant event set from a raw event pool. Pure and
 * side-effect free: replayMetaTask passes its own byPath so the sweep of a
 * large pool is not repeated, external callers (the refresher) omit it.
 */
function taskEventSet(events, options = {}) {
    const byPath = options.byPath ?? new Map();
    if (!options.byPath) {
        for (const event of events) {
            const list = byPath.get(event.path) ?? [];
            list.push(event);
            byPath.set(event.path, list);
        }
        // Callers that pass a byPath (replayMetaTask) already sorted it.
        for (const list of byPath.values())
            list.sort(compareByOrderKey);
    }
    const taskPins = byPath.get('task') ?? [];
    const rootPin = options.rootPinId
        ? taskPins.find((pin) => pin.pinId === options.rootPinId) ?? null
        : taskPins[taskPins.length - 1] ?? null;
    if (!rootPin)
        throw new Error('metatask replay: no task root pin in event set');
    const taskBody = rootPin.body;
    const treePinId = asStr(taskBody.treeid);
    const treePin = (byPath.get('tree') ?? []).find((pin) => pin.pinId === treePinId) ?? null;
    const submissions = (byPath.get('submission') ?? [])
        .filter((pin) => asStr(pin.body.taskid) === rootPin.pinId)
        .sort(compareByOrderKey);
    const knownTargets = new Set();
    for (const submission of submissions)
        knownTargets.add(submission.pinId);
    const scopedByPin = new Map();
    scopedByPin.set(rootPin.pinId, rootPin);
    if (treePin)
        scopedByPin.set(treePin.pinId, treePin);
    for (const [path, list] of byPath) {
        if (path === 'task' || path === 'tree' || path === 'spec')
            continue;
        for (const pin of list) {
            if (asStr(pin.body.taskid) === rootPin.pinId)
                scopedByPin.set(pin.pinId, pin);
        }
    }
    for (const scopePath of ['verify', 'challenge']) {
        for (const pin of byPath.get(scopePath) ?? []) {
            if (knownTargets.has(asStr(pin.body.targetid)))
                scopedByPin.set(pin.pinId, pin);
        }
    }
    const scoped = Array.from(scopedByPin.values());
    // eventSetHash recipe: the nine event paths in fixed order, confirmed pins
    // only, spec pins only via task.specid.
    const pathOrder = [
        'task',
        'tree',
        'spec',
        'claim',
        'release',
        'submission',
        'verify',
        'amend',
        'challenge',
    ];
    const specRefs = new Set();
    if (taskBody.specid)
        specRefs.add(taskBody.specid);
    const hashEntries = [];
    let boundaryBlock = -1;
    for (const path of pathOrder) {
        const list = (byPath.get(path) ?? []).filter((pin) => {
            if (pin.height < 0)
                return false; // confirmed only; mempool excluded
            if (path === 'task')
                return pin.pinId === rootPin.pinId;
            if (path === 'tree')
                return pin.pinId === treePinId;
            if (path === 'spec')
                return specRefs.has(pin.pinId);
            if (path === 'verify' || path === 'challenge')
                return knownTargets.has(asStr(pin.body.targetid));
            return asStr(pin.body.taskid) === rootPin.pinId;
        });
        list.sort((a, b) => {
            if (a.height !== b.height)
                return a.height - b.height;
            if (a.txIndex !== b.txIndex)
                return a.txIndex - b.txIndex;
            return a.pinId < b.pinId ? -1 : a.pinId > b.pinId ? 1 : 0;
        });
        for (const pin of list) {
            hashEntries.push({
                path: `/protocols/metatask/${path}`,
                pinId: pin.pinId,
                height: pin.height,
                txIndex: asNum(pin.txIndex),
            });
            if (pin.height > boundaryBlock)
                boundaryBlock = pin.height;
        }
    }
    const mempoolPinIds = scoped
        .filter((pin) => pin.height < 0)
        .map((pin) => pin.pinId)
        .sort();
    return {
        rootPin,
        rootAuthor: rootPin.author,
        taskBody,
        treePinId,
        treePin,
        submissions,
        knownTargets,
        scoped,
        scopedByPin,
        hashEntries,
        boundaryBlock,
        mempoolPinIds,
    };
}
/**
 * Stable dirty key for a task root: everything replayMetaTask reads.
 *
 *  - the engine's eventSetHash INPUT (shared helper, so the two can never
 *    drift);
 *  - the scoped-but-unconfirmed (mempool) pins. The eventSetHash recipe
 *    deliberately excludes height < 0 pins, but they DO act in the replay walk
 *    (a brand-new unconfirmed submission must dirty its root), so they are part
 *    of this key while the engine's own eventSetHash stays untouched;
 *  - a BODY fingerprint of every scoped event. Pin ids and heights alone do not
 *    change when the indexer's content contract degrades (truncated summary →
 *    empty body) or when a later sweep recovers the full body again, so without
 *    the body the root would stay "clean" and a broken projection would stick
 *    forever;
 *  - the roster pin the task's split references. Same-side roster filtering
 *    reads that pin's body, and it is NOT part of the task's own event set
 *    (reference pin, no taskid), so its arrival or absence must dirty the root
 *    on its own.
 *
 * The body fingerprints deliberately changed this key's format: every root is
 * re-dirtied ONCE on upgrade (one extra replay per task, then stable again).
 * The engine's protocol eventSetHash recipe is untouched by this.
 *
 * `PROJECTION_FORMAT_VERSION` salts the key with the projection FORMAT version
 * (not the protocol version): whenever the projection shape or replay semantics
 * change (e.g. competitive mode added `submissions`/`satisfied`), cached
 * projections written by an older build are invalidated once, forcing a single
 * re-replay per root — otherwise a pre-upgrade cache would keep serving the old
 * format forever because the chain events did not change.
 *
 * Equal keys ⇒ the same inputs produce the same projection, time-driven expiry
 * aside; that residual is covered by nextTimeDeadlineMs.
 */
exports.PROJECTION_FORMAT_VERSION = 3;
const taskDirtyKey = (taskSet, options = {}) => {
    const rosterid = taskSet.taskBody.policy?.split?.rosterid ?? null;
    const bodies = taskSet.scoped
        .map((pin) => ({ pinId: pin.pinId, bodyHash: (0, canon_1.sha256Hex)((0, canon_1.canonJ)(pin.body)) }))
        .sort((a, b) => (a.pinId < b.pinId ? -1 : a.pinId > b.pinId ? 1 : 0));
    return (0, canon_1.sha256Hex)((0, canon_1.canonJ)({
        formatVersion: exports.PROJECTION_FORMAT_VERSION,
        confirmed: taskSet.hashEntries,
        unconfirmed: taskSet.mempoolPinIds,
        bodies,
        rosterPin: rosterid ? options.rosterPins?.[rosterid] ?? null : null,
    }));
};
exports.taskDirtyKey = taskDirtyKey;
/**
 * Replay one MetaTask from its event set. Baseline node states follow the
 * reference Python engine exactly (final-holder anchoring, last-valid vote
 * per bot with #8/#9 filtered first, quorum judgment, immediate reopen on a
 * valid fail). v1.2 features (amend / supersede / challenge / settlement)
 * are H_ACT2-gated per the rev-2 registration draft.
 *
 * Node universe: only the effective (post-amend) tree exists. Claims,
 * releases, submissions and cycles naming any other node id — a stray claim
 * on an invented node, or a node an effective amend removed — are dropped
 * and recorded in `ignoredEvents` with reason 'unknown_node'; they never
 * create node state, appear in openNodes, count in progress, or join the
 * settlement weight table.
 */
function replayMetaTask(events, options = {}) {
    const hAct = options.hAct ?? constants_1.H_ACT;
    const hAct2 = (0, constants_1.hAct2Or)(options.hAct2 === undefined ? constants_1.H_ACT2 : options.hAct2);
    const now = typeof options.now === 'number' ? options.now : null;
    const evaluatedAtMs = options.evaluatedAtMs ?? Date.now();
    const byPath = new Map();
    for (const event of events) {
        const list = byPath.get(event.path) ?? [];
        list.push(event);
        byPath.set(event.path, list);
    }
    for (const list of byPath.values())
        list.sort(compareByOrderKey);
    // -- task root + membership (shared with the refresher's dirty check) ------
    const taskSet = taskEventSet(events, { rootPinId: options.rootPinId, byPath });
    const rootPin = taskSet.rootPin;
    const rootAuthor = taskSet.rootAuthor;
    const taskBody = taskSet.taskBody;
    const policy = taskBody.policy ?? {};
    const quorum = Math.max(1, asNum(policy.verify_quorum, 2));
    const ttlHours = asNum(policy.claim_ttl_hours, 0);
    const windowHours = asNum(policy.verify_window_hours, 0);
    const challengeTtlDays = asNum(policy.challenge_ttl_days, constants_1.CHALLENGE_TTL_DAYS_DEFAULT);
    const split = policy.split ?? null;
    // σ: the submitter share actually used by the split, published in the
    // projection so consumers (mid-task share estimates) read the SAME clamp the
    // settlement applies. Not an engine input: the clamp is protocol-fixed.
    const submitterShareBP = Math.min(constants_1.SUBMITTER_SHARE_BP_MAX, Math.max(constants_1.SUBMITTER_SHARE_BP_MIN, asNum(split?.submitterShareBP, constants_1.SUBMITTER_SHARE_BP_DEFAULT)));
    // Task-scoped events, submissions and known targets come from the shared
    // membership helper (same call the refresher's dirty check uses).
    const treePinId = taskSet.treePinId;
    const treePin = taskSet.treePin;
    const taskScoped = taskSet.scopedByPin;
    const submissions = taskSet.submissions;
    const knownTargets = taskSet.knownTargets;
    const submissionAuthorByPin = new Map();
    const submissionBodyByPin = new Map();
    for (const sub of submissions) {
        submissionAuthorByPin.set(sub.pinId, sub.author);
        submissionBodyByPin.set(sub.pinId, sub.body);
    }
    // -- vote pre-pass: gates, roster, last valid per (target, bot) -------------
    // #8/#9 filtering happens BEFORE last-per-bot (a malformed vote never
    // withdraws the same bot's earlier valid vote).
    const rosterGroups = split?.rosterid && options.rosterPins
        ? rosterGroupsFor(options.rosterPins[split.rosterid])
        : [];
    const ignoredEvents = [];
    const lastVotes = new Map();
    for (const vote of byPath.get('verify') ?? []) {
        const target = asStr(vote.body.targetid);
        if (!target || !knownTargets.has(target))
            continue;
        const reason = voteInvalidReason(vote.body, vote.height, hAct);
        if (reason) {
            ignoredEvents.push({ pinId: vote.pinId, reason });
            continue;
        }
        if (hAct2 !== Number.POSITIVE_INFINITY && vote.height >= hAct2 && rosterGroups.length) {
            const submitter = submissionAuthorByPin.get(target) ?? '';
            if (sameSide(rosterGroups, vote.author, submitter) || sameSide(rosterGroups, vote.author, rootAuthor)) {
                ignoredEvents.push({ pinId: vote.pinId, reason: 'same_side_roster' });
                continue;
            }
        }
        lastVotes.set(`${target} ${vote.author}`, {
            bot: vote.author,
            pinId: vote.pinId,
            body: vote.body,
            height: vote.height,
            timestampMs: vote.timestampMs,
        });
    }
    const votesByTarget = new Map();
    for (const vote of lastVotes.values()) {
        const target = asStr(vote.body.targetid);
        const list = votesByTarget.get(target) ?? [];
        list.push(vote);
        votesByTarget.set(target, list);
    }
    const lastVoteByPin = new Map();
    for (const vote of lastVotes.values())
        lastVoteByPin.set(vote.pinId, vote);
    // -- mode selection (v1.3 draft §2) -----------------------------------------
    // `policy.mode` is set once at publish and is amend-immutable; absent (or any
    // unknown value) means tree mode, so pre-v1.3 tasks replay byte-identically.
    // No H_ACT3 height gate here on purpose: no competitive task exists on-chain
    // yet and pre-activation fixtures must stay replayable — the writer side
    // (metataskAgentTools.ts) refuses pre-activation broadcasts instead (see
    // H_ACT3), with an explicit pilot/testing override.
    if (policy.mode === 'competitive') {
        return replayCompetitiveTask({
            byPath,
            taskSet,
            policy,
            quorum,
            ttlHours,
            windowHours,
            challengeTtlDays,
            split,
            submitterShareBP,
            hAct2,
            now,
            evaluatedAtMs,
            submissionAuthorByPin,
            submissionBodyByPin,
            votesByTarget,
            lastVoteByPin,
            ignoredEvents,
        });
    }
    // -- unified ordered walk ---------------------------------------------------
    // Claims, releases, submissions and last-valid votes interleave in global
    // chain order. This extends the reference engine's claim+release walk with
    // ruling three: a valid fail kills the current lock immediately, which is
    // what lets rework start a fresh claim cycle without a manual release.
    const claims = (byPath.get('claim') ?? []).filter((p) => asStr(p.body.taskid) === rootPin.pinId);
    const releases = (byPath.get('release') ?? []).filter((p) => asStr(p.body.taskid) === rootPin.pinId);
    const actingVotes = (byPath.get('verify') ?? []).filter((p) => lastVoteByPin.has(p.pinId));
    const timeline = [...claims, ...releases, ...submissions, ...actingVotes].sort(compareByOrderKey);
    const holders = new Map();
    const firstClaimOrder = new Map();
    /** Claims that took a node lock, in chain order; node membership is resolved
     *  only after the amend fold (effective-tree filter below). */
    const effectiveClaims = [];
    const cycleByNodeClaim = new Map();
    const verifiedSubmissionPins = new Set();
    const passVotersByNode = new Map();
    /** Submission pin -> node, for the node's CURRENT effective submission only. */
    const nodeOfLiveTarget = new Map();
    for (const pin of timeline) {
        if (pin.path === 'claim') {
            const node = asStr(pin.body.node);
            if (node && !holders.has(node)) {
                holders.set(node, { pinId: pin.pinId, claimant: pin.author, sinceMs: asNum(pin.timestampMs) });
                if (!firstClaimOrder.has(node))
                    firstClaimOrder.set(node, orderKey(pin));
                effectiveClaims.push({ node, author: pin.author });
            }
            continue;
        }
        if (pin.path === 'release') {
            const node = asStr(pin.body.node);
            if (asStr(pin.body.claimid) === holders.get(node)?.pinId) {
                holders.delete(node);
                passVotersByNode.delete(node);
            }
            continue;
        }
        if (pin.path === 'submission') {
            const node = asStr(pin.body.node);
            const claimId = asStr(pin.body.claimid);
            if (!node || !claimId)
                continue;
            const holder = holders.get(node);
            if (!holder || holder.pinId !== claimId)
                continue; // not the current cycle
            const key = `${node} ${claimId}`;
            let cycle = cycleByNodeClaim.get(key);
            if (!cycle) {
                cycle = {
                    node,
                    claimId,
                    claimant: holder.claimant,
                    submissions: [],
                    effective: null,
                    supersededPinIds: new Set(),
                    outcome: 'open',
                };
                cycleByNodeClaim.set(key, cycle);
            }
            const record = {
                pinId: pin.pinId,
                author: pin.author,
                atMs: asNum(pin.timestampMs),
                height: pin.height,
                supersedeid: typeof pin.body.supersedeid === 'string' && pin.body.supersedeid
                    ? pin.body.supersedeid
                    : null,
            };
            if (!cycle.effective) {
                // v1.1 earliest-holds: the first submission of the cycle anchors it.
                cycle.submissions.push(record);
                cycle.effective = { pinId: record.pinId, author: record.author, atMs: record.atMs };
                nodeOfLiveTarget.set(record.pinId, node);
                continue;
            }
            if (!record.supersedeid) {
                ignoredEvents.push({ pinId: record.pinId, reason: 'duplicate_without_supersede' });
                continue;
            }
            // Supersede six predicates (rev-2, path 6): target exists in the same
            // cycle; same pin author; both ends at/after H_ACT2; the target is the
            // current chain tip and not already superseded (one replacement per
            // submission). "Target not verified" holds by construction: a verified
            // cycle is terminal and admits no further walk state.
            const target = cycle.submissions.find((s) => s.pinId === record.supersedeid);
            const chainOk = Boolean(target) &&
                target !== undefined &&
                target.pinId !== record.pinId &&
                target.pinId === cycle.effective.pinId &&
                target.author === record.author &&
                record.height >= hAct2 &&
                target.height >= hAct2 &&
                !cycle.supersededPinIds.has(record.supersedeid);
            if (chainOk) {
                cycle.supersededPinIds.add(record.supersedeid);
                cycle.submissions.push(record);
                nodeOfLiveTarget.set(record.pinId, node);
                cycle.effective = { pinId: record.pinId, author: record.author, atMs: record.atMs };
            }
            else {
                ignoredEvents.push({ pinId: record.pinId, reason: 'supersede_predicate_failed' });
            }
            continue;
        }
        // verify: only last-valid votes act in the walk.
        const vote = lastVoteByPin.get(pin.pinId);
        if (!vote)
            continue;
        const target = asStr(vote.body.targetid);
        const node = nodeOfLiveTarget.get(target);
        if (!node)
            continue; // target is not a current-cycle effective submission
        const holder = holders.get(node);
        const cycle = cycleByNodeClaim.get(`${node} ${holder?.pinId ?? ''}`);
        if (!cycle || cycle.effective?.pinId !== target)
            continue;
        if (vote.body.verdict === 'fail') {
            // Ruling three (identity NOT filtered — reference parity): reopen now;
            // the claim is consumed and rework needs a fresh claim cycle. A fail
            // arriving after quorum was provisionally reached undoes the verified
            // state (judgment is over all votes, not a race).
            cycle.outcome = 'fail_rejected';
            verifiedSubmissionPins.delete(target);
            holders.delete(node);
            passVotersByNode.delete(node);
            continue;
        }
        if (vote.body.verdict === 'pass') {
            const submitter = submissionAuthorByPin.get(target) ?? '';
            if (vote.bot === submitter || vote.bot === rootAuthor)
                continue; // identity: never counts
            let voters = passVotersByNode.get(node);
            if (!voters) {
                voters = new Map();
                passVotersByNode.set(node, voters);
            }
            if (!voters.has(vote.bot))
                voters.set(vote.bot, vote.pinId);
            if (voters.size >= quorum) {
                cycle.outcome = 'verified';
                verifiedSubmissionPins.add(target);
            }
        }
    }
    // A node's current cycle = its most recent cycle in chain order (live or
    // terminal); verified is sticky through the terminal state.
    const activeCycleByNode = new Map();
    for (const cycle of cycleByNodeClaim.values()) {
        activeCycleByNode.set(cycle.node, cycle);
    }
    // -- expiry pass (guard semantics; only when a clock is provided) ---------
    const expiryApplied = now !== null;
    if (now !== null) {
        for (const [node, holder] of holders) {
            const cycle = cycleByNodeClaim.get(`${node} ${holder.pinId}`);
            const effective = cycle?.effective ?? null;
            if (!effective) {
                if (ttlHours > 0 && now - holder.sinceMs > ttlHours * 3_600_000) {
                    holders.delete(node);
                    passVotersByNode.delete(node);
                }
            }
            else if (windowHours > 0) {
                const good = passVotersByNode.get(node)?.size ?? 0;
                if (good < quorum && now - effective.atMs > windowHours * 3_600_000) {
                    holders.delete(node);
                    passVotersByNode.delete(node);
                }
            }
        }
    }
    // -- node bookkeeping -------------------------------------------------------
    const initialTree = treePin ? treePin.body : null;
    const initialNodes = new Map();
    if (initialTree && Array.isArray(initialTree.nodes)) {
        for (const raw of initialTree.nodes) {
            if (!raw || typeof raw !== 'object')
                continue;
            initialNodes.set(String(raw.id), raw);
        }
    }
    const nodeIds = new Set(initialNodes.keys());
    // Vote-level verified set (walk outcome) feeds the amend fold; the final
    // aggregation-precondition pass below may still demote parents afterwards.
    const verifiedNodeIds = new Set();
    for (const [nodeId, cycle] of activeCycleByNode) {
        if (cycle.effective && verifiedSubmissionPins.has(cycle.effective.pinId)) {
            verifiedNodeIds.add(nodeId);
        }
    }
    // Amend fold (H_ACT2): point-in-time claim state + live-cycle/verified sets.
    const amendResult = foldAmends({
        amends: (byPath.get('amend') ?? []).filter((p) => asStr(p.body.taskid) === rootPin.pinId),
        rootAuthor,
        treePinId,
        initialNodes,
        firstClaimOrder,
        verifiedNodeIds,
        activeCycleNodeIds: new Set(holders.keys()),
        rootVerified: Boolean(initialTree?.root) && verifiedNodeIds.has(asStr(initialTree?.root)),
        hAct2,
    });
    ignoredEvents.push(...amendResult.ignored);
    const effectiveTree = amendResult.nodes;
    const amendHead = amendResult.head;
    // -- effective-tree filter -------------------------------------------------
    // The task's node universe IS its effective (post-amend) tree. A claim,
    // release, submission or cycle naming any other node id is a chain fact
    // about a node this task does not have: it must not create node state,
    // appear in openNodes, inflate progress.total, or reach the settlement
    // weight table (which keys strictly on the effective tree). This closes two
    // holes: a stray claim pin on an INVENTED node id no longer de-validates the
    // tree weights (which used to dump every task onto legacy uniform weights),
    // and a node an effective amend REMOVED stops being claimable/counted. A
    // claim that was valid when published but whose node a later amend removed
    // simply drops out of the effective projection — no crash.
    const effectiveNodeIds = new Set(effectiveTree.keys());
    const alreadyIgnoredPins = new Set(ignoredEvents.map((entry) => entry.pinId));
    const markIgnored = (pinId, reason) => {
        if (alreadyIgnoredPins.has(pinId))
            return;
        alreadyIgnoredPins.add(pinId);
        ignoredEvents.push({ pinId, reason });
    };
    for (const [node, holder] of Array.from(holders)) {
        if (effectiveNodeIds.has(node))
            continue;
        holders.delete(node);
        passVotersByNode.delete(node);
        markIgnored(holder.pinId, 'unknown_node');
    }
    for (const [key, cycle] of Array.from(cycleByNodeClaim)) {
        if (effectiveNodeIds.has(cycle.node))
            continue;
        cycleByNodeClaim.delete(key);
        markIgnored(cycle.claimId, 'unknown_node');
        for (const submission of cycle.submissions)
            markIgnored(submission.pinId, 'unknown_node');
    }
    nodeIds.clear();
    for (const id of effectiveNodeIds)
        nodeIds.add(id);
    // -- aggregation precondition (v1.2.1 paths.aggregationPrecondition) -------
    // Parent verified = all children verified AND own submission passed votes;
    // an aggregate's childids must correspond exactly to the children's
    // effective VERIFIED submissions (pinId identity = "hash 与对应子件一致").
    // Enforced from H_ACT2, anchored on the parent's effective-submission
    // height; pre-H_ACT2 parents are grandfathered at their recorded vote level
    // (pilot #01's root keeps its historical verified state). Registered
    // readings (v1.2.2 rulings folded into v1.3.0): the amend fold gates parents
    // on the vote-level set (conservative); the precondition childids comparison
    // is set-equality, while the top-level↔result mirror comparison is
    // positional (implemented below).
    const childrenOf = new Map();
    for (const node of effectiveTree.values()) {
        if (node.parent !== null) {
            const list = childrenOf.get(node.parent) ?? [];
            list.push(node.id);
            childrenOf.set(node.parent, list);
        }
    }
    const heightOfEffective = (node) => {
        const cycle = activeCycleByNode.get(node);
        if (!cycle?.effective)
            return -1;
        return cycle.submissions.find((s) => s.pinId === cycle.effective?.pinId)?.height ?? -1;
    };
    const finalVerifiedCache = new Map();
    const finalVerified = (node) => {
        const cached = finalVerifiedCache.get(node);
        if (cached !== undefined)
            return cached;
        finalVerifiedCache.set(node, false); // cycle guard; the tree is already acyclic
        let result = false;
        const cycle = activeCycleByNode.get(node);
        if (cycle?.effective && cycle.outcome === 'verified') {
            result = true;
            const children = childrenOf.get(node) ?? [];
            if (children.length > 0 && heightOfEffective(node) >= hAct2) {
                const childPins = new Set();
                const allChildrenVerified = children.every((child) => {
                    if (!finalVerified(child))
                        return false;
                    const childCycle = activeCycleByNode.get(child);
                    if (childCycle?.effective)
                        childPins.add(childCycle.effective.pinId);
                    return true;
                });
                const body = submissionBodyByPin.get(cycle.effective.pinId);
                const resultObject = body?.result;
                // v1.2.2 ruling item 2 (folded into the v1.3.0 registration): the
                // precondition comparison itself is set-equality, but when BOTH a
                // top-level childids and result.childids are present the MIRROR
                // comparison between them is positional item-by-item — the two forms
                // are not interchangeable. A mirror mismatch fails the precondition.
                const topChildids = Array.isArray(body?.childids) ? body.childids : null;
                const resultChildids = Array.isArray(resultObject?.childids) ? resultObject.childids : null;
                const mirrorOk = topChildids === null ||
                    resultChildids === null ||
                    (topChildids.length === resultChildids.length &&
                        topChildids.every((id, i) => id === resultChildids[i]));
                const canonical = resultChildids ?? topChildids ?? [];
                const listed = new Set(canonical.filter((id) => typeof id === 'string'));
                result =
                    mirrorOk &&
                        allChildrenVerified &&
                        listed.size === childPins.size &&
                        Array.from(childPins).every((pin) => listed.has(pin));
            }
        }
        finalVerifiedCache.set(node, result);
        return result;
    };
    const finalVerifiedNodeIds = new Set();
    for (const node of nodeIds) {
        if (finalVerified(node))
            finalVerifiedNodeIds.add(node);
    }
    const finalVerifiedPins = new Set();
    for (const node of finalVerifiedNodeIds) {
        const pin = activeCycleByNode.get(node)?.effective?.pinId;
        if (pin)
            finalVerifiedPins.add(pin);
    }
    // -- challenges (H_ACT2): open = unwithdrawn, unexpired, not overturned ----
    const openChallenges = new Map();
    if (hAct2 !== Number.POSITIVE_INFINITY) {
        // Challenge pins carry no taskid; they scope by target (a task submission).
        const challenges = (byPath.get('challenge') ?? []).filter((p) => knownTargets.has(asStr(p.body.targetid)));
        for (const ch of challenges) {
            const body = ch.body;
            const target = asStr(body.targetid);
            const submitter = submissionAuthorByPin.get(target) ?? '';
            if (ch.height < hAct2) {
                ignoredEvents.push({ pinId: ch.pinId, reason: 'below_h_act2' });
                continue;
            }
            if (ch.author === submitter || ch.author === rootAuthor || !truthyStr(body.evidence)) {
                ignoredEvents.push({ pinId: ch.pinId, reason: 'challenge_gate_failed' });
                continue;
            }
            if (body.withdraw) {
                for (const [key, open] of openChallenges) {
                    if (open.author === ch.author && open.target === target)
                        openChallenges.delete(key);
                }
                continue;
            }
            const key = `${target} ${ch.author}`;
            if (openChallenges.has(key)) {
                ignoredEvents.push({ pinId: ch.pinId, reason: 'duplicate_open_challenge' });
                continue;
            }
            const cycle = Array.from(activeCycleByNode.values()).find((c) => c.effective?.pinId === target);
            if (!cycle) {
                ignoredEvents.push({ pinId: ch.pinId, reason: 'target_not_active_verified' });
                continue;
            }
            if (now !== null &&
                asNum(ch.timestampMs) > 0 &&
                now - asNum(ch.timestampMs) > challengeTtlDays * 86_400_000) {
                ignoredEvents.push({ pinId: ch.pinId, reason: 'challenge_expired' });
                continue;
            }
            openChallenges.set(key, { pinId: ch.pinId, node: cycle.node, author: ch.author, target });
        }
    }
    // A challenge stands only while its target still anchors a FINAL-verified
    // node (aggregation precondition included).
    const disputedNodeIds = new Set();
    for (const [key, open] of openChallenges) {
        const cycle = activeCycleByNode.get(open.node);
        const stillVerified = Boolean(cycle?.effective && finalVerifiedPins.has(cycle.effective.pinId));
        if (cycle?.effective?.pinId === open.target && stillVerified) {
            disputedNodeIds.add(open.node);
        }
        else {
            openChallenges.delete(key); // overturned via the fail path: resolves closed, never revives
        }
    }
    // -- node projections + participant stats ----------------------------------
    const nodeStates = {};
    const participants = new Map();
    const bump = (metaId) => {
        let stats = participants.get(metaId);
        if (!stats) {
            stats = {
                metaId,
                effectiveClaims: 0,
                submissions: 0,
                verifiedContrib: 0,
                reviewVotes: 0,
                reviewCorrect: 0,
                reviewTerminal: 0,
            };
            participants.set(metaId, stats);
        }
        return stats;
    };
    // Effective claims per author, restricted to the effective tree: a claim on
    // a node this task does not have must not inflate a participant's standing.
    const effectiveClaimCounts = new Map();
    for (const claim of effectiveClaims) {
        if (!effectiveNodeIds.has(claim.node))
            continue;
        effectiveClaimCounts.set(claim.author, (effectiveClaimCounts.get(claim.author) ?? 0) + 1);
    }
    bump(rootAuthor);
    for (const [author, count] of effectiveClaimCounts)
        bump(author).effectiveClaims = count;
    const progress = { total: 0, verified: 0, claimed: 0, open: 0, disputed: 0, satisfied: 0 };
    const nodeSort = (a, b) => a.length !== b.length ? a.length - b.length : a < b ? -1 : 1;
    for (const node of Array.from(nodeIds).sort(nodeSort)) {
        const treeRec = effectiveTree.get(node);
        const cycle = activeCycleByNode.get(node);
        const holder = holders.get(node) ?? null;
        const effective = cycle?.effective ?? null;
        const isVerified = finalVerifiedNodeIds.has(node);
        const voteList = [];
        let passVotes = 0;
        let failVotes = 0;
        if (effective) {
            for (const v of votesByTarget.get(effective.pinId) ?? []) {
                const identityOk = v.bot !== effective.author && v.bot !== rootAuthor;
                if (v.body.verdict === 'pass' && identityOk)
                    passVotes += 1;
                if (v.body.verdict === 'fail')
                    failVotes += 1;
                // Participation visible from the node view: EVERY counted vote (same
                // identity rule as `counted` below) is review activity, whether the
                // cycle is still open or already terminal.
                if (identityOk)
                    bump(v.bot).reviewVotes += 1;
                voteList.push({
                    voter: v.bot,
                    verdict: asStr(v.body.verdict, 'invalid'),
                    pinId: v.pinId,
                    counted: identityOk,
                    ignoreReason: identityOk ? null : 'identity_conflict',
                    semanticCheck: truthyStr(v.body.semantic_check),
                    failreason: truthyStr(v.body.failreason),
                    // Candidate-drawer review timeline inputs: the drawer filters this
                    // node-level list by `targetid` to rebuild one candidate's votes.
                    targetid: asStr(v.body.targetid),
                    height: v.height,
                    timestampMs: v.timestampMs,
                    failreasonText: asStr(v.body.failreason) || null,
                    semanticCheckText: asStr(v.body.semantic_check) || null,
                });
            }
        }
        const status = isVerified
            ? 'verified'
            : holder
                ? 'claimed'
                : 'open';
        const disputed = disputedNodeIds.has(node);
        nodeStates[node] = {
            id: node,
            parent: treeRec?.parent ?? null,
            title: treeRec?.title ?? node,
            kind: treeRec?.kind ?? 'proof',
            weight: treeRec?.weight ?? null,
            params: treeRec && treeRec.params && typeof treeRec.params === 'object'
                ? treeRec.params
                : null,
            specid: treeRec?.specid ?? null,
            deps: treeRec && Array.isArray(treeRec.deps)
                ? treeRec.deps.filter((dep) => typeof dep === 'string')
                : [],
            status,
            disputed,
            holder: holder
                ? { pinId: holder.pinId, claimant: holder.claimant, sinceMs: holder.sinceMs }
                : null,
            submission: effective
                ? {
                    pinId: effective.pinId,
                    submitter: effective.author,
                    atMs: effective.atMs,
                    superseded: false,
                    result: (() => {
                        const body = submissionBodyByPin.get(effective.pinId);
                        const result = body?.result;
                        return result && typeof result === 'object' && !Array.isArray(result)
                            ? result
                            : null;
                    })(),
                    hash: asStr(submissionBodyByPin.get(effective.pinId)?.hash) || null,
                    contentType: asStr(submissionBodyByPin.get(effective.pinId)?.contentType) || null,
                    attachment: asStr(submissionBodyByPin.get(effective.pinId)?.attachment) || null,
                }
                : null,
            passVotes,
            failVotes,
            votes: voteList,
            cycleCount: Array.from(cycleByNodeClaim.values()).filter((c) => c.node === node).length,
        };
        progress.total += 1;
        if (disputed)
            progress.disputed += 1;
        if (isVerified)
            progress.verified += 1;
        // Tree mode's completion predicate IS final-verified, so satisfied === verified.
        if (isVerified)
            progress.satisfied += 1;
        else if (holder)
            progress.claimed += 1;
        else
            progress.open += 1;
        if (effective) {
            bump(effective.author).submissions += 1;
            if (isVerified)
                bump(effective.author).verifiedContrib += 1;
        }
    }
    // Reviewer accuracy input: counted votes on terminally-resolved cycles
    // (boundary = boundary block). The identity filter mirrors the node view and
    // the settlement reviewer set R(n) exactly — a self vote or the publisher's
    // vote must never move a(r) (it used to inflate Laplace accuracy from 5000
    // to 7500, i.e. +50% of the reviewer pool).
    const terminalCycles = Array.from(cycleByNodeClaim.values()).filter((cycle) => cycle.outcome === 'verified' || cycle.outcome === 'fail_rejected');
    for (const cycle of terminalCycles) {
        if (!cycle.effective)
            continue;
        for (const v of votesByTarget.get(cycle.effective.pinId) ?? []) {
            if (v.bot === cycle.effective.author || v.bot === rootAuthor)
                continue;
            const stats = bump(v.bot);
            stats.reviewTerminal += 1;
            const correct = (v.body.verdict === 'pass' && cycle.outcome === 'verified') ||
                (v.body.verdict === 'fail' && cycle.outcome === 'fail_rejected');
            if (correct)
                stats.reviewCorrect += 1;
        }
    }
    // Task completion = the ROOT node verified (v1.2.1 aggregation text). Via
    // the precondition this equals all-verified for H_ACT2-era trees; grandfathered
    // trees keep their recorded divergence (pilot #01: root verified, all_verified=false).
    const rootTreeNodeId = Array.from(effectiveTree.values()).find((node) => node.parent === null)?.id ??
        asStr(initialTree?.root) ??
        null;
    const taskComplete = rootTreeNodeId !== null && rootTreeNodeId !== ''
        ? finalVerifiedNodeIds.has(rootTreeNodeId)
        : progress.total > 0 && progress.verified === progress.total;
    // -- eventSetHash (recipe per rev-2, settlement section) -------------------
    // The hash input rows are computed by the shared membership helper, so the
    // refresher's dirty key and this hash can never describe different sets.
    const eventSetHash = (0, canon_1.sha256Hex)((0, canon_1.canonJ)(taskSet.hashEntries));
    const boundaryBlock = taskSet.boundaryBlock;
    // -- settlement manifest (v1.2) -------------------------------------------
    let settlement = null;
    if (taskComplete && openChallenges.size === 0) {
        // The weight table keys STRICTLY on the effective tree: the tree-mode
        // effective-node filter above guarantees the two sets are identical, so a
        // stray claim pin can no longer force the legacy uniform fallback.
        const weights = resolveNodeWeights(effectiveTree);
        const sigma = submitterShareBP;
        const accuracy = reviewerAccuracy(participants);
        const shareParts = new Map();
        for (const node of nodeIds) {
            const cycle = activeCycleByNode.get(node);
            if (!cycle?.effective || !finalVerifiedPins.has(cycle.effective.pinId))
                continue;
            const w = weights.get(node) ?? 0;
            if (w <= 0)
                continue;
            const submitter = ensureShareParts(shareParts, cycle.effective.author);
            const subBP = Math.floor((w * sigma) / 10000);
            submitter.submittedBP += subBP;
            const pool = w - subBP; // defined by subtraction: no double rounding
            const cycleVotes = (votesByTarget.get(cycle.effective.pinId) ?? []).filter((v) => v.body.verdict === 'pass' && v.bot !== cycle.effective?.author && v.bot !== rootAuthor);
            if (!cycleVotes.length) {
                submitter.submittedBP += pool; // defensive: empty R(n) pool goes to the submitter
                continue;
            }
            const accSum = cycleVotes.reduce((sum, v) => sum + (accuracy.get(v.bot) ?? constants_1.REVIEWER_ACCURACY_FLOOR_BP), 0);
            for (const v of cycleVotes) {
                const a = accuracy.get(v.bot) ?? constants_1.REVIEWER_ACCURACY_FLOOR_BP;
                ensureShareParts(shareParts, v.bot).reviewedBP += Math.floor((pool * a) / accSum); // residue discarded
            }
        }
        const shares = Array.from(shareParts, ([metaId, parts]) => ({
            metaId,
            shareBP: parts.submittedBP + parts.reviewedBP,
            from: parts,
        })).sort((a, b) => b.shareBP - a.shareBP || (a.metaId < b.metaId ? -1 : 1));
        const unpaidHistory = [];
        for (const cycle of cycleByNodeClaim.values()) {
            for (const s of cycle.submissions) {
                if (cycle.supersededPinIds.has(s.pinId)) {
                    unpaidHistory.push({ node: cycle.node, author: s.author, pinId: s.pinId, reason: 'superseded' });
                    continue;
                }
                // The cycle's final effective submission: paid only when verified;
                // a fail-rejected cycle's effective submission is unpaid rework history
                // (an open live cycle is pending, not history).
                const isEffective = cycle.effective?.pinId === s.pinId;
                if (isEffective && cycle.outcome === 'fail_rejected') {
                    unpaidHistory.push({ node: cycle.node, author: s.author, pinId: s.pinId, reason: 'rework_cycle' });
                }
            }
        }
        const weightsTable = Array.from(weights, ([id, w]) => ({ id, weight: w })).sort((a, b) => a.id < b.id ? -1 : 1);
        settlement = {
            taskid: rootPin.pinId,
            boundaryBlock,
            eventSetHash,
            engineAlgoVersion: constants_1.ENGINE_ALGO_VERSION,
            shares,
            unpaidHistory,
            disputed: [],
            weightsTableHash: (0, canon_1.sha256Hex)((0, canon_1.canonJ)(weightsTable)),
        };
    }
    let lastActivityMs = 0;
    for (const pin of taskScoped.values()) {
        if (asNum(pin.timestampMs) > lastActivityMs)
            lastActivityMs = asNum(pin.timestampMs);
    }
    return {
        rootPinId: rootPin.pinId,
        title: asStr(taskBody.title, rootPin.pinId),
        brief: asStr(taskBody.brief),
        publisher: rootAuthor,
        tags: Array.isArray(taskBody.tags)
            ? taskBody.tags.filter((t) => typeof t === 'string')
            : [],
        policy: {
            claimTtlHours: ttlHours,
            verifyQuorum: quorum,
            verifyWindowHours: windowHours,
            rewardSat: asNum(policy.reward_sat, 0),
            challengeTtlDays,
            hasSplit: Boolean(split),
            rosterid: split?.rosterid ?? null,
            submitterShareBP,
            mode: 'tree',
            finalNode: asStr(policy.finalnode) || null,
        },
        nodes: Array.from(effectiveTree.values()),
        amendHead,
        nodeStates,
        progress,
        taskComplete,
        participants: Array.from(participants.values()).sort((a, b) => b.verifiedContrib - a.verifiedContrib || (a.metaId < b.metaId ? -1 : 1)),
        identities: {}, // enriched at the projection-store layer (local roster resolver)
        settlement,
        lastActivityMs,
        freshness: {
            boundaryBlock,
            evaluatedAtMs,
            eventCount: taskScoped.size,
            eventSetHash,
            expiryApplied,
        },
        ignoredEvents,
    };
}
