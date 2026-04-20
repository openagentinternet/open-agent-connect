export interface EvolutionNetworkConfig {
  enabled: boolean;
  autoAdoptSameSkillSameScope: boolean;
  autoRecordExecutions: boolean;
}

export type AskMasterTriggerMode = 'manual' | 'suggest' | 'auto';
export type AskMasterConfirmationMode = 'always' | 'sensitive_only' | 'never';
export type AskMasterContextMode = 'compact' | 'standard' | 'full_task';

export const ASK_MASTER_TRIGGER_MODES: AskMasterTriggerMode[] = ['manual', 'suggest', 'auto'];
export const ASK_MASTER_CONFIRMATION_MODES: AskMasterConfirmationMode[] = ['always', 'sensitive_only', 'never'];
export const ASK_MASTER_CONTEXT_MODES: AskMasterContextMode[] = ['compact', 'standard', 'full_task'];

export interface AskMasterConfig {
  enabled: boolean;
  triggerMode: AskMasterTriggerMode;
  confirmationMode: AskMasterConfirmationMode;
  contextMode: AskMasterContextMode;
  trustedMasters: string[];
}

export interface MetabotConfig {
  evolution_network: EvolutionNetworkConfig;
  askMaster: AskMasterConfig;
}

export function isAskMasterTriggerMode(value: unknown): value is AskMasterTriggerMode {
  return typeof value === 'string' && ASK_MASTER_TRIGGER_MODES.includes(value as AskMasterTriggerMode);
}

export function isAskMasterConfirmationMode(value: unknown): value is AskMasterConfirmationMode {
  return typeof value === 'string' && ASK_MASTER_CONFIRMATION_MODES.includes(value as AskMasterConfirmationMode);
}

export function isAskMasterContextMode(value: unknown): value is AskMasterContextMode {
  return typeof value === 'string' && ASK_MASTER_CONTEXT_MODES.includes(value as AskMasterContextMode);
}

export function createDefaultConfig(): MetabotConfig {
  return {
    evolution_network: {
      enabled: true,
      autoAdoptSameSkillSameScope: false,
      autoRecordExecutions: true
    },
    askMaster: {
      enabled: true,
      triggerMode: 'manual',
      confirmationMode: 'always',
      contextMode: 'standard',
      trustedMasters: [],
    },
  };
}
