"use strict";
/**
 * Participation drafts (UI reference F13): the prefilled, mode-aware prompt a
 * human hands to a bot session to join a task. The templates are the IDBots
 * `metatask.participateDraft` / `participateDraftCompetitive` copy ported
 * verbatim with one permitted change (UI ref §8): IDBots tool names are
 * spelled as `metabot metatask …` CLI verbs, in both languages. The UIs never
 * write — they only hand the user this draft.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.suggestParticipateNode = void 0;
exports.buildParticipateDraft = buildParticipateDraft;
const NODE_HINT_EN = ' (node {node} is a good candidate)';
const NODE_HINT_ZH = '（建议从节点 {node} 开始评估）';
const DRAFT_EN = 'Please have the local MetaBot join the on-chain task "{title}" (task root pinId: {root}). Steps: inspect the task with `metabot metatask list` / `metabot metatask get --root <root>` and pick an open node{node_hint}; claim it with `metabot metatask claim --root <root> --node <id> --from <bot>` (the guard validates first); do the work per the node spec and submit with `metabot metatask submit --request-file <json>`; when reviewing, respect the #8/#9 gates (semanticCheck required, failReason on fail) and never review same-side targets. Report the claim and submission pinIds back to me when done.';
const DRAFT_COMPETITIVE_EN = 'Please have the local MetaBot join the on-chain COMPETITIVE task "{title}" (task root pinId: {root}). Competitive mode: there is no node lock and no claiming (`metabot metatask claim` is only an intent signal) — the best verified work wins. Steps: inspect nodes and deps with `metabot metatask list` / `metabot metatask get --root <root>`{node_hint} and pick a node matching your skills; if the node has deps, use `metabot metatask get` to choose one candidate submission pinId per dep to reference (referencing an unverified parent is allowed optimistic pipelining at your own risk); do the work per the node spec, then submit with `metabot metatask submit --request-file <json>` passing parentRefs (one submission pinId per dep; entry nodes omit it). When reviewing others, respect the #8/#9 gates (semanticCheck required, failReason on fail) and never review your own submission. Report the submission pinId back to me when done.';
const DRAFT_ZH = '请让本机 MetaBot 参与链上任务「{title}」（任务根 pinId：{root}）。步骤：先用 `metabot metatask list` / `metabot metatask get --root <root>` 查看该任务的开放节点{node_hint}，从中挑选一个与技能匹配的节点，用 `metabot metatask claim --root <root> --node <id> --from <bot>` 认领（认领前守卫会先校验），按节点 spec 完成工作并用 `metabot metatask submit --request-file <json>` 提交；复核时遵守 #8/#9 门禁（semanticCheck 必填、fail 必带 failReason）且同侧目标不可复核。完成后向我汇报认领与提交的 pinId。';
const DRAFT_COMPETITIVE_ZH = '请让本机 MetaBot 参与链上竞赛任务「{title}」（任务根 pinId：{root}）。这是 competitive 模式：没有节点锁，无需认领（`metabot metatask claim` 仅为意向声明），谁先做出高质量成果并通过复核谁就赢。步骤：先用 `metabot metatask list` / `metabot metatask get --root <root>` 查看任务的节点与依赖{node_hint}，挑选与技能匹配的节点；若该节点有 deps 前驱，先用 `metabot metatask get` 确认各前驱上你要引用的候选提交 pinId（未验证的父提交也可引用，属乐观抢跑、自担风险）；按节点 spec 完成工作后，用 `metabot metatask submit --request-file <json>` 提交并带上 parentRefs（每个 dep 引用一个提交 pinId；入口节点省略）。复核他人提交时遵守 #8/#9 门禁（semanticCheck 必填、fail 必带 failReason）且不可复核自己的提交。完成后向我汇报提交的 pinId。';
/**
 * Suggested first node: among open nodes prefer entry nodes (deps: []) with
 * the fewest competing candidates, then the fewest deps, then id order; when
 * nothing is open the draft carries no hint.
 */
const suggestParticipateNode = (projection) => {
    const open = Object.values(projection.nodeStates ?? {}).filter((node) => node.status !== 'verified');
    if (open.length === 0)
        return null;
    const contenders = open.filter((node) => (node.deps ?? []).length === 0);
    const pool = contenders.length > 0 ? contenders : open;
    const ranked = [...pool].sort((left, right) => {
        const lc = (left.submissions ?? []).length;
        const rc = (right.submissions ?? []).length;
        if (lc !== rc)
            return lc - rc;
        const ld = (left.deps ?? []).length;
        const rd = (right.deps ?? []).length;
        if (ld !== rd)
            return ld - rd;
        return left.id.length !== right.id.length ? left.id.length - right.id.length : left.id < right.id ? -1 : 1;
    });
    return ranked[0]?.id ?? null;
};
exports.suggestParticipateNode = suggestParticipateNode;
/** Fill one template's {title}/{root}/{node_hint} placeholders. */
const render = (template, projection, node, nodeHint) => {
    const hint = node ? nodeHint.replace('{node}', node) : '';
    return template
        .replace('{title}', projection.title ?? projection.rootPinId)
        .replace('{root}', projection.rootPinId)
        .replace('{node_hint}', hint);
};
function buildParticipateDraft(projection, options = {}) {
    const lang = options.lang === 'zh' ? 'zh' : 'en';
    const mode = projection.policy?.mode === 'competitive' ? 'competitive' : 'tree';
    const node = options.node !== undefined ? options.node : (0, exports.suggestParticipateNode)(projection);
    const template = mode === 'competitive'
        ? (lang === 'zh' ? DRAFT_COMPETITIVE_ZH : DRAFT_COMPETITIVE_EN)
        : (lang === 'zh' ? DRAFT_ZH : DRAFT_EN);
    return {
        lang,
        mode,
        node,
        text: render(template, projection, node, lang === 'zh' ? NODE_HINT_ZH : NODE_HINT_EN),
    };
}
