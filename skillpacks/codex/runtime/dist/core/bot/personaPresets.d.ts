export declare const PERSONA_PRESET_CATEGORIES: readonly ["relationship", "everyday", "learning", "creative", "professional"];
export type PersonaPresetCategory = typeof PERSONA_PRESET_CATEGORIES[number];
export type PersonaPresetLocale = 'en' | 'zh-CN';
export interface PersonaPresetCopy {
    name: string;
    summary: string;
    role: string;
    soul: string;
    goal: string;
}
export interface PersonaPreset {
    id: string;
    category: PersonaPresetCategory;
    emoji: string;
    source: 'oac-original';
    locales: Record<PersonaPresetLocale, PersonaPresetCopy>;
}
export interface PersonaPresetCatalog {
    version: 1;
    presets: PersonaPreset[];
}
export declare const PERSONA_PRESET_CATALOG: PersonaPresetCatalog;
