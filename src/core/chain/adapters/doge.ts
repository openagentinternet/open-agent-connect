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

// ---- DOGE bitcoin network parameters ----

const DOGE_NETWORK: bitcoin.Network = {
  messagePrefix: '\x19Dogecoin Signed Message:\n',
  bech32: '',
  bip32: { public: 0x02facafd, private: 0x02fac398 },
  pubKeyHash: 0x1e,
  scriptHash: 0x16,
  wif: 0x9e,
};

// ---- DOGE inscription constants ----

const MAX_CHUNK_LEN = 240;
const INSCRIPTION_OUTPUT_VALUE = 1_000_000; // 0.01 DOGE for the P2SH output
const P2SH_DUST_LIMIT = 600;

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

// ---- P2SH commit-reveal inscription helpers (ported from DogeInscribe) ----

function pushData(data: Buffer): Buffer {
  const len = data.length;
  if (len === 0) {
    return Buffer.from([bitcoin.opcodes.OP_0]);
  }
  if (len < 76) {
    return Buffer.concat([Buffer.from([len]), data]);
  }
  if (len <= 0xff) {
    return Buffer.concat([Buffer.from([bitcoin.opcodes.OP_PUSHDATA1, len]), data]);
  }
  if (len <= 0xffff) {
    const lenBuf = Buffer.alloc(2);
    lenBuf.writeUInt16LE(len);
    return Buffer.concat([Buffer.from([bitcoin.opcodes.OP_PUSHDATA2]), lenBuf, data]);
  }
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(len);
  return Buffer.concat([Buffer.from([bitcoin.opcodes.OP_PUSHDATA4]), lenBuf, data]);
}

interface InscriptionData {
  operation: string;
  path: string;
  contentType: string;
  encryption: string;
  version: string;
  body: string | Buffer;
  revealAddr: string;
  encoding?: BufferEncoding;
}

function buildMetaIdInscriptionScript(data: InscriptionData): Buffer {
  const body =
    typeof data.body === 'string'
      ? Buffer.from(data.body, data.encoding || 'utf8')
      : data.body || Buffer.alloc(0);
  const bodyParts: Buffer[] = [];
  for (let i = 0; i < body.length; i += MAX_CHUNK_LEN) {
    bodyParts.push(body.slice(i, Math.min(i + MAX_CHUNK_LEN, body.length)));
  }
  if (bodyParts.length === 0) bodyParts.push(Buffer.alloc(0));

  const chunks: Buffer[] = [];
  chunks.push(pushData(Buffer.from('metaid')));
  chunks.push(pushData(Buffer.from(data.operation)));
  chunks.push(pushData(Buffer.from(data.contentType || 'text/plain')));
  chunks.push(pushData(Buffer.from(data.encryption || '0')));
  chunks.push(pushData(Buffer.from(data.version || '0.0.1')));
  chunks.push(pushData(Buffer.from(data.path || '')));
  for (const part of bodyParts) chunks.push(pushData(part));
  return Buffer.concat(chunks);
}

function buildLockScript(publicKey: Buffer, inscriptionScript: Buffer): Buffer {
  const chunks: Buffer[] = [];
  chunks.push(pushData(publicKey));
  chunks.push(Buffer.from([bitcoin.opcodes.OP_CHECKSIGVERIFY]));
  const dropCount = countScriptChunks(inscriptionScript);
  for (let i = 0; i < dropCount; i++) {
    chunks.push(Buffer.from([bitcoin.opcodes.OP_DROP]));
  }
  chunks.push(Buffer.from([bitcoin.opcodes.OP_TRUE]));
  return Buffer.concat(chunks);
}

function countScriptChunks(script: Buffer): number {
  let count = 0;
  let i = 0;
  while (i < script.length) {
    const opcode = script[i];
    if (opcode === 0) {
      count++;
      i++;
    } else if (opcode >= 1 && opcode <= 75) {
      count++;
      i += 1 + opcode;
    } else if (opcode === bitcoin.opcodes.OP_PUSHDATA1) {
      const len = script[i + 1];
      count++;
      i += 2 + len;
    } else if (opcode === bitcoin.opcodes.OP_PUSHDATA2) {
      const len = script[i + 1] | (script[i + 2] << 8);
      count++;
      i += 3 + len;
    } else if (opcode === bitcoin.opcodes.OP_PUSHDATA4) {
      const len =
        script[i + 1] |
        (script[i + 2] << 8) |
        (script[i + 3] << 16) |
        (script[i + 4] << 24);
      count++;
      i += 5 + len;
    } else {
      i++;
    }
  }
  return count;
}

function hash160(data: Buffer): Buffer {
  return bitcoin.crypto.hash160(data);
}

function buildP2SHOutputScript(lockScript: Buffer): Buffer {
  const lockHash = hash160(lockScript);
  return Buffer.concat([
    Buffer.from([bitcoin.opcodes.OP_HASH160]),
    pushData(lockHash),
    Buffer.from([bitcoin.opcodes.OP_EQUAL]),
  ]);
}

function buildP2PKHOutputScript(address: string, _network: bitcoin.Network): Buffer {
  const decoded = bitcoin.address.fromBase58Check(address);
  return Buffer.concat([
    Buffer.from([bitcoin.opcodes.OP_DUP, bitcoin.opcodes.OP_HASH160]),
    pushData(decoded.hash),
    Buffer.from([bitcoin.opcodes.OP_EQUALVERIFY, bitcoin.opcodes.OP_CHECKSIG]),
  ]);
}

function estimateTxSize(
  p2pkhInputCount: number,
  outputCount: number,
  p2shUnlockScriptSize = 0
): number {
  let size = 10;
  if (p2shUnlockScriptSize > 0) {
    size += 32 + 4 + 3 + p2shUnlockScriptSize + 4;
  }
  size += p2pkhInputCount * 148;
  size += outputCount * 34;
  return size;
}

function selectUtxos(
  availableUtxos: ChainUtxo[],
  targetAmount: number,
  feeRate: number,
  outputCount: number,
  p2shUnlockScriptSize = 0
): { selectedUtxos: ChainUtxo[]; fee: number; totalInput: number } {
  const selectedUtxos: ChainUtxo[] = [];
  let totalInput = 0;
  const sortedUtxos = [...availableUtxos].sort((a, b) => b.satoshis - a.satoshis);
  for (const utxo of sortedUtxos) {
    selectedUtxos.push(utxo);
    totalInput += utxo.satoshis;
    const txSize = estimateTxSize(
      selectedUtxos.length,
      outputCount,
      p2shUnlockScriptSize
    );
    const fee = Math.ceil((txSize * feeRate) / 1000);
    if (totalInput >= targetAmount + fee) {
      return { selectedUtxos, fee, totalInput };
    }
  }
  throw new Error(`Insufficient funds: need ${targetAmount}, have ${totalInput}`);
}

function signP2PKHInput(
  tx: bitcoin.Transaction,
  inputIndex: number,
  keyPair: { publicKey: Buffer; sign(hash: Buffer): Buffer },
  prevOutputScript: Buffer
): Buffer {
  const sigHash = tx.hashForSignature(
    inputIndex,
    prevOutputScript,
    bitcoin.Transaction.SIGHASH_ALL
  );
  const signature = keyPair.sign(sigHash);
  const signatureDER = bitcoin.script.signature.encode(
    signature,
    bitcoin.Transaction.SIGHASH_ALL
  );
  return Buffer.concat([
    pushData(signatureDER),
    pushData(keyPair.publicKey),
  ]);
}

function signP2SHInput(
  tx: bitcoin.Transaction,
  inputIndex: number,
  tempKeyPair: { publicKey: Buffer; sign(hash: Buffer): Buffer },
  lockScript: Buffer,
  inscriptionScript: Buffer
): Buffer {
  const sigHash = tx.hashForSignature(inputIndex, lockScript, bitcoin.Transaction.SIGHASH_ALL);
  const signature = tempKeyPair.sign(sigHash);
  const signatureDER = bitcoin.script.signature.encode(
    signature,
    bitcoin.Transaction.SIGHASH_ALL
  );
  return Buffer.concat([
    inscriptionScript,
    pushData(signatureDER),
    pushData(lockScript),
  ]);
}

interface ECPairInstance {
  fromWIF(wifString: string, network?: bitcoin.Network): { publicKey: Buffer; sign(hash: Buffer): Buffer };
  makeRandom(options?: { network?: bitcoin.Network }): { publicKey: Buffer; sign(hash: Buffer): Buffer };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildDogeInscriptionTxs(
  metaidData: InscriptionData,
  utxos: ChainUtxo[],
  walletKeyPair: { publicKey: Buffer; sign(hash: Buffer): Buffer },
  feeRate: number,
  changeAddress: string,
  network: bitcoin.Network,
  revealOutValue: number,
  ecpairInstance: ECPairInstance
): {
  commitTx: bitcoin.Transaction;
  revealTx: bitcoin.Transaction;
  commitFee: number;
  revealFee: number;
} {
  const tempKeyPair = ecpairInstance.makeRandom({ network });
  const inscriptionScript = buildMetaIdInscriptionScript(metaidData);
  const lockScript = buildLockScript(tempKeyPair.publicKey, inscriptionScript);
  const p2shOutputScript = buildP2SHOutputScript(lockScript);
  const estimatedUnlockSize = inscriptionScript.length + 72 + lockScript.length + 10;

  const commitTx = new bitcoin.Transaction();
  commitTx.version = 2;
  commitTx.addOutput(p2shOutputScript, INSCRIPTION_OUTPUT_VALUE);

  const { selectedUtxos: commitUtxos, fee: commitFee, totalInput: commitTotalInput } =
    selectUtxos(utxos, INSCRIPTION_OUTPUT_VALUE, feeRate, 2, 0);

  for (const utxo of commitUtxos) {
    commitTx.addInput(Buffer.from(utxo.txId, 'hex').reverse(), utxo.outputIndex);
  }
  const commitChange = commitTotalInput - INSCRIPTION_OUTPUT_VALUE - commitFee;
  if (commitChange >= P2SH_DUST_LIMIT) {
    commitTx.addOutput(
      buildP2PKHOutputScript(changeAddress, network),
      commitChange
    );
  }
  for (let i = 0; i < commitUtxos.length; i++) {
    const utxo = commitUtxos[i];
    const prevScript = buildP2PKHOutputScript(utxo.address, network);
    const sig = signP2PKHInput(commitTx, i, walletKeyPair, prevScript);
    commitTx.setInputScript(i, sig);
  }

  const revealTx = new bitcoin.Transaction();
  revealTx.version = 2;
  const commitTxId = commitTx.getId();
  revealTx.addInput(Buffer.from(commitTxId, 'hex').reverse(), 0);
  revealTx.addOutput(
    buildP2PKHOutputScript(metaidData.revealAddr, network),
    revealOutValue
  );

  const availableUtxos = utxos.filter(
    (u) => !commitUtxos.some((c) => c.txId === u.txId && c.outputIndex === u.outputIndex)
  );
  if (commitChange >= P2SH_DUST_LIMIT) {
    availableUtxos.push({
      txId: commitTxId,
      outputIndex: commitTx.outs.length - 1,
      satoshis: commitChange,
      address: changeAddress,
      height: 0,
    });
  }

  const { selectedUtxos: revealUtxos, fee: revealFee, totalInput: revealTotalInput } =
    selectUtxos(
      availableUtxos,
      revealOutValue - INSCRIPTION_OUTPUT_VALUE,
      feeRate,
      2,
      estimatedUnlockSize
    );
  for (const utxo of revealUtxos) {
    revealTx.addInput(Buffer.from(utxo.txId, 'hex').reverse(), utxo.outputIndex);
  }
  const revealChange =
    INSCRIPTION_OUTPUT_VALUE + revealTotalInput - revealOutValue - revealFee;
  if (revealChange >= P2SH_DUST_LIMIT) {
    revealTx.addOutput(
      buildP2PKHOutputScript(changeAddress, network),
      revealChange
    );
  }
  for (let i = 0; i < revealUtxos.length; i++) {
    const utxo = revealUtxos[i];
    const prevScript = buildP2PKHOutputScript(utxo.address, network);
    const sig = signP2PKHInput(revealTx, i + 1, walletKeyPair, prevScript);
    revealTx.setInputScript(i + 1, sig);
  }
  const unlockScript = signP2SHInput(
    revealTx,
    0,
    tempKeyPair,
    lockScript,
    inscriptionScript
  );
  revealTx.setInputScript(0, unlockScript);

  return { commitTx, revealTx, commitFee, revealFee };
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
    try {
      const feeRate = Number.isFinite(input.feeRate) && Number(input.feeRate) > 0
        ? input.feeRate! : await this.fetchFeeRate();
      const wallet = buildDogeWallet(input.identity.mnemonic, input.identity.path);
      const address = wallet.getAddress();
      const privateKeyWIF = wallet.getPrivateKey();
      const network = wallet.getNetwork() as unknown as bitcoin.Network;

      // Initialize ECC library
      const ecc = await import('@bitcoinerlab/secp256k1');
      bitcoin.initEccLib(ecc.default);
      const ECPairInstance = ECPairFactory(ecc.default);

      // Create wallet key pair from private key WIF
      const walletKeyPair = ECPairInstance.fromWIF(privateKeyWIF, DOGE_NETWORK);

      // Fetch UTXOs
      const utxos = await this.fetchUtxos(address);
      if (!utxos.length) {
        throw new Error('MetaBot DOGE balance is insufficient for this chain write.');
      }

      // Build inscription data from the normalized request
      const payloadBody = input.request.encoding === 'base64'
        ? Buffer.from(input.request.payload, 'base64')
        : Buffer.from(input.request.payload, 'utf-8');

      const metaidData: InscriptionData = {
        operation: input.request.operation,
        path: input.request.path,
        contentType: input.request.contentType,
        encryption: input.request.encryption,
        version: input.request.version,
        body: payloadBody,
        revealAddr: address,
        encoding: input.request.encoding === 'base64' ? 'base64' : 'utf-8',
      };

      // Build commit + reveal transactions using custom bitcoinjs-lib logic
      const { commitTx, revealTx, commitFee, revealFee } = buildDogeInscriptionTxs(
        metaidData,
        utxos,
        walletKeyPair,
        feeRate,
        address,
        network,
        INSCRIPTION_OUTPUT_VALUE,
        ECPairInstance
      );

      const signedRawTxs = [commitTx.toHex(), revealTx.toHex()];
      const revealIndices = [1];
      const totalCost = commitFee + revealFee;

      return {
        signedRawTxs,
        revealIndices,
        totalCost: Number.isFinite(totalCost) ? totalCost : 0,
      };
    } catch (err) {
      throw new Error(
        `DOGE buildInscription failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  },
};

export default dogeChainAdapter;
