"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SURF_TOOL_ALLOWLIST = exports.SURF_SCHEDULED_TASK_CAP = exports.SURF_TURN_MAX_TOOL_STEPS = void 0;
exports.withSurfToolLoopContract = withSurfToolLoopContract;
exports.runSurfTurnWithTools = runSurfTurnWithTools;
const prompt_js_1 = require("./prompt.js");
/** Study(12)/qa-surf(24) ceilings are far too low for a full surf: the wall
 *  clock watchdog is the real bound; this is the runaway safety net. */
exports.SURF_TURN_MAX_TOOL_STEPS = 96;
/** Hard cap of scheduled tasks per surf run (IDBots parity). */
exports.SURF_SCHEDULED_TASK_CAP = 2;
const MAX_TOOL_RESULT_CHARS = 12_000;
const READ_TOOLS = [
    'search_metaweb',
    'read_metaweb_pin',
    'read_metaweb_pins_batch',
    'metaweb_pin_versions',
    'metaprotocol_registry',
    'search_qa',
    'list_latest_questions',
    'get_question_answers',
    'search_social_posts',
    'social_post_detail',
    'social_post_comments',
    'omni_read',
];
const MEMORY_TOOLS = [
    'knowledge_base_list',
    'knowledge_base_query',
    'knowledge_base_add_document',
    'knowledge_base_learn',
    'procedure_save',
    'procedure_recall',
    'knowledge_upsert',
    'knowledge_recall',
];
const WRITE_TOOLS = [
    'like_pin',
    'comment_pin',
    'post_simpleanswer',
    'post_simplequestion',
    'post_buzz',
    'post_simplenote',
    'agentpedia_challenge',
    'create_scheduled_task',
];
/** IDBots METAWEB_SURF_TOOL_ALLOWLIST parity (memory tools gated separately). */
exports.SURF_TOOL_ALLOWLIST = new Set([
    ...READ_TOOLS,
    ...MEMORY_TOOLS,
    ...WRITE_TOOLS,
]);
function truncateResult(text, maxChars) {
    if (text.length <= maxChars)
        return text;
    return `${text.slice(0, maxChars)}\n…(truncated)`;
}
function parseJsonFence(reply) {
    const fences = [...String(reply ?? '').matchAll(/```(?:json)?\s*([\s\S]*?)```/gu)];
    const last = fences[fences.length - 1];
    if (!last)
        return null;
    try {
        const parsed = JSON.parse(last[1]);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : null;
    }
    catch {
        return null;
    }
}
function asTrimmedString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function optionalInt(value) {
    const n = Number(value);
    return Number.isInteger(n) ? n : undefined;
}
function parseScheduledTaskSpec(args) {
    const name = asTrimmedString(args.name);
    if (!name)
        return { error: 'name is required.' };
    if (name.length > 80)
        return { error: 'name must be at most 80 characters.' };
    const prompt = asTrimmedString(args.prompt);
    if (!prompt)
        return { error: 'prompt is required.' };
    if (prompt.length > 4000)
        return { error: 'prompt must be at most 4000 characters — make it self-contained but tight.' };
    const scheduleType = asTrimmedString(args.scheduleType ?? args.schedule_type);
    if (scheduleType === 'at') {
        const at = asTrimmedString(args.at);
        if (!at)
            return { error: 'scheduleType "at" requires `at` (local datetime, e.g. 2026-09-16T09:30:00, no timezone suffix).' };
        if (/z$/i.test(at))
            return { error: '`at` must be a LOCAL datetime without timezone suffix (drop the trailing Z).' };
        const ms = Date.parse(at);
        if (!Number.isFinite(ms))
            return { error: '`at` is not a parseable datetime.' };
        if (ms <= Date.now() + 30_000)
            return { error: '`at` must be at least 30 seconds in the future.' };
        return { spec: { name, prompt, scheduleType: 'at', at } };
    }
    if (scheduleType === 'interval') {
        const intervalValue = optionalInt(args.intervalValue ?? args.interval_value);
        const intervalUnit = asTrimmedString(args.intervalUnit ?? args.interval_unit) || 'hour';
        if (intervalValue === undefined || intervalValue <= 0)
            return { error: 'scheduleType "interval" requires a positive integer intervalValue.' };
        if (!['minute', 'hour', 'day'].includes(intervalUnit))
            return { error: 'intervalUnit must be minute, hour, or day.' };
        return { spec: { name, prompt, scheduleType: 'interval', intervalValue, intervalUnit: intervalUnit } };
    }
    if (scheduleType === 'cron') {
        const cron = asTrimmedString(args.cron);
        if (!cron)
            return { error: 'scheduleType "cron" requires a 5-field cron expression.' };
        return { spec: { name, prompt, scheduleType: 'cron', cron } };
    }
    return { error: 'scheduleType must be at, interval, or cron.' };
}
/**
 * Prepend the json-fence tool-loop contract (OAC's executor speaks fences,
 * not native tool calls) to the IDBots surf session prompt. The tool list
 * mirrors the allowlist 1:1; the DEGRADED variant drops the memory tools.
 */
function withSurfToolLoopContract(prompt, options = {}) {
    const memoryEnabled = options.memoryEnabled !== false;
    const memoryTools = [
        '- knowledge_base_list {} / knowledge_base_query {query, knowledgeBaseId?} — see what you already keep before saving duplicates.',
        '- knowledge_base_add_document {title, content, pinId} — save a substantial body (metaweb provenance).',
        '- knowledge_base_learn {} — index newly saved documents (run ONCE, after your last save).',
        '- procedure_save {title, steps, pitfalls?, triggerText?, sourcePinIds?} — distill a REPEATABLE workflow.',
        '- procedure_recall {query} / knowledge_recall {query?, kind?} / knowledge_upsert {topic, summary, kind?} — memory layers.',
    ];
    return [
        'Each turn, reply with exactly ONE ```json fence containing either a tool call or (when your surf is done) your final report.',
        '',
        'Tool call (the executor runs it and returns the result as your next input):',
        '```json',
        '{"tool":"read_metaweb_pins_batch","args":{"pinIds":["…","…"]}}',
        '```',
        '',
        'Available tools:',
        '- read_metaweb_pins_batch {pinIds: [≤50 ids]} — deep-read a whole shortlist in ONE call; a single read_metaweb_pin {pinId} continues a truncated:true entry or a search discovery.',
        '- metaweb_pin_versions {pinId} — the modify chain of one pin.',
        '- search_metaweb {query} / search_qa {query, answered?, sort?, size?, cursor?} — cross-protocol and Q&A keyword search (bilingual queries).',
        '- list_latest_questions {maxAnswers?, sort?, size?, cursor?} — question feed; maxAnswers=0 = unanswered queue.',
        '- get_question_answers {question_pin_id, size?, cursor?} — one question with ranked answers.',
        '- search_social_posts {query, size?, cursor?} — full-text social (buzz) search.',
        '- social_post_detail {pinId} / social_post_comments {pinId, size?, cursor?} — post body / its comment thread.',
        '- metaprotocol_registry {size?, cursor?} — registered /protocols/* declarations.',
        '- omni_read {action, …} — raw read-only indexer queries (user/pin/file/buzz/notifications low-level fallback).',
        '- like_pin {pin_id, is_like} — 1 like / -1 dislike / 0 cancel on any pin.',
        '- comment_pin {pin_id, content} — comment on any pin (joins its public thread).',
        '- post_simpleanswer {answer_to, content} — answer a question.',
        '- post_simplequestion {title, content?} — ask a question (rare).',
        '- post_buzz {content} / post_simplenote {title, content} — publish a post / an article (rare).',
        '- agentpedia_challenge {target_rev, reason, detail} — dispute one encyclopedia revision.',
        '- create_scheduled_task {name, prompt, scheduleType: at|interval|cron, at?|intervalValue+intervalUnit?|cron?} — hand off real work to a later full work session (cap 2).',
        ...(memoryEnabled ? memoryTools : ['(Memory is OFF tonight: no knowledge_base_*/knowledge_*/procedure_* tools — note would-be saves in "notes".)']),
        '',
        'Your final report (the last fence you emit — nothing after it):',
        '```json',
        '{"summary": "...", "readPinIds": [], "savedPinIds": [], "likedPinIds": [], "commentedPinIds": [], "answeredPinIds": [], "postedPinIds": [], "challengedPinIds": [], "knowledgePoints": 0, "inboxHandled": 0, "discoveredProtocols": [], "notes": "..."}',
        '```',
        '',
        '---',
        '',
        prompt,
    ].join('\n');
}
/**
 * Run the surf session. Returns the final report text (the last json fence
 * the model emitted as its report). The caller parses it with
 * parseSurfRunReport; receipts live on `writeState`.
 */
async function runSurfTurnWithTools(prompt, deps) {
    const maxSteps = deps.maxSteps ?? exports.SURF_TURN_MAX_TOOL_STEPS;
    const maxResultChars = deps.maxResultChars ?? MAX_TOOL_RESULT_CHARS;
    const memoryEnabled = deps.memoryEnabled !== false;
    const availableTools = [...exports.SURF_TOOL_ALLOWLIST].filter((name) => memoryEnabled || !MEMORY_TOOLS.includes(name));
    const history = [
        { role: 'user', content: prompt },
    ];
    for (let step = 0; step < maxSteps; step += 1) {
        const reply = await deps.runLlm(history);
        history.push({ role: 'assistant', content: reply });
        const action = parseJsonFence(reply);
        if (!action) {
            history.push({
                role: 'user',
                content: 'Your reply had no ```json fence. Reply again with exactly one fence: a tool call {"tool":…,"args":{…}} or your final surf report.',
            });
            continue;
        }
        // Final report: the surf contract is a `summary` field (prompt step 7).
        if (typeof action.summary === 'string' && action.summary.trim()) {
            return JSON.stringify(action);
        }
        const toolName = typeof action.tool === 'string' ? action.tool : '';
        if (!exports.SURF_TOOL_ALLOWLIST.has(toolName)) {
            history.push({
                role: 'user',
                content: `Tool "${toolName || '(missing)'}" is not available in this session. Available: ${availableTools.join(', ')}. Reply with a tool call or the final report.`,
            });
            continue;
        }
        if (!memoryEnabled && MEMORY_TOOLS.includes(toolName)) {
            history.push({
                role: 'user',
                content: `Tool "${toolName}" needs memory, which is OFF tonight (DEGRADED surf). Note the would-be save in your final report "notes" and keep going.`,
            });
            continue;
        }
        const args = (action.args && typeof action.args === 'object' && !Array.isArray(action.args)
            ? action.args
            : {});
        let result;
        try {
            if (toolName === 'create_scheduled_task') {
                const used = deps.writeState.tasksScheduled ?? 0;
                if (used >= exports.SURF_SCHEDULED_TASK_CAP) {
                    throw new Error(`Hard cap reached: at most ${exports.SURF_SCHEDULED_TASK_CAP} scheduled tasks per surf run. Put further ideas in the final report "notes" instead.`);
                }
                const parsed = parseScheduledTaskSpec(args);
                if ('error' in parsed)
                    throw new Error(parsed.error);
                result = await deps.tools.createScheduledTask(parsed.spec);
                deps.writeState.tasksScheduled = used + 1;
            }
            else if (toolName === 'knowledge_base_add_document') {
                const used = deps.writeState.kbAddsUsed ?? 0;
                if (used >= (deps.writeState.kbBudget ?? prompt_js_1.SURF_KB_ADD_BUDGET)) {
                    throw new Error(`Knowledge-base add budget exhausted for this run (${deps.writeState.kbBudget ?? prompt_js_1.SURF_KB_ADD_BUDGET} metaweb documents). Stop saving; distill the rest into your final report notes.`);
                }
                result = await deps.tools.addDocument({
                    title: asTrimmedString(args.title).slice(0, 200),
                    content: String(args.content ?? '').slice(0, 500_000),
                    ...(asTrimmedString(args.pinId) ? { pinId: asTrimmedString(args.pinId) } : {}),
                });
                deps.writeState.kbAddsUsed = used + 1;
            }
            else {
                result = await dispatchToolCall(toolName, args, deps.tools);
            }
        }
        catch (error) {
            result = `TOOL ERROR: ${error instanceof Error ? error.message : String(error)}`;
        }
        history.push({ role: 'user', content: truncateResult(result, maxResultChars) });
    }
    // Step ceiling hit without a final report: hand back whatever the model can
    // still produce — the caller parses a (possibly empty) report and the run
    // still settles honestly.
    return JSON.stringify({
        summary: 'Surf turn hit the tool-step ceiling before emitting a final report.',
        notes: 'Step ceiling reached; partial results are in the run stats.',
    });
}
async function dispatchToolCall(toolName, args, tools) {
    switch (toolName) {
        case 'search_metaweb': {
            const query = asTrimmedString(args.query ?? args.q);
            if (!query)
                throw new Error('query is required.');
            return tools.searchMetaweb({ query });
        }
        case 'read_metaweb_pin': {
            const pinId = asTrimmedString(args.pinId ?? args.pin_id);
            if (!pinId)
                throw new Error('pinId is required.');
            return tools.readMetawebPin({ pinId });
        }
        case 'read_metaweb_pins_batch': {
            const raw = args.pinIds ?? args.pin_ids;
            if (!Array.isArray(raw))
                throw new Error('pinIds (array, at most 50) is required.');
            const pinIds = raw.map((item) => asTrimmedString(item)).filter(Boolean);
            if (pinIds.length === 0)
                throw new Error('pinIds must contain at least one id.');
            if (pinIds.length > 50)
                throw new Error('at most 50 pinIds per batch call.');
            return tools.readMetawebPinsBatch({ pinIds });
        }
        case 'metaweb_pin_versions': {
            const pinId = asTrimmedString(args.pinId ?? args.pin_id);
            if (!pinId)
                throw new Error('pinId is required.');
            return tools.metawebPinVersions({ pinId });
        }
        case 'metaprotocol_registry': {
            return tools.metaprotocolRegistry({
                ...(optionalInt(args.size) !== undefined ? { size: optionalInt(args.size) } : {}),
                ...(asTrimmedString(args.cursor) ? { cursor: asTrimmedString(args.cursor) } : {}),
            });
        }
        case 'search_qa': {
            const query = asTrimmedString(args.query);
            if (!query)
                throw new Error('query is required.');
            return tools.searchQa({
                query,
                ...(args.answered === true || args.answered === false ? { answered: args.answered } : {}),
                ...(asTrimmedString(args.sort) ? { sort: asTrimmedString(args.sort) } : {}),
                ...(optionalInt(args.size) !== undefined ? { size: optionalInt(args.size) } : {}),
                ...(asTrimmedString(args.cursor) ? { cursor: asTrimmedString(args.cursor) } : {}),
            });
        }
        case 'list_latest_questions': {
            return tools.listLatestQuestions({
                ...(optionalInt(args.maxAnswers ?? args.max_answers) !== undefined
                    ? { maxAnswers: optionalInt(args.maxAnswers ?? args.max_answers) }
                    : {}),
                ...(asTrimmedString(args.sort) ? { sort: asTrimmedString(args.sort) } : {}),
                ...(optionalInt(args.size) !== undefined ? { size: optionalInt(args.size) } : {}),
                ...(asTrimmedString(args.cursor) ? { cursor: asTrimmedString(args.cursor) } : {}),
            });
        }
        case 'get_question_answers': {
            const questionPinId = asTrimmedString(args.questionPinId ?? args.question_pin_id ?? args.pinId ?? args.pin_id);
            if (!questionPinId)
                throw new Error('question_pin_id is required.');
            return tools.getQuestionAnswers({
                questionPinId,
                ...(optionalInt(args.size) !== undefined ? { size: optionalInt(args.size) } : {}),
                ...(asTrimmedString(args.cursor) ? { cursor: asTrimmedString(args.cursor) } : {}),
            });
        }
        case 'search_social_posts': {
            const query = asTrimmedString(args.query ?? args.keyword);
            if (!query)
                throw new Error('query is required.');
            return tools.searchSocialPosts({
                query,
                ...(optionalInt(args.size) !== undefined ? { size: optionalInt(args.size) } : {}),
                ...(asTrimmedString(args.cursor) ? { cursor: asTrimmedString(args.cursor) } : {}),
            });
        }
        case 'social_post_detail': {
            const pinId = asTrimmedString(args.pinId ?? args.pin_id);
            if (!pinId)
                throw new Error('pinId is required.');
            return tools.socialPostDetail({ pinId });
        }
        case 'social_post_comments': {
            const pinId = asTrimmedString(args.pinId ?? args.pin_id);
            if (!pinId)
                throw new Error('pinId is required.');
            return tools.socialPostComments({
                pinId,
                ...(optionalInt(args.size) !== undefined ? { size: optionalInt(args.size) } : {}),
                ...(asTrimmedString(args.cursor) ? { cursor: asTrimmedString(args.cursor) } : {}),
            });
        }
        case 'omni_read': {
            return tools.omniRead(args);
        }
        case 'like_pin': {
            const pinId = asTrimmedString(args.pin_id ?? args.pinId);
            if (!pinId)
                throw new Error('pin_id is required.');
            const rawLike = args.is_like ?? args.isLike;
            const isLike = rawLike === -1 || rawLike === '-1' ? -1 : rawLike === 0 || rawLike === '0' ? 0 : 1;
            return tools.chainWrite({
                path: '/protocols/paylike',
                payload: { isLike, likeTo: pinId },
                ...(asTrimmedString(args.network) ? { network: asTrimmedString(args.network) } : {}),
            });
        }
        case 'comment_pin': {
            const pinId = asTrimmedString(args.pin_id ?? args.pinId);
            if (!pinId)
                throw new Error('pin_id is required.');
            const content = asTrimmedString(args.content);
            if (!content)
                throw new Error('content is required.');
            return tools.chainWrite({
                path: '/protocols/paycomment',
                payload: { commentTo: pinId, content, contentType: 'text/markdown' },
                ...(asTrimmedString(args.network) ? { network: asTrimmedString(args.network) } : {}),
            });
        }
        case 'post_simpleanswer': {
            const answerTo = asTrimmedString(args.answer_to ?? args.answerTo);
            if (!answerTo)
                throw new Error('answer_to (the question pinId) is required.');
            const content = asTrimmedString(args.content);
            if (!content)
                throw new Error('content is required.');
            return tools.chainWrite({
                path: '/protocols/simpleanswer',
                payload: { answerTo, content, contentType: 'text/markdown' },
                ...(asTrimmedString(args.network) ? { network: asTrimmedString(args.network) } : {}),
            });
        }
        case 'post_simplequestion': {
            const title = asTrimmedString(args.title);
            if (!title)
                throw new Error('title is required.');
            return tools.chainWrite({
                path: '/protocols/simplequestion',
                payload: { title, ...(asTrimmedString(args.content) ? { content: asTrimmedString(args.content), contentType: 'text/markdown' } : {}) },
                ...(asTrimmedString(args.network) ? { network: asTrimmedString(args.network) } : {}),
            });
        }
        case 'post_buzz': {
            const content = asTrimmedString(args.content);
            if (!content)
                throw new Error('content is required.');
            return tools.chainWrite({
                path: '/protocols/simplebuzz',
                payload: { content, contentType: 'text/plain;utf-8', attachments: [] },
                ...(asTrimmedString(args.network) ? { network: asTrimmedString(args.network) } : {}),
            });
        }
        case 'post_simplenote': {
            const title = asTrimmedString(args.title);
            const content = asTrimmedString(args.content);
            if (!title || !content)
                throw new Error('title and content are required.');
            return tools.chainWrite({
                path: '/protocols/simplenote',
                payload: { title, content, contentType: 'text/markdown', encryption: '0', createTime: Math.floor(Date.now() / 1000) },
                ...(asTrimmedString(args.network) ? { network: asTrimmedString(args.network) } : {}),
            });
        }
        case 'agentpedia_challenge': {
            const targetRev = asTrimmedString(args.target_rev ?? args.targetRev);
            if (!targetRev)
                throw new Error('target_rev (the disputed rev pinId) is required.');
            const reason = asTrimmedString(args.reason);
            if (!['vandalism', 'copyright', 'neutrality', 'factual', 'editwar', 'other'].includes(reason)) {
                throw new Error('reason must be one of vandalism, copyright, neutrality, factual, editwar, other.');
            }
            const detail = asTrimmedString(args.detail);
            if (detail.length < 8 || detail.length > 512)
                throw new Error('detail must be 8-512 characters.');
            return tools.chainWrite({
                path: '/protocols/agentpedia/challenge',
                payload: {
                    v: 1,
                    targetRev,
                    reason,
                    detail,
                    proposed: args.proposed_outcome || args.proposed_revert_to
                        ? { outcome: asTrimmedString(args.proposed_outcome) || null, revertTo: asTrimmedString(args.proposed_revert_to) || null }
                        : null,
                },
                ...(asTrimmedString(args.network) ? { network: asTrimmedString(args.network) } : {}),
            });
        }
        case 'knowledge_base_list':
            return tools.listKnowledgeBases();
        case 'knowledge_base_query': {
            const query = asTrimmedString(args.query);
            if (!query)
                throw new Error('query is required.');
            return tools.queryKnowledgeBases({
                query,
                ...(asTrimmedString(args.knowledgeBaseId ?? args.knowledge_base_id)
                    ? { knowledgeBaseId: asTrimmedString(args.knowledgeBaseId ?? args.knowledge_base_id) }
                    : {}),
            });
        }
        case 'knowledge_base_learn':
            return tools.learnKnowledgeBase();
        case 'procedure_save': {
            const title = asTrimmedString(args.title);
            const steps = Array.isArray(args.steps)
                ? args.steps.map((item) => asTrimmedString(item)).filter(Boolean)
                : [];
            if (!title || steps.length === 0)
                throw new Error('title and steps are required.');
            return tools.saveProcedure({
                title,
                steps,
                ...(Array.isArray(args.pitfalls) ? { pitfalls: args.pitfalls.map((item) => asTrimmedString(item)).filter(Boolean) } : {}),
                ...(asTrimmedString(args.triggerText ?? args.trigger_text) ? { triggerText: asTrimmedString(args.triggerText ?? args.trigger_text) } : {}),
                ...(Array.isArray(args.sourcePinIds ?? args.source_pin_ids)
                    ? {
                        sourcePinIds: (args.sourcePinIds ?? args.source_pin_ids)
                            .map((item) => asTrimmedString(item))
                            .filter(Boolean),
                    }
                    : {}),
            });
        }
        case 'procedure_recall': {
            const query = asTrimmedString(args.query);
            if (!query)
                throw new Error('query is required.');
            return tools.recallProcedures({ query });
        }
        case 'knowledge_upsert': {
            const topic = asTrimmedString(args.topic);
            const summary = asTrimmedString(args.summary);
            if (!topic || !summary)
                throw new Error('topic and summary are required.');
            return tools.upsertKnowledge({
                topic,
                summary,
                ...(asTrimmedString(args.kind) ? { kind: asTrimmedString(args.kind) } : {}),
            });
        }
        case 'knowledge_recall':
            return tools.recallKnowledge({
                ...(asTrimmedString(args.query) ? { query: asTrimmedString(args.query) } : {}),
                ...(asTrimmedString(args.kind) ? { kind: asTrimmedString(args.kind) } : {}),
            });
        default:
            throw new Error(`Tool "${toolName}" is allowlisted but not dispatched — internal error.`);
    }
}
