export interface A2AConfig {
    simplemsgListenerEnabled: boolean;
}
export type DefaultWriteNetwork = 'mvc' | 'btc' | 'doge' | 'opcat';
export declare const DEFAULT_WRITE_NETWORKS: DefaultWriteNetwork[];
export interface ChainConfig {
    defaultWriteNetwork: DefaultWriteNetwork;
}
export interface MetabotConfig {
    chain: ChainConfig;
    a2a: A2AConfig;
}
export declare function isDefaultWriteNetwork(value: unknown): value is DefaultWriteNetwork;
export declare function createDefaultConfig(): MetabotConfig;
