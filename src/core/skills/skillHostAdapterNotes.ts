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
    return BROWSER_HOST_NOTES[hostId] ?? defaultBrowserNote(displayName);
  }
  return '';
}
