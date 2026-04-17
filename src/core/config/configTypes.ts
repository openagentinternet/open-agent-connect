export interface EvolutionNetworkConfig {
  enabled: boolean;
  autoAdoptSameSkillSameScope: boolean;
  autoRecordExecutions: boolean;
}

export interface AskMasterConfig {
  enabled: boolean;
  triggerMode: 'manual' | 'suggest' | 'auto';
  confirmationMode: 'always' | 'sensitive_only' | 'never';
  contextMode: 'compact' | 'standard' | 'full_task';
  trustedMasters: string[];
}

export interface MetabotConfig {
  evolution_network: EvolutionNetworkConfig;
  askMaster: AskMasterConfig;
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
