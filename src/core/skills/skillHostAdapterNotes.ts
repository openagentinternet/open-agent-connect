/**
 * Per-skill, per-host extra markdown rendered into the
 * {{HOST_ADAPTER_SECTION}} placeholder of SKILL templates. Shared by the
 * skillpacks build (scripts/build-metabot-skillpacks.mjs, via the compiled
 * dist module) and the `oac install` skill renderer so every installed host
 * carries the same adapter knowledge instead of an empty section.
 */

const IN_APP_BROWSER_HEADING = '### In-App Browser';

const BROWSER_HOST_NOTES: Record<string, string> = {
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

function defaultBrowserNote(displayName: string): string {
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

function metawebUriPresentation(displayName: string): string {
  return `This ${displayName} client has a built-in Bot Browser that opens Agent Internet URIs directly: metaid://, pin://, metaapp://, metafile://, and map://. Wherever this skill says to render a resource as a clickable Bot-page or Browser link, link the MetaWeb URI itself — \`[name](metaid://<globalMetaId>)\`, \`[pin](pin://<pinId>)\`, \`[app](metaapp://<pinId>)\`, \`[file](metafile://<pinId>)\` — instead of the \`http://127.0.0.1:...\` localUiUrl form: the client intercepts these links (and bare URIs in plain text) and opens the page in the built-in Bot Browser. Never shorten, truncate, or ellipsis a globalMetaId or pinId inside a URI.`;
}

function metawebUriBrowserNote(displayName: string): string {
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

function metawebUriClientNote(displayName: string): string {
  return [
    '### MetaWeb URI Links',
    '',
    metawebUriPresentation(displayName),
  ].join('\n');
}

/**
 * Extra adapter markdown for one skill on one host. Returns '' when the
 * skill carries no host-specific guidance. `displayName` feeds the generic
 * fallback note.
 */
export function renderSkillHostAdapterNote(
  skillName: string,
  hostId: string,
  displayName: string,
): string {
  if (skillName === 'metabot-browser') {
    if (METAWEB_URI_CLIENT_HOSTS.has(hostId)) return metawebUriBrowserNote(displayName);
    return BROWSER_HOST_NOTES[hostId] ?? defaultBrowserNote(displayName);
  }
  if (METAWEB_URI_CLIENT_HOSTS.has(hostId)) return metawebUriClientNote(displayName);
  return '';
}
