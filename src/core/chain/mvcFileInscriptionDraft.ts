import { TxComposer, mvc } from 'meta-contract';
import type { DerivedIdentity } from '../identity/deriveIdentity';
import type { ChainUtxo } from './adapters/types';
import { chainWritePayloadToBuffer, type NormalizedChainWriteRequest } from './writePin';
import { resolveSpendableMvcUtxos } from './mvcPendingUtxos';
import { buildMvcSigningIdentity } from './mvcSigningIdentity';

const NET = 'livenet';
const P2PKH_INPUT_SIZE = 148;

export interface MvcFileInscriptionDraft {
  address: string;
  privateKey: unknown;
  userInputs: ChainUtxo[];
  selectedUtxos: ChainUtxo[];
  userInputCount: number;
  unsignedTxHex: string;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOutpointTxid(value: string): string {
  return normalizeText(value).toLowerCase();
}

function pickUtxos(
  utxos: ChainUtxo[],
  totalOutput: number,
  feeRate: number,
  estimatedTxSizeWithoutInputs: number,
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

function buildOpReturnParts(input: NormalizedChainWriteRequest): Array<string | Buffer> {
  const parts: Array<string | Buffer> = ['metaid', input.operation];
  if (input.operation !== 'init') {
    parts.push(input.path.toLowerCase());
    parts.push(input.encryption);
    parts.push(input.version);
    parts.push(input.contentType);
    parts.push(chainWritePayloadToBuffer(input));
  }
  return parts;
}

function getOpReturnScriptSize(parts: Array<string | Buffer>): number {
  let size = 1;
  for (const part of parts) {
    const length = Buffer.isBuffer(part) ? part.length : Buffer.byteLength(part, 'utf8');
    if (length < 76) size += 1 + length;
    else if (length <= 0xff) size += 2 + length;
    else if (length <= 0xffff) size += 3 + length;
    else size += 5 + length;
  }
  return size;
}

function getEstimatedBaseTxSize(opReturnScriptSize: number): number {
  return 4 + 1 + 1 + 43 + (9 + opReturnScriptSize) + 4;
}

export async function buildMvcFileInscriptionDraft(input: {
  identity: DerivedIdentity;
  request: NormalizedChainWriteRequest;
  utxos: ChainUtxo[];
  feeRate?: number;
}): Promise<MvcFileInscriptionDraft> {
  const feeRate = Number.isFinite(input.feeRate) && Number(input.feeRate) > 0 ? Number(input.feeRate) : 1;
  const { privateKey, address } = buildMvcSigningIdentity(input.identity);
  const usableUtxos = resolveSpendableMvcUtxos({ address, utxos: input.utxos });
  const opReturnParts = buildOpReturnParts(input.request);
  const txComposer = new TxComposer();
  const addressObject = new mvc.Address(address, mvc.Networks.livenet as never);

  txComposer.appendP2PKHOutput({ address: addressObject, satoshis: 1 });
  txComposer.appendOpReturnOutput(opReturnParts);

  const totalOutput = txComposer.tx.outputs.reduce((sum, output) => sum + output.satoshis, 0);
  const picked = pickUtxos(
    usableUtxos,
    totalOutput,
    feeRate,
    getEstimatedBaseTxSize(getOpReturnScriptSize(opReturnParts)),
  );
  for (const utxo of picked) {
    txComposer.appendP2PKHInput({
      address: addressObject,
      txId: utxo.txId,
      outputIndex: utxo.outputIndex,
      satoshis: utxo.satoshis,
    });
  }
  txComposer.appendChangeOutput(addressObject, feeRate);

  return {
    address,
    privateKey,
    userInputs: picked,
    selectedUtxos: picked,
    userInputCount: picked.length,
    unsignedTxHex: txComposer.getRawHex(),
  };
}

export async function signMvcPreparedUserInputs(input: {
  identity: DerivedIdentity;
  preparedTxHex: string;
  userInputs: ChainUtxo[];
  userInputIndexes: number[];
}): Promise<{ txHex: string }> {
  const { privateKey } = buildMvcSigningIdentity(input.identity);
  const txComposer = new TxComposer(new mvc.Transaction(input.preparedTxHex));
  for (const [userInputOffset, inputIndex] of input.userInputIndexes.entries()) {
    const utxo = input.userInputs[userInputOffset];
    if (!utxo) {
      throw new Error(`Missing user-owned MVC UTXO descriptor for prepared input index ${inputIndex}.`);
    }
    txComposer.tx.inputs[inputIndex].output = new mvc.Transaction.Output({
      script: mvc.Script.buildPublicKeyHashOut(new mvc.Address(utxo.address, mvc.Networks.livenet as never)),
      satoshis: utxo.satoshis,
    });
    txComposer.unlockP2PKHInput(privateKey as never, inputIndex);
  }
  return { txHex: txComposer.getRawHex() };
}

export function extractOwnedOutputsFromPreparedMvcTx(input: {
  txHex: string;
  txId: string;
  address: string;
}): ChainUtxo[] {
  const txId = normalizeOutpointTxid(input.txId);
  if (!txId) return [];

  const tx = new mvc.Transaction(input.txHex);
  const address = normalizeText(input.address);
  const owned: ChainUtxo[] = [];

  tx.outputs.forEach((output, outputIndex) => {
    let outputAddress = '';
    try {
      const resolved = output.script?.toAddress?.(NET);
      outputAddress = normalizeText(resolved == null ? '' : String(resolved));
    } catch {
      outputAddress = '';
    }
    const satoshis = Number(output.satoshis ?? 0);
    if (outputAddress === address && Number.isFinite(satoshis) && satoshis > 0) {
      owned.push({ txId, outputIndex, satoshis, address, height: 0 });
    }
  });

  return owned;
}
