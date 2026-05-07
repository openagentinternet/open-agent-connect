import {
  AddressType,
  CoinType,
  DogeWallet,
  SignType,
} from '@metalet/utxo-wallet-service';
import * as bitcoin from 'bitcoinjs-lib';
import ECPairFactory from 'ecpair';
import type { ChainWriteNetwork } from '../writePin';
import { parseAddressIndexFromPath } from '../../identity/deriveIdentity';
import type {
  ChainAdapter,
  ChainBalance,
  ChainInscriptionInput,
  ChainInscriptionResult,
  ChainTransferInput,
  ChainTransferResult,
  ChainUtxo,
} from './types';

const METALET_HOST = 'https://www.metalet.space';
const NET = 'livenet';
const DOGE_DUST_LIMIT = 1_000_000; // 0.01 DOGE
const DEFAULT_DOGE_FEE_RATE = 200_000; // sat/KB (Fast tier fallback)
const DEFAULT_DOGE_TIMEOUT_MS = 10_000;

// ---- helpers ----

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toFiniteNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

interface MetaletV4Envelope<T> {
  code?: number;
  message?: string;
  data?: T;
}

async function metaletV4Get<T>(path: string, params: Record<string, string>): Promise<T> {
  const search = new URLSearchParams({ ...params, net: NET });
  const url = `${METALET_HOST}/wallet-api/v4${path}?${search}`;
  const response = await fetch(url);
  const json = await response.json() as MetaletV4Envelope<T>;
  if (json?.code !== 0 && json?.code != null) {
    throw new Error(json?.message || 'Metalet API error');
  }
  return (json?.data ?? json) as T;
}

async function metaletV4Post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const url = `${METALET_HOST}/wallet-api/v4${path}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, net: NET }),
  });
  const json = await response.json() as MetaletV4Envelope<T>;
  if (json?.code !== 0 && json?.code != null) {
    throw new Error(json?.message || 'Metalet API error');
  }
  return (json?.data ?? json) as T;
}

// ---- wallet ----

function buildDogeWallet(mnemonic: string, path: string): DogeWallet {
  const addressIndex = parseAddressIndexFromPath(path);
  return new DogeWallet({
    mnemonic,
    network: NET as 'livenet',
    addressIndex,
    addressType: AddressType.DogeSameAsMvc,
    coinType: CoinType.MVC,
  });
}

// ---- DOGE ChainAdapter ----

export const dogeChainAdapter: ChainAdapter = {
  network: 'doge' as ChainWriteNetwork,
  explorerBaseUrl: 'https://dogechain.info',
  feeRateUnit: 'sat/KB' as const,
  /** Minimum transfer: 0.01 DOGE = 1,000,000 satoshis (DOGE dust limit) */
  minTransferSatoshis: DOGE_DUST_LIMIT,

  async deriveAddress(mnemonic: string, path: string): Promise<string> {
    const wallet = buildDogeWallet(mnemonic, path);
    return wallet.getAddress();
  },

  async fetchUtxos(address: string): Promise<ChainUtxo[]> {
    const data = await metaletV4Get<{ list?: Array<{
      txid: string;
      outIndex: number;
      value: number;
      height: number;
      address?: string;
    }> }>('/doge/address/utxo-list', { address });

    const list = data?.list ?? [];
    const utxos: ChainUtxo[] = list
      .filter((item) => toFiniteNumber(item.value) >= DOGE_DUST_LIMIT)
      .map((item) => ({
        txId: normalizeText(item.txid),
        outputIndex: Number(item.outIndex),
        satoshis: toFiniteNumber(item.value),
        address: normalizeText(item.address) || address,
        height: Number(item.height ?? 0),
        confirmed: Number(item.height) > 0,
      }));

    // Prefer confirmed UTXOs
    const confirmed = utxos.filter((u) => u.height > 0);
    const unconfirmed = utxos.filter((u) => u.height <= 0);
    const sorted = [...confirmed, ...unconfirmed];

    // Attach rawTx for P2PKH signing
    for (const utxo of sorted) {
      utxo.rawTx = await this.fetchRawTx(utxo.txId);
    }
    return sorted;
  },

  async fetchBalance(address: string): Promise<ChainBalance> {
    try {
      const data = await metaletV4Get<{
        address?: string;
        confirmed?: number | string;
        unconfirmed?: number | string;
        utxoCount?: number;
      }>('/doge/address/balance-info', { address });

      const confirmed = toFiniteNumber(data?.confirmed);
      const unconfirmed = toFiniteNumber(data?.unconfirmed);

      return {
        chain: 'doge',
        address: normalizeText(data?.address) || address,
        totalSatoshis: confirmed + unconfirmed,
        confirmedSatoshis: confirmed,
        unconfirmedSatoshis: unconfirmed,
        utxoCount: Number(data?.utxoCount ?? 0),
      };
    } catch {
      // Fallback: compute from UTXOs
      const utxos = await this.fetchUtxos(address);
      let totalSatoshis = 0;
      let confirmedSatoshis = 0;
      let unconfirmedSatoshis = 0;
      for (const utxo of utxos) {
        totalSatoshis += utxo.satoshis;
        if (utxo.height > 0) confirmedSatoshis += utxo.satoshis;
        else unconfirmedSatoshis += utxo.satoshis;
      }
      return {
        chain: 'doge',
        address,
        totalSatoshis,
        confirmedSatoshis,
        unconfirmedSatoshis,
        utxoCount: utxos.length,
      };
    }
  },

  async fetchFeeRate(): Promise<number> {
    try {
      const data = await metaletV4Get<{ list?: Array<{ title?: string; feeRate?: number }> }>(
        '/doge/fee/summary', {}
      );
      const list = data?.list ?? [];
      // Prefer "Fast" tier for reliable confirmation, then fall back
      const fastTier = list.find((t) => /fast/i.test(String(t?.title ?? '')));
      if (fastTier && Number.isFinite(fastTier.feeRate) && toFiniteNumber(fastTier.feeRate) > 0) {
        return toFiniteNumber(fastTier.feeRate);
      }
      // Next try "Average"
      const avgTier = list.find((t) => /avg/i.test(String(t?.title ?? '')));
      if (avgTier && Number.isFinite(avgTier.feeRate) && toFiniteNumber(avgTier.feeRate) > 0) {
        return toFiniteNumber(avgTier.feeRate);
      }
      // Fall back to first item or default
      const firstRate = toFiniteNumber(list[0]?.feeRate);
      return firstRate > 0 ? firstRate : DEFAULT_DOGE_FEE_RATE;
    } catch {
      return DEFAULT_DOGE_FEE_RATE;
    }
  },

  async fetchRawTx(txid: string): Promise<string> {
    const data = await metaletV4Get<{ hex?: string; rawTx?: string }>(
      '/doge/tx/raw', { txId: txid }
    );
    const rawTx = normalizeText(data?.hex ?? (data as { rawTx?: string })?.rawTx ?? '');
    if (!rawTx) throw new Error(`DOGE raw tx response is empty for ${txid}.`);
    return rawTx;
  },

  async broadcastTx(rawTx: string): Promise<string> {
    const data = await metaletV4Post<{ TxId?: string; txId?: string }>(
      '/doge/tx/broadcast',
      { rawTx }
    );
    const txId = normalizeText(data?.TxId ?? data?.txId ?? (data as unknown as string));
    if (!txId || txId.length < 10) {
      throw new Error('DOGE broadcast returned an invalid txid.');
    }
    return txId;
  },

  async buildTransfer(input: ChainTransferInput): Promise<ChainTransferResult> {
    const feeRate = Number.isFinite(input.feeRate) && Number(input.feeRate) > 0
      ? input.feeRate! : await this.fetchFeeRate();
    const wallet = buildDogeWallet(input.mnemonic, input.path);
    const address = wallet.getAddress();
    const utxos = await this.fetchUtxos(address);
    if (!utxos.length) {
      throw new Error('MetaBot DOGE balance is insufficient for this transfer.');
    }

    if (input.amountSatoshis < DOGE_DUST_LIMIT) {
      throw new Error(`DOGE transfer amount must be at least ${DOGE_DUST_LIMIT} satoshis (0.01 DOGE).`);
    }

    const signResult = wallet.signTx(SignType.SEND, {
      utxos: utxos.map((utxo) => ({
        txId: utxo.txId,
        outputIndex: utxo.outputIndex,
        satoshis: utxo.satoshis,
        address: utxo.address,
        rawTx: utxo.rawTx,
        confirmed: (utxo as { confirmed?: boolean }).confirmed,
      })),
      toInfo: {
        address: input.toAddress,
        satoshis: input.amountSatoshis,
      },
      feeRate,
    } as never) as unknown as { rawTx?: string; fee?: number };

    const rawTx = normalizeText(signResult?.rawTx);
    if (!rawTx) throw new Error('DOGE signTx(SEND) returned no raw transaction.');

    return { rawTx, fee: Number(signResult.fee ?? 0) };
  },

  async buildInscription(input: ChainInscriptionInput): Promise<ChainInscriptionResult> {
    const feeRate = Number.isFinite(input.feeRate) && Number(input.feeRate) > 0
      ? input.feeRate! : await this.fetchFeeRate();
    const wallet = buildDogeWallet(input.identity.mnemonic, input.identity.path);
    const address = wallet.getAddress();
    const utxos = await this.fetchUtxos(address);
    if (!utxos.length) {
      throw new Error('MetaBot DOGE balance is insufficient for this chain write.');
    }

    const payloadBody = input.request.encoding === 'base64'
      ? Buffer.from(input.request.payload, 'base64').toString('utf-8')
      : input.request.payload;
    const signResult = wallet.signTx(SignType.INSCRIBE_METAIDPIN, {
      utxos: utxos.map((utxo) => ({
        txId: utxo.txId,
        outputIndex: utxo.outputIndex,
        satoshis: utxo.satoshis,
        address: utxo.address,
        rawTx: utxo.rawTx,
        confirmed: (utxo as { confirmed?: boolean }).confirmed,
      })),
      feeRate,
      metaidDataList: [{
        operation: input.request.operation,
        path: input.request.path,
        contentType: input.request.contentType,
        encryption: input.request.encryption,
        version: input.request.version,
        body: payloadBody,
        revealAddr: address,
      }],
    } as never) as unknown as {
      commitTx?: { rawTx?: string; fee?: number };
      revealTxs?: Array<{ rawTx?: string; fee?: number }>;
    };

    const commitTx = signResult.commitTx;
    if (!commitTx?.rawTx) throw new Error('DOGE signTx returned no commit transaction.');

    const revealTxs = Array.isArray(signResult.revealTxs) ? signResult.revealTxs : [];
    const firstReveal = revealTxs[0];
    if (!firstReveal?.rawTx) throw new Error('DOGE inscription produced no reveal transaction.');

    let totalCost = Number(commitTx.fee ?? 0);
    const signedRawTxs: string[] = [commitTx.rawTx];
    const revealIndices: number[] = [];
    for (const reveal of revealTxs) {
      const rawTx = normalizeText(reveal?.rawTx);
      if (!rawTx) throw new Error('DOGE signTx returned an empty reveal transaction.');
      revealIndices.push(signedRawTxs.length);
      signedRawTxs.push(rawTx);
      totalCost += Number(reveal?.fee ?? 0);
    }

    return {
      signedRawTxs,
      revealIndices,
      totalCost: Number.isFinite(totalCost) ? totalCost : 0,
    };
  },
};

export default dogeChainAdapter;
