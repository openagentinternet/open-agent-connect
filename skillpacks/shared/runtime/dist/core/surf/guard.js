"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.surfReceiptSeenActions = surfReceiptSeenActions;
exports.foldSurfReceiptsIntoSeenActions = foldSurfReceiptsIntoSeenActions;
exports.recordSurfDeepRead = recordSurfDeepRead;
exports.surfDeepReadReceiptSeenActions = surfDeepReadReceiptSeenActions;
exports.surfSessionPartialStats = surfSessionPartialStats;
exports.surfReceiptsFromChainWriteRecord = surfReceiptsFromChainWriteRecord;
exports.createSurfChainWriteGuard = createSurfChainWriteGuard;
/**
 * Surf interaction guard. OAC port of the IDBots surfInteractionGuard,
 * adapted to OAC's write path: every chain write a surf session can reach
 * (like/comment/answer/ask/buzz/note/agentpedia challenge) funnels through
 * one guarded `write({path, payload})` primitive instead of IDBots'
 * `createPin`.
 */
const store_js_1 = require("./store.js");
const RECEIPT_ACTION_BY_RANK = new Map(['liked', 'commented', 'answered', 'challenged']
    .map((action) => [store_js_1.SEEN_ACTION_RANK[action], action]));
/** Chain-write classes whose ledger entries come ONLY from guard receipts. */
const RECEIPT_ACTIONS = new Set(['liked', 'commented', 'answered', 'posted', 'challenged']);
/**
 * The run's ACTUAL on-chain writes as seen-ledger entries, read back from the
 * guard-mutated write state after the session — the ground truth the model's
 * self-report is checked against.
 */
function surfReceiptSeenActions(state) {
    const fromInteractions = Object.entries(state.interactions ?? {})
        .map(([pinId, rank]) => ({ pinId, action: RECEIPT_ACTION_BY_RANK.get(rank) }))
        .filter((entry) => Boolean(entry.action));
    const fromPosts = (state.postedPinIds ?? [])
        .map((pinId) => String(pinId || '').trim())
        .filter(Boolean)
        .map((pinId) => ({ pinId, action: 'posted' }));
    return [...fromInteractions, ...fromPosts];
}
/**
 * Fold receipts over the session's self-reported seen actions: every
 * chain-write class comes ONLY from what the guard actually published — a
 * like the model forgot to report is still banked, a like it merely claimed
 * is dropped. Read/saved-class entries stay self-reported (their blast
 * radius is one bot's digest, not gas).
 */
function foldSurfReceiptsIntoSeenActions(selfReported, state) {
    return [
        ...selfReported.filter((entry) => !RECEIPT_ACTIONS.has(entry.action)),
        ...surfReceiptSeenActions(state),
        // Deep-read receipts ride on top of the self-report (the batch store
        // keeps the strongest action per pin, so a self-reported 'saved' still
        // wins over a tracked 'read' of the same pin).
        ...surfDeepReadReceiptSeenActions(state),
    ];
}
/** Record one actual deep read on the run's write state (deduped). */
function recordSurfDeepRead(state, pinId) {
    const clean = String(pinId ?? '').trim();
    if (!clean)
        return;
    const reads = state.readPinIds ?? (state.readPinIds = []);
    if (!reads.includes(clean))
        reads.push(clean);
}
/** The run's tracked deep reads as 'read'-class seen-ledger entries. */
function surfDeepReadReceiptSeenActions(state) {
    return (state.readPinIds ?? []).map((pinId) => ({ pinId, action: 'read' }));
}
/**
 * What the host can vouch for on a FAILED run: real counts from the
 * guard-mutated state — chain interactions by their strongest action, posts,
 * KB adds and tracked deep reads. Attached to the session error so the failed
 * run row stops reporting all-zero stats.
 */
function surfSessionPartialStats(state) {
    const stats = {};
    const receipts = surfReceiptSeenActions(state);
    const countOf = (action) => receipts.filter((entry) => entry.action === action).length;
    if (receipts.length > 0) {
        stats.liked = countOf('liked');
        stats.commented = countOf('commented');
        stats.answered = countOf('answered');
        stats.challenged = countOf('challenged');
        stats.posted = countOf('posted');
    }
    if ((state.kbAddsUsed ?? 0) > 0)
        stats.savedToKb = state.kbAddsUsed;
    if ((state.readPinIds?.length ?? 0) > 0)
        stats.deepRead = state.readPinIds.length;
    if ((state.tasksScheduled ?? 0) > 0)
        stats.tasksScheduled = state.tasksScheduled;
    return stats;
}
/**
 * Chain-write paths whose payload targets ANOTHER pin — the "never interact
 * with the same pin twice" rule applies to exactly these. Original posts
 * (buzz/note/question/rev) have no target and skip the check.
 */
const INTERACTION_TARGETS = [
    { path: '/protocols/paylike', action: 'liked', payloadFields: ['likeTo'] },
    { path: '/protocols/paycomment', action: 'commented', payloadFields: ['commentTo'] },
    { path: '/protocols/simpleanswer', action: 'answered', payloadFields: ['answerTo'] },
    { path: '/protocols/agentpedia/challenge', action: 'challenged', payloadFields: ['targetRev', 'target_rev'] },
];
/**
 * Re-derive one bot's surf receipts from a chain-history write record
 * (reconciliation): the row's own pin is always a 'posted' receipt (the bot
 * published it), and an interaction payload yields its target receipt on
 * top. Used to backfill the seen ledger before a surf run, so receipts lost
 * to a crash/kill mid-run can never cause a paid duplicate interaction.
 */
function surfReceiptsFromChainWriteRecord(record) {
    const receipts = [];
    const ownPinId = String(record.pinId ?? '').trim();
    if (ownPinId)
        receipts.push({ pinId: ownPinId, action: 'posted' });
    const target = extractInteractionTarget({
        path: String(record.path ?? ''),
        payload: String(record.contentText ?? ''),
    });
    if (target)
        receipts.push(target);
    return receipts;
}
/**
 * Best-effort (target pinId, interaction action) extraction from a chain
 * write. Returns null for original posts and for unparsable payloads — those
 * writes are budget-counted but never duplicate-blocked.
 */
function extractInteractionTarget(metaidData) {
    const pinPath = String(metaidData.path ?? '').trim().toLowerCase();
    if (!pinPath)
        return null;
    const spec = INTERACTION_TARGETS.find((entry) => entry.path === pinPath);
    if (!spec)
        return null;
    let payload;
    if (typeof metaidData.payload === 'string') {
        try {
            const parsed = JSON.parse(metaidData.payload);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
                return null;
            payload = parsed;
        }
        catch {
            return null;
        }
    }
    else if (metaidData.payload && typeof metaidData.payload === 'object' && !Array.isArray(metaidData.payload)) {
        payload = metaidData.payload;
    }
    else {
        return null;
    }
    for (const field of spec.payloadFields) {
        const value = payload[field];
        if (typeof value === 'string' && value.trim()) {
            return { pinId: value.trim(), action: spec.action };
        }
    }
    return null;
}
/**
 * The surf session's single chain-write choke point (IDBots review P2.1 +
 * P2.3). Three rules before the wallet is touched:
 *
 * 0. Self-interaction block: liking, answering, or challenging the bot's OWN
 *    pin is chain spam — rejected without spending budget, against the local
 *    chain-history writes ledger (isOwnPin; best-effort, pins published
 *    elsewhere are unknown). Comments on own pins stay allowed: replying in
 *    your own thread is how the inbox step works.
 * 1. Duplicate-interaction guard: targeting a pin this bot already engaged
 *    with an equal-or-stronger action — earlier in THIS run (state.interactions)
 *    or in a previous surf (the seen ledger via getSeenAction) — is rejected
 *    WITHOUT spending budget. Read/save-level ledger entries never block an
 *    interaction: liking a pin you only bookmarked yesterday is fine.
 * 2. Budget hard ceiling: write attempts beyond state.interactionBudget are
 *    rejected with guidance to finish the run report. Budget 0 refuses every
 *    write while learning tools keep working.
 */
function createSurfChainWriteGuard(deps) {
    const { write, state, getSeenAction, isOwnPin } = deps;
    const budget = Math.max(0, Math.floor(state.interactionBudget) || 0);
    return async (input) => {
        const target = extractInteractionTarget(input);
        if (target && target.action !== 'commented') {
            let own = false;
            try {
                own = await isOwnPin?.(target.pinId) === true;
            }
            catch {
                // A sick ledger must not block chain writes — the in-run record and
                // the budget ceiling still hold.
                own = false;
            }
            if (own) {
                throw new Error(`Pin ${target.pinId} is YOUR OWN pin — ${target.action === 'liked' ? 'liking' : target.action === 'answered' ? 'answering' : 'challenging'} yourself is chain spam (replying in your own thread via comment is fine and needs no check). Pick a different pin; this attempt did not spend the interaction budget.`);
            }
        }
        if (target) {
            const attemptedRank = store_js_1.SEEN_ACTION_RANK[target.action];
            let ledgerAction = null;
            try {
                ledgerAction = await getSeenAction?.(target.pinId) ?? null;
            }
            catch {
                // A sick ledger must not block chain writes — the in-run record and
                // the budget ceiling still hold.
                ledgerAction = null;
            }
            const onRecordRank = Math.max(state.interactions?.[target.pinId] ?? -1, ledgerAction ? store_js_1.SEEN_ACTION_RANK[ledgerAction] : -1);
            if (onRecordRank >= attemptedRank) {
                throw new Error(`Already interacted with pin ${target.pinId} (${target.action} or a stronger action is on record from this run or a previous surf). Never interact with the same pin twice — pick a different pin. This attempt did not spend the interaction budget.`);
            }
        }
        const used = state.writesUsed ?? 0;
        if (used >= budget) {
            throw new Error(`MetaWeb surf interaction budget exhausted for this run (${budget} chain writes allowed). Stop interacting and write the final surf report now.`);
        }
        state.writesUsed = used + 1;
        const result = await write(input);
        if (target) {
            const interactions = state.interactions ?? (state.interactions = {});
            interactions[target.pinId] = Math.max(interactions[target.pinId] ?? -1, store_js_1.SEEN_ACTION_RANK[target.action]);
        }
        else {
            // Original posts: record the 'posted' receipt so the bot's own fresh
            // content never comes back as "new" (or gets self-engaged later).
            const newPinId = typeof result?.pinId === 'string' ? result.pinId.trim() : '';
            if (newPinId)
                (state.postedPinIds ??= []).push(newPinId);
        }
        return result;
    };
}
