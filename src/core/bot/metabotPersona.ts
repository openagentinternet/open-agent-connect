export const DEFAULT_METABOT_ROLE = 'You are a helpful AI assistant.';
export const DEFAULT_METABOT_SOUL = 'You are friendly and professional.';
export const DEFAULT_METABOT_GOAL = 'Your goal is to help users accomplish their tasks effectively.';

export interface MetabotPersonaFields {
  role: string;
  soul: string;
  goal: string;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeMetabotPersonaFields(input: Partial<MetabotPersonaFields>): MetabotPersonaFields {
  return {
    role: normalizeText(input.role),
    soul: normalizeText(input.soul),
    goal: normalizeText(input.goal),
  };
}

export function isLegacyDefaultMetabotPersona(input: Partial<MetabotPersonaFields>): boolean {
  const persona = normalizeMetabotPersonaFields(input);
  return persona.role === DEFAULT_METABOT_ROLE
    && persona.soul === DEFAULT_METABOT_SOUL
    && persona.goal === DEFAULT_METABOT_GOAL;
}

export function normalizePublicMetabotPersona(input: Partial<MetabotPersonaFields>): MetabotPersonaFields {
  if (isLegacyDefaultMetabotPersona(input)) {
    return {
      role: '',
      soul: '',
      goal: '',
    };
  }
  return normalizeMetabotPersonaFields(input);
}

export function withRuntimeMetabotPersonaFallback(input: Partial<MetabotPersonaFields>): MetabotPersonaFields {
  const persona = normalizePublicMetabotPersona(input);
  return {
    role: persona.role || DEFAULT_METABOT_ROLE,
    soul: persona.soul || DEFAULT_METABOT_SOUL,
    goal: persona.goal || DEFAULT_METABOT_GOAL,
  };
}
