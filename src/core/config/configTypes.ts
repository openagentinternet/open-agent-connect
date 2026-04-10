export interface EvolutionNetworkConfig {
  enabled: boolean;
  autoAdoptSameSkillSameScope: boolean;
  autoRecordExecutions: boolean;
}

export interface MetabotConfig {
  evolution_network: EvolutionNetworkConfig;
}

export function createDefaultConfig(): MetabotConfig {
  return {
    evolution_network: {
      enabled: true,
      autoAdoptSameSkillSameScope: false,
      autoRecordExecutions: true
    }
  };
}
