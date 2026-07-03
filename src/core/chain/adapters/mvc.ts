import '../../compat/nodeLocalStorage';
import { TxComposer, mvc } from 'meta-contract';
import {
  AddressType,
  CoinType,
  MvcWallet,
} from '@metalet/utxo-wallet-service';
import type { ChainWriteNetwork } from '../writePin';
import { parseAddressIndexFromPath } from '../../identity/deriveIdentity';
import {
  __clearPendingMvcUtxosForTests,
  rememberPendingMvcTransaction,
  resolveSpendableMvcUtxos,
} from '../mvcPendingUtxos';
import { isRetryableUtxoFundingError } from '../utxoBroadcastErrors';
import { buildMvcFileInscriptionDraft, extractOwnedOutputsFromPreparedMvcTx, signMvcPreparedUserInputs } from '../mvcFileInscriptionDraft';
import { buildMvcSigningIdentity } from '../mvcSigningIdentity';
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
const P2PKH_INPUT_SIZE = 148;
const DEFAULT_MVC_FEE_RATE = 1;

/** Deferred tracking: maps rawTx hex → tracking info for after broadcast */
interface DeferredMvcTracker {
  address: string;
  spentUtxos: ChainUtxo[];
  createdUtxosFactory: (txid: string) => ChainUtxo[];
}
const deferredTrackers = new Map<string, DeferredMvcTracker>();

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function __clearPendingMvcSpentOutpointsForTests(): void {
  __clearPendingMvcUtxosForTests();
  deferredTrackers.clear();
}

// ---- helpers ----

function toFiniteNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

async function getV3AddressType(): Promise<AddressType> {
  return AddressType.LegacyMvc;
}

// ---- UTXO selection ----

function pickUtxos(
  utxos: ChainUtxo[],
  totalOutput: number,
  feeRate: number,
  estimatedTxSizeWithoutInputs: number
): ChainUtxo[] {
  const confirmed = utxos.filter((utxo) => utxo.height > 0).sort(() => Math.random() - 0.5);
  const unconfirmed = utxos.filter((utxo) => utxo.height <= 0).sort(() => Math.random() - 0.5);
  const ordered = [...confirmed, ...unconfirmed];

  let current = 0;
  const picked: ChainUtxo[] = [];

  for (const utxo of ordered) {
    current += utxo.satoshis;
    picked.push(utxo);
    const estimatedTxSize = estimatedTxSizeWithoutInputs + (picked.length * P2PKH_INPUT_SIZE);
    const requiredAmount = totalOutput + Math.ceil(estimatedTxSize * feeRate);
    if (current >= requiredAmount) return picked;
  }
  throw new Error('MetaBot balance is insufficient for this chain write.');
}

// ---- MvcChainAdapter ----

export const mvcChainAdapter: ChainAdapter = {
  network: 'mvc' as ChainWriteNetwork,
  explorerBaseUrl: 'https://www.mvcscan.com',
  feeRateUnit: 'sat/byte',
  minTransferSatoshis: 600,

  async deriveAddress(mnemonic: string, path: string): Promise<string> {
    const addressIndex = parseAddressIndexFromPath(path);
    const wallet = new MvcWallet({
      coinType: CoinType.MVC,
      addressType: await getV3AddressType(),
      addressIndex,
      network: NET as 'livenet',
      mnemonic,
    });
    return wallet.getAddress();
  },

  async fetchUtxos(address: string): Promise<ChainUtxo[]> {
    const all: ChainUtxo[] = [];
    let flag: string | undefined;

    while (true) {
      const params = new URLSearchParams({ address, net: NET, ...(flag ? { flag } : {}) });
      const response = await fetch(`${METALET_HOST}/wallet-api/v4/mvc/address/utxo-list?${params}`);
      const json = await response.json() as {
        data?: { list?: Array<{ txid: string; outIndex: number; value: number; height: number; flag?: string }> };
      };
      const list = json?.data?.list ?? [];
      if (!list.length) break;

      all.push(...list.filter((utxo) => utxo.value >= 600).map((utxo) => ({
        txId: utxo.txid,
        outputIndex: utxo.outIndex,
        satoshis: utxo.value,
        address,
        height: utxo.height,
      })));

      flag = list[list.length - 1]?.flag;
      if (!flag) break;
    }
    return all;
  },

  async fetchBalance(address: string): Promise<ChainBalance> {
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
      chain: 'mvc',
      address,
      totalSatoshis,
      confirmedSatoshis,
      unconfirmedSatoshis,
      utxoCount: utxos.length,
    };
  },

  async fetchFeeRate(): Promise<number> {
    try {
      const url = `${METALET_HOST}/wallet-api/v4/mvc/fee/summary?net=${NET}`;
      const response = await fetch(url);
      const json = await response.json() as { code?: number; data?: { list?: Array<{ title?: string; feeRate?: number }> } };
      if (json?.code !== 0) return DEFAULT_MVC_FEE_RATE;
      const list = json?.data?.list ?? [];
      const avg = list.find((t) => /avg/i.test(String(t?.title ?? '')));
      const rate = toFiniteNumber(avg?.feeRate ?? list[0]?.feeRate);
      return rate > 0 ? rate : DEFAULT_MVC_FEE_RATE;
    } catch {
      return DEFAULT_MVC_FEE_RATE;
    }
  },

  async fetchRawTx(txid: string): Promise<string> {
    const params = new URLSearchParams({ txId: txid, chain: 'mvc', net: NET });
    const response = await fetch(`${METALET_HOST}/wallet-api/v3/tx/raw?${params}`);
    const json = await response.json() as {
      code?: number; message?: string;
      data?: { rawTx?: string; hex?: string };
    };
    if (json?.code !== 0) throw new Error(json?.message || 'Metalet MVC raw tx query failed.');
    const rawTx = normalizeText(json?.data?.rawTx ?? json?.data?.hex);
    if (!rawTx) throw new Error(`Metalet MVC raw tx response is empty for ${txid}.`);
    return rawTx;
  },

  async broadcastTx(rawTx: string): Promise<string> {
    const response = await fetch(`${METALET_HOST}/wallet-api/v3/tx/broadcast`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chain: 'mvc', net: NET, rawTx }),
    });
    const json = await response.json() as { code?: number; message?: string; data?: string };
    if (json?.code !== 0) {
      const tracker = deferredTrackers.get(rawTx);
      if (tracker && isRetryableUtxoFundingError(json?.message)) {
        rememberPendingMvcTransaction({
          address: tracker.address,
          spentUtxos: tracker.spentUtxos,
          createdUtxos: [],
        });
        deferredTrackers.delete(rawTx);
      }
      throw new Error(json?.message || 'Broadcast failed');
    }
    const txid = json.data ?? '';

    // Complete deferred pending UTXO tracking
    const tracker = deferredTrackers.get(rawTx);
    if (tracker) {
      rememberPendingMvcTransaction({
        address: tracker.address,
        spentUtxos: tracker.spentUtxos,
        createdUtxos: tracker.createdUtxosFactory(txid),
      });
      deferredTrackers.delete(rawTx);
    }

    return txid;
  },

  async buildTransfer(input: ChainTransferInput): Promise<ChainTransferResult> {
    const feeRate = Number.isFinite(input.feeRate) && Number(input.feeRate) > 0
      ? input.feeRate! : DEFAULT_MVC_FEE_RATE;
    const { privateKey, address } = buildMvcSigningIdentity({
      mnemonic: input.mnemonic,
      path: input.path,
    });

    const rawUtxos = await this.fetchUtxos(address);
    const utxos = resolveSpendableMvcUtxos({ address, utxos: rawUtxos });

    const SIMPLE_BASE_SIZE = 96;
    const picked = pickUtxos(utxos, input.amountSatoshis, feeRate, SIMPLE_BASE_SIZE);

    const senderAddress = new mvc.Address(address, mvc.Networks.livenet as never);
    const recipientAddress = new mvc.Address(input.toAddress, mvc.Networks.livenet as never);

    const txComposer = new TxComposer();
    txComposer.appendP2PKHOutput({ address: recipientAddress, satoshis: input.amountSatoshis });
    for (const utxo of picked) {
      txComposer.appendP2PKHInput({
        address: senderAddress,
        txId: utxo.txId,
        outputIndex: utxo.outputIndex,
        satoshis: utxo.satoshis,
      });
    }
    txComposer.appendChangeOutput(senderAddress, feeRate);

    for (let i = 0; i < txComposer.tx.inputs.length; i += 1) {
      txComposer.unlockP2PKHInput(privateKey as never, i);
    }

    const rawTx = txComposer.getRawHex();

    // Defer pending UTXO tracking until broadcast
    deferredTrackers.set(rawTx, {
      address,
      spentUtxos: picked,
      createdUtxosFactory: (txid: string) => extractOwnedOutputsFromPreparedMvcTx({
        txHex: rawTx,
        txId: txid,
        address,
      }),
    });

    const inputTotal = txComposer.tx.inputs.reduce((sum, current) => sum + (current.output?.satoshis || 0), 0);
    const outputTotal = txComposer.tx.outputs.reduce((sum, output) => sum + output.satoshis, 0);

    return { rawTx, fee: inputTotal - outputTotal };
  },

  async buildInscription(input: ChainInscriptionInput): Promise<ChainInscriptionResult> {
    const address = await this.deriveAddress(input.identity.mnemonic, input.identity.path);
    const draft = await buildMvcFileInscriptionDraft({
      identity: input.identity,
      request: input.request,
      utxos: await this.fetchUtxos(address),
      feeRate: 1,
    });
    const userInputIndexes = Array.from({ length: draft.userInputCount }, (_, index) => index);
    const { txHex: rawTx } = await signMvcPreparedUserInputs({
      identity: input.identity,
      preparedTxHex: draft.unsignedTxHex,
      userInputs: draft.userInputs,
      userInputIndexes,
    });

    // Defer pending UTXO tracking until broadcast
    deferredTrackers.set(rawTx, {
      address,
      spentUtxos: draft.selectedUtxos,
      createdUtxosFactory: (txid: string) => extractOwnedOutputsFromPreparedMvcTx({
        txHex: rawTx,
        txId: txid,
        address,
      }),
    });

    const tx = new mvc.Transaction(rawTx);
    const inputTotal = draft.userInputs.reduce((sum, utxo) => sum + utxo.satoshis, 0);
    const outputTotal = tx.outputs.reduce((sum, output) => sum + output.satoshis, 0);

    return {
      signedRawTxs: [rawTx],
      revealIndices: [0],
      totalCost: inputTotal - outputTotal,
    };
  },
};

export default mvcChainAdapter;
