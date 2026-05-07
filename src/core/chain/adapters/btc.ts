import {
  AddressType,
  BtcWallet,
  CoinType,
  SignType,
} from '@metalet/utxo-wallet-service';
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
const MEMPOOL_HOST = 'https://mempool.space';
const NET = 'livenet';
const DEFAULT_BTC_FEE_RATE = 2;
const DEFAULT_TIMEOUT_MS = 1_500;

// ---- helpers ----

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toFiniteNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function getErrorMessage(error: unknown): string {
  if (error != null && typeof error === 'object' && 'message' in error && typeof (error as Error).message === 'string') {
    return (error as Error).message;
  }
  return String(error ?? '');
}

function isRetryableBtcProviderError(error: unknown): boolean {
  const normalized = getErrorMessage(error).toLowerCase();
  return (
    normalized.includes('higun request error')
    || normalized.includes('rpc error')
    || normalized.includes('timeout')
    || normalized.includes('timed out')
    || normalized.includes('fetch failed')
    || normalized.includes('failed to fetch')
    || normalized.includes('network error')
    || normalized.includes('networkerror')
  );
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs?: number): Promise<Response> {
  const controller = new AbortController();
  const resolvedTimeoutMs = Number.isFinite(timeoutMs) && Number(timeoutMs) > 0
    ? Math.floor(Number(timeoutMs)) : DEFAULT_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), resolvedTimeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`request timeout after ${resolvedTimeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function mempoolGetJson<T>(path: string): Promise<T> {
  const response = await fetch(`${MEMPOOL_HOST}/api${path}`);
  if ('ok' in response && response.ok === false) {
    throw new Error(`mempool request failed (${response.status})`);
  }
  return await response.json() as T;
}

async function mempoolGetText(path: string): Promise<string> {
  const response = await fetch(`${MEMPOOL_HOST}/api${path}`);
  if ('ok' in response && response.ok === false) {
    throw new Error(`mempool request failed (${response.status})`);
  }
  return await response.text();
}

// ---- wallet ----

function buildBtcWallet(mnemonic: string, path: string): BtcWallet {
  const addressIndex = parseAddressIndexFromPath(path);
  return new BtcWallet({
    mnemonic,
    network: NET as 'livenet',
    addressIndex,
    addressType: AddressType.SameAsMvc,
    coinType: CoinType.MVC,
  });
}

// ---- raw tx fetch ----

async function fetchBtcRawTxHex(
  txId: string,
  options: { preferMempool?: boolean; timeoutMs?: number } = {},
): Promise<string> {
  if (!options.preferMempool) {
    try {
      const params = new URLSearchParams({ txId, chain: 'btc', net: NET });
      const response = await fetchWithTimeout(
        `${METALET_HOST}/wallet-api/v3/tx/raw?${params}`,
        {},
        options.timeoutMs,
      );
      const json = await response.json() as {
        code?: number; message?: string;
        data?: { rawTx?: string; hex?: string };
      };
      if (json?.code !== 0) {
        throw new Error(json?.message || 'Metalet BTC raw tx query failed.');
      }
      const rawTx = normalizeText(json?.data?.rawTx ?? json?.data?.hex);
      if (!rawTx) throw new Error(`Metalet BTC raw tx response is empty for ${txId}.`);
      return rawTx;
    } catch (error) {
      if (!isRetryableBtcProviderError(error)) throw error;
    }
  }

  const rawTx = normalizeText(await mempoolGetText(`/tx/${txId}/hex`));
  if (!rawTx) throw new Error(`Mempool BTC raw tx response is empty for ${txId}.`);
  return rawTx;
}

// ---- UTXO normalization ----

function normalizeBtcUtxos(input: {
  list: Array<{
    txId?: string;
    txid?: string;
    outputIndex?: number;
    vout?: number;
    satoshis?: number;
    value?: number;
    address?: string;
    confirmed?: boolean;
    status?: { confirmed?: boolean };
    height?: number;
  }>;
  address: string;
}): ChainUtxo[] {
  const normalized = input.list.map((utxo) => ({
    txId: normalizeText(utxo.txId ?? utxo.txid),
    outputIndex: Number.isInteger(utxo.outputIndex) ? Number(utxo.outputIndex) : Number(utxo.vout),
    satoshis: Number(utxo.satoshis ?? utxo.value ?? 0),
    address: normalizeText(utxo.address) || input.address,
    height: Number(utxo.height ?? 0),
    confirmed: typeof utxo.confirmed === 'boolean'
      ? utxo.confirmed
      : typeof utxo.status?.confirmed === 'boolean'
        ? utxo.status.confirmed
        : undefined,
  })).filter((utxo) => (
    /^[0-9a-f]{64}$/i.test(utxo.txId)
    && Number.isInteger(utxo.outputIndex)
    && utxo.outputIndex >= 0
    && Number.isFinite(utxo.satoshis)
    && utxo.satoshis >= 600
  ));

  const confirmed = normalized.filter((utxo) => utxo.confirmed !== false);
  const unconfirmed = normalized.filter((utxo) => utxo.confirmed === false);
  return [...confirmed, ...unconfirmed];
}

// ---- BTC ChainAdapter ----

export const btcChainAdapter: ChainAdapter = {
  network: 'btc' as ChainWriteNetwork,
  explorerBaseUrl: 'https://mempool.space',
  feeRateUnit: 'sat/byte',
  minTransferSatoshis: 546,

  async deriveAddress(mnemonic: string, path: string): Promise<string> {
    const wallet = buildBtcWallet(mnemonic, path);
    return wallet.getAddress();
  },

  async fetchUtxos(address: string): Promise<ChainUtxo[]> {
    let preferMempool = false;
    let utxos: ChainUtxo[];
    try {
      const params = new URLSearchParams({ address, unconfirmed: '1', net: NET });
      const response = await fetchWithTimeout(`${METALET_HOST}/wallet-api/v3/address/btc-utxo?${params}`);
      const json = await response.json() as {
        code?: number; message?: string;
        data?: Array<{
          txId?: string; txid?: string;
          outputIndex?: number; vout?: number;
          satoshis?: number; value?: number;
          address?: string; confirmed?: boolean;
          status?: { confirmed?: boolean };
        }>;
      };
      if (json?.code !== 0) throw new Error(json?.message || 'Metalet BTC UTXO query failed.');
      utxos = normalizeBtcUtxos({ list: json?.data ?? [], address });
    } catch (error) {
      if (!isRetryableBtcProviderError(error)) throw error;
      preferMempool = true;
      const mempoolUtxos = await mempoolGetJson<Array<{
        txId?: string; txid?: string;
        outputIndex?: number; vout?: number;
        satoshis?: number; value?: number;
        address?: string; confirmed?: boolean;
        status?: { confirmed?: boolean };
      }>>(`/address/${address}/utxo`);
      utxos = normalizeBtcUtxos({ list: mempoolUtxos, address });
    }

    // Attach rawTx for P2PKH inputs (needed for signing)
    const scriptType = (buildBtcWallet('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', "m/44'/10001'/0'/0/0") as unknown as { getScriptType?: () => string }).getScriptType?.() ?? 'P2PKH';
    const needRawTx = scriptType === 'P2PKH';
    if (!needRawTx) return utxos;

    const withRawTx: ChainUtxo[] = [];
    for (const utxo of utxos) {
      withRawTx.push({
        ...utxo,
        rawTx: await fetchBtcRawTxHex(utxo.txId, { preferMempool }),
      });
    }
    return withRawTx;
  },

  async fetchBalance(address: string): Promise<ChainBalance> {
    const params = new URLSearchParams({ address, net: NET });
    const response = await fetch(`${METALET_HOST}/wallet-api/v3/address/btc-balance?${params}`);
    const json = await response.json() as {
      code?: number;
      data?: { balance?: number; safeBalance?: number; pendingBalance?: number };
    };
    const data = json?.code === 0 ? (json.data ?? {}) : {};

    const totalBtc = Math.max(0, toFiniteNumber(data.balance));
    const confirmedBtc = Math.max(0, toFiniteNumber(data.safeBalance ?? data.balance));
    const unconfirmedBtc = toFiniteNumber(data.pendingBalance);

    return {
      chain: 'btc',
      address,
      totalSatoshis: Math.round(totalBtc * 1e8),
      confirmedSatoshis: Math.round(confirmedBtc * 1e8),
      unconfirmedSatoshis: Math.round(unconfirmedBtc * 1e8),
      utxoCount: 0,
    };
  },

  async fetchFeeRate(): Promise<number> {
    try {
      const url = `${METALET_HOST}/wallet-api/v3/btc/fee/summary?net=${NET}`;
      const response = await fetch(url);
      const json = await response.json() as { code?: number; data?: { list?: Array<{ title?: string; feeRate?: number }> } };
      if (json?.code !== 0) return DEFAULT_BTC_FEE_RATE;
      const list = json?.data?.list ?? [];
      const avg = list.find((t) => /avg/i.test(String(t?.title ?? '')));
      const rate = toFiniteNumber(avg?.feeRate ?? list[0]?.feeRate);
      return rate > 0 ? rate : DEFAULT_BTC_FEE_RATE;
    } catch {
      return DEFAULT_BTC_FEE_RATE;
    }
  },

  async fetchRawTx(txid: string): Promise<string> {
    return fetchBtcRawTxHex(txid);
  },

  async broadcastTx(rawTx: string): Promise<string> {
    const response = await fetch(`${METALET_HOST}/wallet-api/v3/tx/broadcast`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chain: 'btc', net: NET, rawTx }),
    });
    const json = await response.json() as { code?: number; message?: string; data?: string };
    if (json?.code !== 0) throw new Error(json?.message || 'BTC broadcast failed');
    const txid = normalizeText(json.data);
    if (!txid) throw new Error('BTC broadcast returned an empty txid.');
    return txid;
  },

  async buildTransfer(input: ChainTransferInput): Promise<ChainTransferResult> {
    const feeRate = Number.isFinite(input.feeRate) && Number(input.feeRate) > 0
      ? input.feeRate! : DEFAULT_BTC_FEE_RATE;
    const wallet = buildBtcWallet(input.mnemonic, input.path);
    const address = wallet.getAddress();
    const scriptType = (wallet as unknown as { getScriptType?: () => string }).getScriptType?.() ?? 'P2PKH';
    const needRawTx = scriptType === 'P2PKH';
    let utxos = await this.fetchUtxos(address);
    if (needRawTx && !utxos.every((u) => u.rawTx)) {
      // fetchUtxos attaches rawTx when needed, but let's ensure
      utxos = utxos.filter((u) => u.rawTx);
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
    if (!rawTx) throw new Error('BTC signTx(SEND) returned no raw transaction.');

    return { rawTx, fee: Number(signResult.fee ?? 0) };
  },

  async buildInscription(input: ChainInscriptionInput): Promise<ChainInscriptionResult> {
    const feeRate = Number.isFinite(input.feeRate) && Number(input.feeRate) > 0
      ? input.feeRate! : DEFAULT_BTC_FEE_RATE;
    const wallet = buildBtcWallet(input.identity.mnemonic, input.identity.path);
    const address = wallet.getAddress();
    const scriptType = (wallet as unknown as { getScriptType?: () => string }).getScriptType?.() ?? 'P2PKH';
    const needRawTx = scriptType === 'P2PKH';
    let utxos = await this.fetchUtxos(address);
    if (needRawTx) {
      utxos = utxos.filter((u) => u.rawTx);
    }
    if (!utxos.length) {
      throw new Error('MetaBot BTC balance is insufficient for this chain write.');
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
    if (!commitTx?.rawTx) throw new Error('BTC signTx returned no commit transaction.');

    const revealTxs = Array.isArray(signResult.revealTxs) ? signResult.revealTxs : [];
    const firstReveal = revealTxs[0];
    if (!firstReveal?.rawTx) throw new Error('BTC inscription produced no reveal transaction.');

    let totalCost = Number(commitTx.fee ?? 0);
    // Build signedRawTxs: [commit, ...reveals]
    const signedRawTxs: string[] = [commitTx.rawTx];
    const revealIndices: number[] = [];
    for (const reveal of revealTxs) {
      const rawTx = normalizeText(reveal?.rawTx);
      if (!rawTx) throw new Error('BTC signTx returned an empty reveal transaction.');
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

export default btcChainAdapter;
