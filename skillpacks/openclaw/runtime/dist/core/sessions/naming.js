"use strict";
/**
 * Session naming (local session adapters P1).
 *
 * Directory names default to `<dir>-<agent>` (`api-claude`), get `-2`/`-3`
 * on collision, and stay with their conversation: a re-registered session
 * key keeps the name it already had (reason-network's name-keeping rule),
 * and a NEW session never pushes a kept name aside — it takes the next free
 * suffix. A name someone asked for (`--name`, later `claim`/`listen --as`)
 * is honored when free and suffixed when not.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.slugifySessionName = slugifySessionName;
exports.shortAgentName = shortAgentName;
exports.defaultSessionName = defaultSessionName;
exports.resolveSessionName = resolveSessionName;
const AGENT_SHORT_NAMES = {
    'claude-code': 'claude',
    codex: 'codex',
};
function slugifySessionName(raw) {
    const slug = raw
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40)
        .replace(/-+$/g, '');
    return slug;
}
function shortAgentName(agent) {
    return AGENT_SHORT_NAMES[agent] ?? agent;
}
/** `<basename(cwd)>-<agent>`, slugified; `session-<agent>` without a usable cwd. */
function defaultSessionName(input) {
    const base = input.cwd ? slugifySessionName(input.cwd.split('/').filter(Boolean).pop() ?? '') : '';
    return `${base || 'session'}-${shortAgentName(input.agent)}`;
}
/**
 * First free name: the requested/default name when untaken, else `-2`,
 * `-3`, … `takenNames` should already exclude the session being named.
 */
function resolveSessionName(input) {
    const taken = new Set(input.takenNames);
    const preferred = (input.requested ?? '').trim() || input.defaultName;
    if (!taken.has(preferred)) {
        return preferred;
    }
    for (let suffix = 2; suffix < 1000; suffix += 1) {
        const candidate = `${preferred}-${suffix}`;
        if (!taken.has(candidate)) {
            return candidate;
        }
    }
    // Unreachable in practice (999 collisions); deterministic anyway.
    return `${preferred}-${Date.now()}`;
}
