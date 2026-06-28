import type { ChainUtxo } from './adapters/types';

const PENDING_SPENT_OUTPOINT_TTL_MS = 10 * 60 * 1000;

interface PendingSpentOutpoint {
  expiresAt: number;
}

interface PendingAvailableUtxo {
  utxo: ChainUtxo;
  expiresAt: number;
}

/** Maps address:txid:outputIndex to pending spent outpoint state. */
const pendingSpentOutpoints = new Map<string, PendingSpentOutpoint>();
const pendingAvailableUtxos = new Map<string, PendingAvailableUtxo>();

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOutpointTxid(value: string): string {
  return normalizeText(value).toLowerCase();
}

export function getMvcUtxoOutpointKey(input: {
  txId: string;
  outputIndex: number;
  address?: string;
}): string {
  const outpointParts = [normalizeOutpointTxid(input.txId), String(input.outputIndex)];
  if (Object.hasOwn(input, 'address')) {
    return [normalizeText(input.address), ...outpointParts].join(':');
  }
  return outpointParts.join(':');
}

function prunePendingMvcUtxos(now: number = Date.now()): void {
  for (const [key, value] of pendingSpentOutpoints.entries()) {
    if (value.expiresAt <= now) pendingSpentOutpoints.delete(key);
  }
  for (const [key, value] of pendingAvailableUtxos.entries()) {
    if (value.expiresAt <= now) pendingAvailableUtxos.delete(key);
  }
}

export function rememberPendingMvcTransaction(input: {
  address: string;
  spentUtxos: ChainUtxo[];
  createdUtxos: ChainUtxo[];
  now?: number;
}): void {
  const now = input.now ?? Date.now();
  prunePendingMvcUtxos(now);
  const expiresAt = now + PENDING_SPENT_OUTPOINT_TTL_MS;
  for (const utxo of input.spentUtxos) {
    const key = getMvcUtxoOutpointKey({
      address: input.address,
      txId: utxo.txId,
      outputIndex: utxo.outputIndex,
    });
    pendingSpentOutpoints.set(key, { expiresAt });
    pendingAvailableUtxos.delete(key);
  }
  for (const utxo of input.createdUtxos) {
    if (utxo.satoshis < 600) continue;
    const key = getMvcUtxoOutpointKey({
      address: input.address,
      txId: utxo.txId,
      outputIndex: utxo.outputIndex,
    });
    if (!pendingSpentOutpoints.has(key)) {
      pendingAvailableUtxos.set(key, { utxo, expiresAt });
    }
  }
}

export function resolveSpendableMvcUtxos(input: {
  address: string;
  utxos: ChainUtxo[];
  now?: number;
}): ChainUtxo[] {
  const now = input.now ?? Date.now();
  prunePendingMvcUtxos(now);
  const merged = new Map<string, ChainUtxo>();
  for (const utxo of input.utxos) {
    merged.set(getMvcUtxoOutpointKey({
      address: input.address,
      txId: utxo.txId,
      outputIndex: utxo.outputIndex,
    }), utxo);
  }
  for (const [key, value] of pendingAvailableUtxos.entries()) {
    if (normalizeText(value.utxo.address) === normalizeText(input.address)) {
      merged.set(key, value.utxo);
    }
  }
  return [...merged.entries()]
    .filter(([key]) => !pendingSpentOutpoints.has(key))
    .map(([, utxo]) => utxo);
}

export function __clearPendingMvcUtxosForTests(): void {
  pendingSpentOutpoints.clear();
  pendingAvailableUtxos.clear();
}
