import { TxComposer, mvc } from 'meta-contract';
import { parseAddressIndexFromPath, type DerivedIdentity } from '../identity/deriveIdentity';
import type { ChainUtxo } from './adapters/types';
import { getMvcUtxoOutpointKey } from './mvcPendingUtxos';

const NET = 'livenet';
const P2PKH_INPUT_SIZE = 148;
const PRE_TX_SIGTYPE =
  mvc.crypto.Signature.SIGHASH_NONE | mvc.crypto.Signature.SIGHASH_FORKID;

export interface MvcLargeUploadFundingResult {
  mergeTxHex: string;
  mergeTxId: string;
  chunkPreTxHex: string;
  indexPreTxHex: string;
  chunkPreTxOutputAmount: number;
  indexPreTxOutputAmount: number;
  spentUtxos: ChainUtxo[];
  spentOutpoints: string[];
  changeUtxo: ChainUtxo | null;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readPositiveNumber(name: string, value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return numeric;
}

function readPositiveInteger(name: string, value: unknown): number {
  const numeric = readPositiveNumber(name, value);
  if (!Number.isInteger(numeric)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return numeric;
}

function buildMvcSigningIdentity(mnemonic: string, path: string): {
  privateKey: unknown;
  address: string;
} {
  const network = mvc.Networks.livenet;
  const addressIndex = parseAddressIndexFromPath(path);
  const mnemonicObject = mvc.Mnemonic.fromString(mnemonic);
  const hdPrivateKey = mnemonicObject.toHDPrivateKey('', network as never);
  const childPrivateKey = hdPrivateKey.deriveChild(`m/44'/10001'/0'/0/${addressIndex}`);
  return {
    privateKey: childPrivateKey.privateKey,
    address: childPrivateKey.publicKey.toAddress(network as never).toString(),
  };
}

function isUsableFundingUtxo(utxo: ChainUtxo, fundingAddress: string): boolean {
  return (
    normalizeText(utxo.address) === fundingAddress &&
    /^[0-9a-f]{64}:\d+$/u.test(getMvcUtxoOutpointKey({
      txId: utxo.txId,
      outputIndex: utxo.outputIndex,
    }))
    && Number.isInteger(utxo.outputIndex)
    && utxo.outputIndex >= 0
    && Number.isInteger(utxo.satoshis)
    && utxo.satoshis >= 600
  );
}

function selectFundingUtxos(input: {
  utxos: ChainUtxo[];
  outputAmount: number;
  feeRate: number;
  fundingAddress: string;
  excludedOutpoints: ReadonlySet<string>;
}): ChainUtxo[] {
  const candidates = input.utxos.filter((utxo) => {
    if (!isUsableFundingUtxo(utxo, input.fundingAddress)) return false;
    const outpoint = getMvcUtxoOutpointKey({
      txId: utxo.txId,
      outputIndex: utxo.outputIndex,
    });
    return !input.excludedOutpoints.has(outpoint);
  });

  if (candidates.length === 0) {
    throw new Error('No spendable MVC UTXOs are available for large upload funding.');
  }

  let current = 0;
  const selected: ChainUtxo[] = [];
  for (const utxo of candidates) {
    current += utxo.satoshis;
    selected.push(utxo);
    const estimatedRequired = input.outputAmount
      + Math.ceil((100 + (34 * 2) + (selected.length * P2PKH_INPUT_SIZE)) * input.feeRate);
    if (current > estimatedRequired) {
      return selected;
    }
  }

  throw new Error('Insufficient MVC balance for large upload funding.');
}

function buildPreTx(input: {
  mergeTxId: string;
  outputIndex: number;
  satoshis: number;
  address: string;
  privateKey: unknown;
}): string {
  const txComposer = new TxComposer();
  txComposer.appendP2PKHInput({
    address: new mvc.Address(input.address, NET as never),
    txId: input.mergeTxId,
    outputIndex: input.outputIndex,
    satoshis: input.satoshis,
  });
  txComposer.unlockP2PKHInput(input.privateKey as never, 0, PRE_TX_SIGTYPE);
  return txComposer.getRawHex();
}

export async function buildMvcLargeUploadFunding(input: {
  identity: DerivedIdentity;
  address?: string;
  feeRate: number;
  chunkPreTxFee: number;
  indexPreTxFee: number;
  utxos: ChainUtxo[];
  excludedOutpoints?: ReadonlySet<string>;
}): Promise<MvcLargeUploadFundingResult> {
  const feeRate = readPositiveNumber('feeRate', input.feeRate);
  const chunkPreTxFee = readPositiveInteger('chunkPreTxFee', input.chunkPreTxFee);
  const indexPreTxFee = readPositiveInteger('indexPreTxFee', input.indexPreTxFee);
  const signingIdentity = buildMvcSigningIdentity(input.identity.mnemonic, input.identity.path);
  const derivedAddress = normalizeText(signingIdentity.address);
  if (!derivedAddress) {
    throw new Error('MVC funding address is required for large upload funding.');
  }
  const requestedAddress = normalizeText(input.address)
    || normalizeText(input.identity.addresses?.mvc)
    || normalizeText(input.identity.mvcAddress);
  if (requestedAddress && requestedAddress !== derivedAddress) {
    throw new Error('MVC funding address does not match derived MVC address.');
  }
  const address = derivedAddress;

  const chunkPreTxOutputAmount = chunkPreTxFee + Math.ceil((200 + 150) * feeRate);
  const indexPreTxOutputAmount = indexPreTxFee + Math.ceil((200 + 150) * feeRate);
  const outputAmount = chunkPreTxOutputAmount + indexPreTxOutputAmount;
  const spentUtxos = selectFundingUtxos({
    utxos: input.utxos,
    outputAmount,
    feeRate,
    fundingAddress: address,
    excludedOutpoints: input.excludedOutpoints ?? new Set(),
  });

  const privateKey = signingIdentity.privateKey;
  const addressObject = new mvc.Address(address, mvc.Networks.livenet as never);
  const mergeComposer = new TxComposer();
  mergeComposer.appendP2PKHOutput({
    address: addressObject,
    satoshis: chunkPreTxOutputAmount,
  });
  mergeComposer.appendP2PKHOutput({
    address: addressObject,
    satoshis: indexPreTxOutputAmount,
  });
  for (const utxo of spentUtxos) {
    mergeComposer.appendP2PKHInput({
      address: addressObject,
      txId: utxo.txId,
      outputIndex: utxo.outputIndex,
      satoshis: utxo.satoshis,
    });
  }
  mergeComposer.appendChangeOutput(addressObject, feeRate);

  for (let inputIndex = 0; inputIndex < mergeComposer.tx.inputs.length; inputIndex += 1) {
    mergeComposer.unlockP2PKHInput(privateKey as never, inputIndex);
  }

  const mergeTxHex = mergeComposer.getRawHex();
  const mergeTx = new mvc.Transaction(mergeTxHex);
  const mergeTxId = mergeTx.id;
  const changeIndex = mergeTx.outputs.length > 2 ? mergeTx.outputs.length - 1 : -1;
  const changeUtxo = changeIndex >= 0
    ? {
      txId: mergeTxId,
      outputIndex: changeIndex,
      satoshis: Number(mergeTx.outputs[changeIndex].satoshis),
      address,
      height: 0,
    }
    : null;

  return {
    mergeTxHex,
    mergeTxId,
    chunkPreTxHex: buildPreTx({
      mergeTxId,
      outputIndex: 0,
      satoshis: Number(mergeTx.outputs[0].satoshis),
      address,
      privateKey,
    }),
    indexPreTxHex: buildPreTx({
      mergeTxId,
      outputIndex: 1,
      satoshis: Number(mergeTx.outputs[1].satoshis),
      address,
      privateKey,
    }),
    chunkPreTxOutputAmount,
    indexPreTxOutputAmount,
    spentUtxos,
    spentOutpoints: spentUtxos.map((utxo) => getMvcUtxoOutpointKey({
      txId: utxo.txId,
      outputIndex: utxo.outputIndex,
    })),
    changeUtxo,
  };
}
