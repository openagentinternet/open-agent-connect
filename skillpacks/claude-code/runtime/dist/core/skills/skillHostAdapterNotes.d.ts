/**
 * Per-skill, per-host extra markdown rendered into the
 * {{HOST_ADAPTER_SECTION}} placeholder of SKILL templates. Shared by the
 * skillpacks build (scripts/build-metabot-skillpacks.mjs, via the compiled
 * dist module) and the `oac install` skill renderer so every installed host
 * carries the same adapter knowledge instead of an empty section.
 */
/**
 * Extra adapter markdown for one skill on one host. Returns '' when the
 * skill carries no host-specific guidance. `displayName` feeds the generic
 * fallback note.
 */
export declare function renderSkillHostAdapterNote(skillName: string, hostId: string, displayName: string): string;
