import { mvc } from 'meta-contract';
import * as bitcoin from 'bitcoinjs-lib';
import type { ChainAdapter, ChainAdapterRegistry } from '../chain/adapters/types';

export type VerifiableServicePaymentChain = 'mvc' | 'btc';

export interface VerifyServiceOrderPaymentInput {
  adapters: ChainAdapterRegistry;
  paymentTxid?: string | null;
  paymentChain?: string | null;
  settlementKind?: string | null;
  paymentAddress?: string | null;
  amount: string;
  currency: string;
}

export interface VerifiedServiceOrderPayment {
  verified: boolean;
  paymentTxid: string | null;
  paymentChain: VerifiableServicePaymentChain | null;
  settlementKind: 'native' | 'free';
  paymentAddress: string | null;
  amount: string;
  currency: string;
  amountSatoshis: number;
  matchedOutputIndex: number | null;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeCurrency(value: unknown): string {
  const normalized = normalizeText(value).toUpperCase();
  return normalized === 'MVC' ? 'SPACE' : normalized;
}

function normalizePaymentChain(value: unknown, currency: string): VerifiableServicePaymentChain | '' {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'mvc' || normalized === 'btc') return normalized;
  const normalizedCurrency = normalizeCurrency(currency);
  if (normalizedCurrency === 'BTC') return 'btc';
  if (normalizedCurrency === 'SPACE') return 'mvc';
  return '';
}

export function decimalPaymentAmountToSatoshis(value: string): number {
  const amount = normalizeText(value);
  if (!/^\d+(?:\.\d{1,8})?$/.test(amount)) {
    throw new Error('service_payment_invalid_amount: Service payment amount must have at most 8 decimal places.');
  }
  const [wholeRaw, fractionRaw = ''] = amount.split('.');
  const whole = Number.parseInt(wholeRaw || '0', 10);
  const fraction = Number.parseInt(fractionRaw.padEnd(8, '0') || '0', 10);
  const satoshis = whole * 100_000_000 + fraction;
  if (!Number.isSafeInteger(satoshis) || satoshis < 0) {
    throw new Error('service_payment_invalid_amount: Service payment amount is out of range.');
  }
  return satoshis;
}

function readMvcOutputAddress(output: { script?: { toAddress?: (network?: unknown) => unknown } }): string {
  try {
    const address = output.script?.toAddress?.(mvc.Networks.livenet);
    return address == null ? '' : String(address).trim();
  } catch {
    return '';
  }
}

function findMvcPaymentOutput(input: {
  rawTx: string;
  paymentAddress: string;
  amountSatoshis: number;
}): number | null {
  const tx = new mvc.Transaction(input.rawTx);
  const outputs = Array.isArray(tx.outputs) ? tx.outputs : [];
  const index = outputs.findIndex((output) => (
    Number(output.satoshis ?? 0) >= input.amountSatoshis
    && readMvcOutputAddress(output as any) === input.paymentAddress
  ));
  return index >= 0 ? index : null;
}

function findBtcPaymentOutput(input: {
  rawTx: string;
  paymentAddress: string;
  amountSatoshis: number;
}): number | null {
  const tx = bitcoin.Transaction.fromHex(input.rawTx);
  const index = tx.outs.findIndex((output) => {
    if (Number(output.value) < input.amountSatoshis) {
      return false;
    }
    try {
      return bitcoin.address.fromOutputScript(output.script, bitcoin.networks.bitcoin) === input.paymentAddress;
    } catch {
      return false;
    }
  });
  return index >= 0 ? index : null;
}

async function findMvcPaymentUtxoFallback(input: {
  adapter: ChainAdapter;
  paymentTxid: string;
  paymentAddress: string;
  amountSatoshis: number;
}): Promise<number | null> {
  const utxos = await input.adapter.fetchUtxos(input.paymentAddress);
  const match = utxos.find((utxo) => (
    normalizeText(utxo.txId).toLowerCase() === input.paymentTxid.toLowerCase()
    && normalizeText(utxo.address) === input.paymentAddress
    && Number(utxo.satoshis ?? 0) >= input.amountSatoshis
  ));
  return match ? match.outputIndex : null;
}

export async function verifyServiceOrderPayment(
  input: VerifyServiceOrderPaymentInput
): Promise<VerifiedServiceOrderPayment> {
  const amount = normalizeText(input.amount) || '0';
  const currency = normalizeCurrency(input.currency);
  const amountSatoshis = decimalPaymentAmountToSatoshis(amount);
  const paymentTxid = normalizeText(input.paymentTxid) || null;
  const settlementKind = normalizeText(input.settlementKind).toLowerCase() === 'free' || amountSatoshis === 0
    ? 'free'
    : 'native';
  const paymentChain = settlementKind === 'free'
    ? null
    : normalizePaymentChain(input.paymentChain, currency);
  const paymentAddress = normalizeText(input.paymentAddress) || null;

  if (settlementKind === 'free') {
    return {
      verified: !paymentTxid && amountSatoshis === 0,
      paymentTxid: null,
      paymentChain: null,
      settlementKind,
      paymentAddress: null,
      amount,
      currency,
      amountSatoshis,
      matchedOutputIndex: null,
    };
  }

  if (!paymentTxid || !paymentChain || !paymentAddress || amountSatoshis <= 0) {
    return {
      verified: false,
      paymentTxid,
      paymentChain: paymentChain || null,
      settlementKind,
      paymentAddress,
      amount,
      currency,
      amountSatoshis,
      matchedOutputIndex: null,
    };
  }

  const adapter = input.adapters.get(paymentChain);
  if (!adapter) {
    return {
      verified: false,
      paymentTxid,
      paymentChain,
      settlementKind,
      paymentAddress,
      amount,
      currency,
      amountSatoshis,
      matchedOutputIndex: null,
    };
  }

  let matchedOutputIndex: number | null = null;
  try {
    const rawTx = await adapter.fetchRawTx(paymentTxid);
    matchedOutputIndex = paymentChain === 'btc'
      ? findBtcPaymentOutput({ rawTx, paymentAddress, amountSatoshis })
      : findMvcPaymentOutput({ rawTx, paymentAddress, amountSatoshis });
  } catch (error) {
    if (paymentChain !== 'mvc') {
      throw error;
    }
    matchedOutputIndex = await findMvcPaymentUtxoFallback({
      adapter,
      paymentTxid,
      paymentAddress,
      amountSatoshis,
    }).catch(() => null);
  }

  return {
    verified: matchedOutputIndex !== null,
    paymentTxid,
    paymentChain,
    settlementKind,
    paymentAddress,
    amount,
    currency,
    amountSatoshis,
    matchedOutputIndex,
  };
}
