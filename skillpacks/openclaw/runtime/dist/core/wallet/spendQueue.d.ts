import type { ChainAdapter } from '../chain/adapters/types';
export declare function withWalletSpendQueue<T>(key: string, run: () => Promise<T>): Promise<T>;
export declare function resolveWalletSpendQueueKey(input: {
    adapter: Pick<ChainAdapter, 'network' | 'deriveAddress'>;
    mnemonic: string;
    path: string;
    fallbackAddress?: string | null;
}): Promise<string>;
export declare function __clearWalletSpendQueuesForTests(): void;
