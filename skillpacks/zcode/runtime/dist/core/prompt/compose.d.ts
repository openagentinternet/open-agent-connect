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
export declare const SYSTEM_PROMPT_ORDER: {
    readonly scenario: 0;
    readonly worldview: 10;
    readonly identity: 20;
    readonly experience: 30;
    readonly memory: 40;
    readonly context: 50;
    readonly rules: 60;
    readonly task: 70;
};
export declare function composeSystemPrompt(sections: Array<SystemPromptSection | null | undefined>): string;
