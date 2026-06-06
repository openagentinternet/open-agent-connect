export interface A2AConfig {
  simplemsgListenerEnabled: boolean;
}

export type DefaultWriteNetwork = 'mvc' | 'btc' | 'doge' | 'opcat';

export const DEFAULT_WRITE_NETWORKS: DefaultWriteNetwork[] = ['mvc', 'btc', 'doge', 'opcat'];

export interface ChainConfig {
  defaultWriteNetwork: DefaultWriteNetwork;
}

export interface MetabotConfig {
  chain: ChainConfig;
  a2a: A2AConfig;
}

export function isDefaultWriteNetwork(value: unknown): value is DefaultWriteNetwork {
  return typeof value === 'string' && DEFAULT_WRITE_NETWORKS.includes(value as DefaultWriteNetwork);
}

export function createDefaultConfig(): MetabotConfig {
  return {
    chain: {
      defaultWriteNetwork: 'mvc',
    },
    a2a: {
      simplemsgListenerEnabled: true,
    },
  };
}
