/**
 * Shared system-prompt composer: named sections on a fixed order grid,
 * deduped BY NAME (a later registration shadows the earlier one — channels
 * replace a section, they never stack a second copy of it), empty text
 * dropped, joined with a blank line. Ported from the IDBots promptComposer
 * contract (composePromptSections).
 */

export interface SystemPromptSection {
  name: string;
  order: number;
  text: string;
}

/** Conventional slots; scenarios may use any order value between them. */
export const SYSTEM_PROMPT_ORDER = {
  scenario: 0,
  worldview: 10,
  identity: 20,
  experience: 30,
  memory: 40,
  context: 50,
  rules: 60,
  task: 70,
} as const;

export function composeSystemPrompt(
  sections: Array<SystemPromptSection | null | undefined>,
): string {
  const byName = new Map<string, SystemPromptSection>();
  for (const section of sections) {
    if (!section || !section.text.trim()) continue;
    byName.set(section.name, section);
  }
  return [...byName.values()]
    .sort((a, b) => a.order - b.order)
    .map((section) => section.text)
    .join('\n\n');
}
