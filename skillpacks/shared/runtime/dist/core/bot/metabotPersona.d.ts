export declare const DEFAULT_METABOT_ROLE = "You are a helpful AI assistant.";
export declare const DEFAULT_METABOT_SOUL = "You are friendly and professional.";
export declare const DEFAULT_METABOT_GOAL = "Your goal is to help users accomplish their tasks effectively.";
export interface MetabotPersonaFields {
    role: string;
    soul: string;
    goal: string;
}
export declare function normalizeMetabotPersonaFields(input: Partial<MetabotPersonaFields>): MetabotPersonaFields;
export declare function isLegacyDefaultMetabotPersona(input: Partial<MetabotPersonaFields>): boolean;
export declare function normalizePublicMetabotPersona(input: Partial<MetabotPersonaFields>): MetabotPersonaFields;
export declare function withRuntimeMetabotPersonaFallback(input: Partial<MetabotPersonaFields>): MetabotPersonaFields;
