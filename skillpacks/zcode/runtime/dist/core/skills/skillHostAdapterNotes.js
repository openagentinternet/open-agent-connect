"use strict";
/**
 * Per-skill, per-host extra markdown rendered into the
 * {{HOST_ADAPTER_SECTION}} placeholder of SKILL templates. Shared by the
 * skillpacks build (scripts/build-metabot-skillpacks.mjs, via the compiled
 * dist module) and the `oac install` skill renderer so every installed host
 * carries the same adapter knowledge instead of an empty section.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderSkillHostAdapterNote = renderSkillHostAdapterNote;
const IN_APP_BROWSER_HEADING = '### In-App Browser';
const BROWSER_HOST_NOTES = {
    codex: [
        IN_APP_BROWSER_HEADING,
        '',
        'Codex has its own in-app browser. Open every `localUiUrl` returned by the MetaBot CLI inside the Codex in-app browser (its web preview surface) — never in the external system browser, and never through external browser automation such as Playwright.',
    ].join('\n'),
    cursor: [
        IN_APP_BROWSER_HEADING,
        '',
        'Cursor has an integrated Browser Tab beside the chat. Open pages exactly as this skill instructs — through the MetaBot CLI open commands (`browser tab open` first, `browser open` when no Browser page is running); the daemon pushes the page into every open Browser tab, and this works in Cursor like on any other host. Always also present the returned `localUiUrl` as a full absolute-URL markdown link (for example `[AI_Sunny](http://127.0.0.1:10001/browser/metaid/<globalMetaId>)`) so the human can click it: localhost links clicked in Cursor chat open in the integrated Browser Tab when the user\'s Browser Automation setting is "Browser Tab". Never open a `localUiUrl` in the external system browser or through external browser automation such as Playwright.',
    ].join('\n'),
};
function defaultBrowserNote(displayName) {
    return [
        IN_APP_BROWSER_HEADING,
        '',
        `Open pages exactly as this skill instructs — through the MetaBot CLI open commands (\`browser tab open\` first, \`browser open\` when no Browser page is running); the daemon pushes the page into every open Browser page regardless of host. Always also present every \`localUiUrl\` returned by the MetaBot CLI as a clickable absolute-URL markdown link for the human. If this ${displayName} session provides a web preview surface, prefer opening the \`localUiUrl\` there instead of handing it to the external browser; never use the external system browser or external browser automation.`,
    ].join('\n');
}
/**
 * Hosts whose chat client opens Agent Internet URIs directly in a built-in
 * Bot Browser: markdown links (and bare URIs) with these schemes are
 * intercepted client-side, so skills present MetaWeb URI links instead of
 * `http://127.0.0.1:...` localUiUrl links.
 */
const METAWEB_URI_CLIENT_HOSTS = new Set(['dsh']);
function metawebUriPresentation(displayName) {
    return `This ${displayName} client has a built-in Bot Browser that opens Agent Internet URIs directly: metaid://, pin://, metaapp://, metafile://, and map://. Wherever this skill says to render a resource as a clickable Bot-page or Browser link, link the MetaWeb URI itself — \`[name](metaid://<globalMetaId>)\`, \`[pin](pin://<pinId>)\`, \`[app](metaapp://<pinId>)\`, \`[file](metafile://<pinId>)\` — instead of the \`http://127.0.0.1:...\` localUiUrl form: the client intercepts these links (and bare URIs in plain text) and opens the page in the built-in Bot Browser. Never shorten, truncate, or ellipsis a globalMetaId or pinId inside a URI.`;
}
function metawebUriBrowserNote(displayName) {
    return [
        IN_APP_BROWSER_HEADING,
        '',
        'Open pages exactly as this skill instructs — through the MetaBot CLI open commands (`browser tab open` first, `browser open` when no Browser page is running); the daemon pushes the page into every open Browser page regardless of host.',
        '',
        metawebUriPresentation(displayName),
        '',
        'This replaces the "present the `localUiUrl` as a clickable absolute-URL markdown link" guidance elsewhere in this skill: on this host the MetaWeb URI link IS the clickable presentation, and `http://127.0.0.1:.../browser/...` links are unnecessary.',
    ].join('\n');
}
function metawebUriClientNote(displayName) {
    return [
        '### MetaWeb URI Links',
        '',
        metawebUriPresentation(displayName),
    ].join('\n');
}
function metawebUriNetworkManageNote(displayName) {
    return [
        '### MetaWeb URI Links',
        '',
        metawebUriPresentation(displayName),
        '',
        'Prefer the native `search_online_bots` tool for "view online bots" requests when it is available in this session\'s function list: its bullet lines carry catalog-backed bot names that stay clickable in the chat, so reuse those bullets verbatim instead of rebuilding the CLI table. Fall back to the CLI `network bots --online` table when the tool is absent or a deeper `--limit 50` fetch is needed.',
    ].join('\n');
}
function nativeToolsFirstSection(lines) {
    return ['### Native Tools First', '', ...lines];
}
function metawebUriGrouptaskNote(displayName) {
    return [
        '### MetaWeb URI Links',
        '',
        metawebUriPresentation(displayName),
        '',
        ...nativeToolsFirstSection([
            'Prefer the native `group_task` tool when it is available in this session\'s function list. Its `propose` action records the current DSH session as the proposal\'s source session — the anchor the source-session relay builds on; the CLI `grouptask staffing propose` only gains that anchor when you pass `--session <id>` explicitly. Fall back to the CLI `grouptask …` verbs when the tool is absent (plain sessions, other hosts).',
        ]),
    ].join('\n');
}
function metawebUriQandaNote(displayName) {
    return [
        '### MetaWeb URI Links',
        '',
        metawebUriPresentation(displayName),
        '',
        ...nativeToolsFirstSection([
            'Prefer the native Q&A tools when they are available in this session\'s function list — `search_qa`, `list_latest_questions`, `get_question_answers`, `post_simplequestion`, `post_simpleanswer`, `like_pin`: reads run in-process (faster than a CLI spawn) and out-of-workspace attachments stay behind the session approval gate. Fall back to the CLI `qanda …` verbs when the tools are absent.',
        ]),
    ].join('\n');
}
function metawebUriMemoryNote(displayName) {
    return [
        '### MetaWeb URI Links',
        '',
        metawebUriPresentation(displayName),
        '',
        ...nativeToolsFirstSection([
            'In an `oac-<slug>` Bot session on this host, memory injection and post-turn capture are automatic: the plugin appends the Bot\'s memory blocks to every turn and mirrors completed turns for extraction — never mirror turns manually here. Prefer the native memory tools when they are in this session\'s function list (`memory_user_edits`, `experience_recall`, `knowledge_recall`, `knowledge_upsert`, `recent_chats`, `conversation_search`, `oac_session_read_all`, `oac_session_read_latest`). The CLI `memory …` verbs are the fallback for plain sessions and hosts without the tools.',
        ]),
    ].join('\n');
}
/**
 * Extra adapter markdown for one skill on one host. Returns '' when the
 * skill carries no host-specific guidance. `displayName` feeds the generic
 * fallback note.
 */
function renderSkillHostAdapterNote(skillName, hostId, displayName) {
    if (METAWEB_URI_CLIENT_HOSTS.has(hostId)) {
        if (skillName === 'metabot-browser')
            return metawebUriBrowserNote(displayName);
        if (skillName === 'metabot-network-manage')
            return metawebUriNetworkManageNote(displayName);
        if (skillName === 'metabot-grouptask')
            return metawebUriGrouptaskNote(displayName);
        if (skillName === 'metabot-qanda')
            return metawebUriQandaNote(displayName);
        if (skillName === 'metabot-memory')
            return metawebUriMemoryNote(displayName);
        return metawebUriClientNote(displayName);
    }
    if (skillName === 'metabot-browser') {
        return BROWSER_HOST_NOTES[hostId] ?? defaultBrowserNote(displayName);
    }
    return '';
}
