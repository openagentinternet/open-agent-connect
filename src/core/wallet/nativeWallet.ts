import { commandAwaitingConfirmation, commandFailed, commandSuccess, type MetabotCommandResult } from '../contracts/commandResult';
import type { ChainWriteNetwork } from '../chain/writePin';
import type { ChainAdapter, ChainAdapterRegistry } from '../chain/adapters/types';
import type { DerivedIdentity } from '../identity/deriveIdentity';
import type { SecretStore } from '../secrets/secretStore';
import { executeTransfer } from '../signing/localMnemonicSigner';

export const NATIVE_WALLET_CHAINS = ['mvc', 'btc', 'doge', 'opcat'] as const;
export const NATIVE_TRANSFER_UNITS = { mvc: 'SPACE', btc: 'BTC', doge: 'DOGE', opcat: 'OPCAT' } as const;

const DEFAULT_DERIVATION_PATH = "m/44'/10001'/0'/0/0";
const ESTIMATED_TRANSFER_VBYTES = 392;

export type NativeWalletChain = typeof NATIVE_WALLET_CHAINS[number];
export type NativeTransferUnit = typeof NATIVE_TRANSFER_UNITS[NativeWalletChain];

export interface ParsedWalletTransferAmount {
  chain: NativeWalletChain;
  currency: NativeTransferUnit;
  satoshis: number;
  adapter: ChainAdapter;
}

export interface QueryWalletBalancesInput {
  identity: Pick<DerivedIdentity, 'globalMetaId' | 'mvcAddress' | 'addresses'>;
  adapters: ChainAdapterRegistry;
  chain: string;
}

export interface WalletTransferOperationInput {
  identity: Pick<DerivedIdentity, 'globalMetaId' | 'mvcAddress' | 'addresses' | 'path'>;
  adapters: ChainAdapterRegistry;
  toAddress: string;
  amountRaw: string;
}

export interface WalletConfirmTransferInput extends WalletTransferOperationInput {
  secretStore: Pick<SecretStore, 'readIdentitySecrets'>;
}

interface PreparedWalletTransfer {
  parsed: ParsedWalletTransferAmount;
  fromAddress: string;
  feeRate: number;
  feeRateSatPerVb: number;
  estimatedFeeSatoshis: number;
  balance: Awaited<ReturnType<ChainAdapter['fetchBalance']>>;
}

function isNativeWalletChain(chain: string): chain is NativeWalletChain {
  return (NATIVE_WALLET_CHAINS as readonly string[]).includes(chain);
}

function formatNativeAmount(satoshis: number, currency: NativeTransferUnit): string {
  return `${(satoshis / 100_000_000).toFixed(8)} ${currency}`;
}

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isInsufficientBalanceError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('insufficient') || lower.includes('not enough') || lower.includes('余额不足');
}

export function decimalAmountToSatoshis(value: string): number {
  const amount = value.trim();
  if (!/^\d+(?:\.\d{1,8})?$/.test(amount)) {
    throw new Error('Invalid amount. Amount must be a positive decimal number with at most 8 decimal places.');
  }

  const [wholeRaw, fractionRaw = ''] = amount.split('.');
  const whole = Number.parseInt(wholeRaw, 10);
  const fraction = Number.parseInt(fractionRaw.padEnd(8, '0') || '0', 10);
  const satoshis = whole * 100_000_000 + fraction;
  if (!Number.isSafeInteger(satoshis) || satoshis <= 0) {
    throw new Error('Invalid amount. Amount must be positive.');
  }
  return satoshis;
}

export function parseWalletTransferAmount(raw: string, adapters: ChainAdapterRegistry): ParsedWalletTransferAmount {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(\d+(?:\.\d{1,8})?)\s*(btc|space|doge|opcat)$/i);
  if (!match) {
    const supported = 'BTC, SPACE, DOGE, OPCAT';
    if (!/[a-z]/i.test(trimmed)) {
      throw new Error(`Missing currency unit. Append ${supported} to the amount. Example: 0.00001BTC, 1SPACE, 0.01DOGE, or 10OPCAT.`);
    }
    const unitMatch = trimmed.match(/[a-z]+$/i);
    if (unitMatch && !['BTC', 'SPACE', 'DOGE', 'OPCAT'].includes(unitMatch[0].toUpperCase())) {
      throw new Error(`Unsupported currency unit in "${raw}". Supported units: ${supported}.`);
    }
    throw new Error(`Invalid amount "${raw}". Amount must be positive and use at most 8 decimal places.`);
  }

  const currency = match[2].toUpperCase() as NativeTransferUnit;
  const chain: NativeWalletChain = currency === 'BTC'
    ? 'btc'
    : currency === 'DOGE'
      ? 'doge'
      : currency === 'OPCAT'
        ? 'opcat'
        : 'mvc';
  const adapter = adapters.get(chain);
  if (!adapter) {
    throw new Error(`No adapter registered for chain "${chain}".`);
  }

  return {
    chain,
    currency,
    satoshis: decimalAmountToSatoshis(match[1]),
    adapter,
  };
}

export function resolveIdentityChainAddress(
  identity: Pick<DerivedIdentity, 'addresses' | 'mvcAddress'>,
  chain: string,
): string | null {
  const address = identity.addresses?.[chain];
  if (typeof address === 'string' && address.trim()) {
    return address;
  }
  if (chain === 'mvc' && typeof identity.mvcAddress === 'string' && identity.mvcAddress.trim()) {
    return identity.mvcAddress;
  }
  return null;
}

function resolveTargetChains(chain: string, adapters: ChainAdapterRegistry): NativeWalletChain[] | MetabotCommandResult<never> {
  const targets = chain === 'all' ? [...NATIVE_WALLET_CHAINS] : [chain];
  const supported = `all, ${NATIVE_WALLET_CHAINS.join(', ')}`;

  for (const target of targets) {
    if (!isNativeWalletChain(target) || !adapters.has(target as ChainWriteNetwork)) {
      return commandFailed('invalid_flag', `Unsupported --chain value: ${target}. Supported values: ${supported}.`);
    }
  }
  return targets as NativeWalletChain[];
}

async function prepareWalletTransfer(input: WalletTransferOperationInput): Promise<PreparedWalletTransfer | MetabotCommandResult<never>> {
  let parsed: ParsedWalletTransferAmount;
  try {
    parsed = parseWalletTransferAmount(input.amountRaw, input.adapters);
  } catch (error) {
    return commandFailed('invalid_argument', normalizeErrorMessage(error));
  }

  if (parsed.satoshis < parsed.adapter.minTransferSatoshis) {
    return commandFailed('invalid_argument', `Amount is below the minimum of ${parsed.adapter.minTransferSatoshis} satoshis for ${parsed.currency}.`);
  }

  const fromAddress = resolveIdentityChainAddress(input.identity, parsed.chain);
  if (!fromAddress) {
    return commandFailed('identity_address_missing', `Current identity has no address for chain "${parsed.chain}".`);
  }

  const feeRate = await parsed.adapter.fetchFeeRate();
  const feeRateSatPerVb = parsed.adapter.feeRateUnit === 'sat/KB' ? feeRate / 1000 : feeRate;
  const estimatedFeeSatoshis = Math.ceil(ESTIMATED_TRANSFER_VBYTES * feeRateSatPerVb);
  const balance = await parsed.adapter.fetchBalance(fromAddress);
  const totalRequired = parsed.satoshis + estimatedFeeSatoshis;

  if (balance.totalSatoshis < totalRequired) {
    const unconfirmedNote = balance.unconfirmedSatoshis > 0
      ? ` (includes ${balance.unconfirmedSatoshis} unconfirmed sats)`
      : '';
    return commandFailed(
      'insufficient_balance',
      `Total balance ${balance.totalSatoshis} sats (${formatNativeAmount(balance.totalSatoshis, parsed.currency)})${unconfirmedNote} is below the required ${totalRequired} sats (${formatNativeAmount(parsed.satoshis, parsed.currency)} + estimated fee ${estimatedFeeSatoshis} sats).`,
    );
  }

  return {
    parsed,
    fromAddress,
    feeRate,
    feeRateSatPerVb,
    estimatedFeeSatoshis,
    balance,
  };
}

export async function queryWalletBalances(input: QueryWalletBalancesInput): Promise<MetabotCommandResult<unknown>> {
  const targetChains = resolveTargetChains(input.chain, input.adapters);
  if (!Array.isArray(targetChains)) {
    return targetChains;
  }

  try {
    const balances: Record<string, unknown> = {};
    for (const chain of targetChains) {
      const adapter = input.adapters.get(chain as ChainWriteNetwork);
      if (!adapter) {
        return commandFailed('invalid_flag', `Unsupported --chain value: ${chain}. Supported values: all, ${NATIVE_WALLET_CHAINS.join(', ')}.`);
      }
      const address = resolveIdentityChainAddress(input.identity, chain);
      if (!address) {
        return commandFailed('identity_address_missing', `Current identity has no address for chain "${chain}".`);
      }
      balances[chain] = await adapter.fetchBalance(address);
    }

    return commandSuccess({
      chain: input.chain,
      globalMetaId: input.identity.globalMetaId,
      balances,
    });
  } catch (error) {
    return commandFailed('wallet_balance_query_failed', normalizeErrorMessage(error));
  }
}

export async function previewWalletTransfer(input: WalletTransferOperationInput): Promise<MetabotCommandResult<unknown>> {
  const prepared = await prepareWalletTransfer(input);
  if ('ok' in prepared) {
    return prepared;
  }

  const unconfirmedNote = prepared.balance.unconfirmedSatoshis > 0
    ? ` (includes ${prepared.balance.unconfirmedSatoshis} unconfirmed sats)`
    : '';
  return commandAwaitingConfirmation({
    fromAddress: prepared.fromAddress,
    currentBalance: formatNativeAmount(prepared.balance.totalSatoshis, prepared.parsed.currency) + unconfirmedNote,
    currentBalanceSatoshis: prepared.balance.totalSatoshis,
    toAddress: input.toAddress,
    amount: formatNativeAmount(prepared.parsed.satoshis, prepared.parsed.currency),
    amountSatoshis: prepared.parsed.satoshis,
    estimatedFee: formatNativeAmount(prepared.estimatedFeeSatoshis, prepared.parsed.currency),
    estimatedFeeSatoshis: prepared.estimatedFeeSatoshis,
    feeRateSatPerVb: prepared.feeRateSatPerVb,
    currency: prepared.parsed.currency,
    chain: prepared.parsed.chain,
  });
}

export async function confirmWalletTransfer(input: WalletConfirmTransferInput): Promise<MetabotCommandResult<unknown>> {
  const prepared = await prepareWalletTransfer(input);
  if ('ok' in prepared) {
    return prepared;
  }

  const secrets = await input.secretStore.readIdentitySecrets();
  if (!secrets?.mnemonic) {
    return commandFailed('identity_secrets_missing', 'Identity mnemonic not found in the secret store.');
  }

  try {
    const result = await executeTransfer(prepared.parsed.adapter, {
      mnemonic: secrets.mnemonic,
      path: secrets.path ?? input.identity.path ?? DEFAULT_DERIVATION_PATH,
      toAddress: input.toAddress,
      amountSatoshis: prepared.parsed.satoshis,
      feeRate: prepared.feeRate,
    });

    return commandSuccess({
      txid: result.txid,
      explorerUrl: `${prepared.parsed.adapter.explorerBaseUrl}/tx/${result.txid}`,
      amount: formatNativeAmount(prepared.parsed.satoshis, prepared.parsed.currency),
      toAddress: input.toAddress,
    });
  } catch (error) {
    const message = normalizeErrorMessage(error);
    if (isInsufficientBalanceError(message)) {
      return commandFailed('insufficient_balance', `Balance is insufficient: ${message}`);
    }
    return commandFailed(
      'transfer_broadcast_failed',
      `Transfer failed: ${message}. Verify the recipient address is correct and that you have enough total balance to cover the amount plus fees. If UTXO inputs appear stale, wait a few seconds and retry.`,
    );
  }
}
