"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSubstantiveMemoryText = isSubstantiveMemoryText;
exports.buildTurnMemoryExtractionPrompts = buildTurnMemoryExtractionPrompts;
exports.parseTurnMemoryExtractionPayload = parseTurnMemoryExtractionPayload;
/** Substantive-turn gate (IDBots isSubstantiveMemoryText): ≥8 chars of
 * non-code-block text — tiny acknowledgements skip the LLM entirely. */
function isSubstantiveMemoryText(userText) {
    const stripped = String(userText ?? '').replace(/```[\s\S]*?```/g, ' ').trim();
    return stripped.length >= 8;
}
const MAX_USER_CHARS = 4000;
const MAX_ASSISTANT_CHARS = 2000;
function truncateUtf16Units(text, maxUnits) {
    return Array.from(text).slice(0, maxUnits).join('');
}
function buildTurnMemoryExtractionPrompts(input) {
    const userText = truncateUtf16Units(input.userText.trim(), MAX_USER_CHARS);
    const assistantText = truncateUtf16Units((input.assistantText ?? '').trim(), MAX_ASSISTANT_CHARS);
    const guardClause = input.guardLevel === 'strict'
        ? 'strict: extract only unmistakable durable facts'
        : input.guardLevel === 'relaxed'
            ? 'relaxed: plausible durable facts are fine too'
            : 'standard: extract clear durable facts';
    const system = [
        'You extract long-term memories worth keeping from ONE assistant-conversation turn. The user may write in ANY language — extract across languages, never assume Chinese or English.',
        'Extract durable personal facts, durable preferences, and explicit remember/forget instructions the USER gave (e.g. "remember that ...", "olvida que ...").',
        'Never extract: questions, transient context (today\'s news, one-off tasks, current debugging), procedural/command output, or anything the assistant merely said about itself unless the user confirmed it as a durable preference.',
        `Guard level — ${guardClause}.`,
        input.implicitEnabled
            ? 'Implicit-memory mode: implicit facts AND explicit instructions both count.'
            : 'Explicit-only mode: extract ONLY explicit remember/forget instructions from the user.',
        'Each "text" carries the fact itself in the user\'s own language, with the instruction verb stripped. Do not translate.',
        'Return strict JSON only: {"changes":[{"action":"add"|"delete","text":"...","is_explicit":true|false}]} — at most 2 implicit adds, 2 explicit adds, 2 deletes; return {"changes":[]} when nothing qualifies.',
    ].join('\n');
    const user = JSON.stringify({
        user_message: userText,
        assistant_message: assistantText,
        guard_level: input.guardLevel,
        implicit_enabled: input.implicitEnabled,
    });
    return { system, user };
}
/** Tolerant parse of the extraction payload: strips code fences, takes the
 * outermost braces, drops malformed entries, enforces the 2/2/2 caps. */
function parseTurnMemoryExtractionPayload(raw) {
    if (!raw || !raw.trim())
        return null;
    let candidate = raw.trim();
    candidate = candidate.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');
    if (firstBrace < 0 || lastBrace <= firstBrace)
        return null;
    let parsed;
    try {
        parsed = JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
    }
    catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return null;
    const changes = parsed.changes;
    if (!Array.isArray(changes))
        return null;
    const result = [];
    let implicitAdds = 0;
    let explicitAdds = 0;
    let deletes = 0;
    for (const row of changes) {
        if (!row || typeof row !== 'object' || Array.isArray(row))
            continue;
        const entry = row;
        const action = entry.action === 'delete' ? 'delete' : entry.action === 'add' ? 'add' : null;
        const text = typeof entry.text === 'string' ? entry.text.trim() : '';
        if (!action || !text)
            continue;
        const isExplicit = entry.is_explicit === true || entry.isExplicit === true;
        if (action === 'add') {
            if (isExplicit) {
                if (explicitAdds >= 2)
                    continue;
                explicitAdds += 1;
            }
            else {
                if (implicitAdds >= 2)
                    continue;
                implicitAdds += 1;
            }
        }
        else {
            if (deletes >= 2)
                continue;
            deletes += 1;
        }
        result.push({ action, text, isExplicit });
    }
    return result;
}
