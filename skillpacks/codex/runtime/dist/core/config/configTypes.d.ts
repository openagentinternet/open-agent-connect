export interface EvolutionNetworkConfig {
    enabled: boolean;
    autoAdoptSameSkillSameScope: boolean;
    autoRecordExecutions: boolean;
}
export interface A2AConfig {
    simplemsgListenerEnabled: boolean;
}
export type DefaultWriteNetwork = 'mvc' | 'btc' | 'doge' | 'opcat';
export declare const DEFAULT_WRITE_NETWORKS: DefaultWriteNetwork[];
export interface ChainConfig {
    defaultWriteNetwork: DefaultWriteNetwork;
}
export type AskMasterTriggerMode = 'manual' | 'suggest' | 'auto';
export type AskMasterConfirmationMode = 'always' | 'sensitive_only' | 'never';
export type AskMasterContextMode = 'compact' | 'standard' | 'full_task';
export declare const ASK_MASTER_TRIGGER_MODES: AskMasterTriggerMode[];
export declare const ASK_MASTER_CONFIRMATION_MODES: AskMasterConfirmationMode[];
export declare const ASK_MASTER_CONTEXT_MODES: AskMasterContextMode[];
export interface AskMasterAutoPolicyConfig {
    minConfidence: number;
    minNoProgressWindowMs: number;
    perTraceLimit: number;
    globalCooldownMs: number;
    allowTrustedAutoSend: boolean;
}
export interface AskMasterConfig {
    enabled: boolean;
    triggerMode: AskMasterTriggerMode;
    confirmationMode: AskMasterConfirmationMode;
    contextMode: AskMasterContextMode;
    trustedMasters: string[];
    autoPolicy: AskMasterAutoPolicyConfig;
}
export interface MetabotConfig {
    chain: ChainConfig;
    evolution_network: EvolutionNetworkConfig;
    askMaster: AskMasterConfig;
    a2a: A2AConfig;
}
export declare function isDefaultWriteNetwork(value: unknown): value is DefaultWriteNetwork;
export declare function isAskMasterTriggerMode(value: unknown): value is AskMasterTriggerMode;
export declare function isAskMasterConfirmationMode(value: unknown): value is AskMasterConfirmationMode;
export declare function isAskMasterContextMode(value: unknown): value is AskMasterContextMode;
export declare function createDefaultAskMasterAutoPolicyConfig(): AskMasterAutoPolicyConfig;
export declare function normalizeAskMasterAutoPolicyConfig(value: unknown): AskMasterAutoPolicyConfig;
export declare function createDefaultConfig(): MetabotConfig;
