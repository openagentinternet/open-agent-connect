import type { ChainAdapter } from '../chain/adapters/types';

const walletSpendQueues = new Map<string, Promise<void>>();

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function withWalletSpendQueue<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = walletSpendQueues.get(key) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const currentChain = previous.catch(() => undefined).then(() => current);
  walletSpendQueues.set(key, currentChain);

  await previous.catch(() => undefined);
  try {
    return await run();
  } finally {
    releaseCurrent();
    if (walletSpendQueues.get(key) === currentChain) {
      walletSpendQueues.delete(key);
    }
  }
}

export async function resolveWalletSpendQueueKey(input: {
  adapter: Pick<ChainAdapter, 'network' | 'deriveAddress'>;
  mnemonic: string;
  path: string;
  fallbackAddress?: string | null;
}): Promise<string> {
  let address = normalizeText(input.fallbackAddress);
  try {
    address = normalizeText(await input.adapter.deriveAddress(input.mnemonic, input.path)) || address;
  } catch {
    // Fall back to the derivation path so failed address derivation does not remove spend serialization.
  }
  return [
    input.adapter.network,
    address || normalizeText(input.path) || 'default',
  ].join(':');
}

export function __clearWalletSpendQueuesForTests(): void {
  walletSpendQueues.clear();
}
