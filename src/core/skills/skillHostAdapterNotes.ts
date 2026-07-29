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
    'Cursor has an embedded Browser Tab beside the chat. When the Cursor session exposes the browser automation `browser_navigate` tool, open every `localUiUrl` returned by the MetaBot CLI with it (`position: "active"` so the tab reveals) — never in the external system browser, and never through external browser automation such as Playwright. When no such tool is exposed in the session, present the `localUiUrl` as a full absolute-URL markdown link (for example `[AI_Sunny](http://127.0.0.1:10001/browser/metaid/<globalMetaId>)`); localhost links clicked in Cursor chat open in the integrated Browser Tab when the user\'s Browser Automation setting is "Browser Tab".',
  ].join('\n'),
};

function defaultBrowserNote(displayName: string): string {
  return [
    IN_APP_BROWSER_HEADING,
    '',
    `This ${displayName} setup has no documented in-app browser or preview surface. Present every \`localUiUrl\` returned by the MetaBot CLI as a clickable markdown link for the human to open. If the running session does provide a web preview surface, prefer opening the \`localUiUrl\` there instead of handing it to the external browser.`,
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
