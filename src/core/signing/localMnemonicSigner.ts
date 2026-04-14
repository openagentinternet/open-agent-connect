import { TxComposer, mvc } from 'meta-contract';
import {
  AddressType,
  BtcWallet,
  CoinType,
  SignType,
} from '@metalet/utxo-wallet-service';
import {
  derivePrivateKeyHex,
  parseAddressIndexFromPath,
  type DerivedIdentity,
} from '../identity/deriveIdentity';
import { loadIdentity } from '../identity/loadIdentity';
import {
  normalizeChainWriteRequest,
  type ChainWriteRequest,
  type ChainWriteResult,
  type NormalizedChainWriteRequest,
} from '../chain/writePin';
import type { SecretStore } from '../secrets/secretStore';
import type { PrivateChatSignerIdentity, Signer } from './signer';

const METALET_HOST = 'https://www.metalet.space';
const NET = 'livenet';
const P2PKH_INPUT_SIZE = 148;
const DEFAULT_BTC_WRITE_FEE_RATE = 2;

interface MvcTransportUtxo {
  txid: string;
  outIndex: number;
  value: number;
  height: number;
}

interface SelectedMvcUtxo {
  txId: string;
  outputIndex: number;
  satoshis: number;
  address: string;
  height: number;
}

export interface LocalMnemonicSignerMvcTransport {
  fetchUtxos(address: string): Promise<MvcTransportUtxo[]>;
  broadcastTx(rawTx: string): Promise<string>;
}

export interface BtcTransportUtxo {
  txId: string;
  outputIndex: number;
  satoshis: number;
  address: string;
  rawTx?: string;
  confirmed?: boolean;
}

export interface LocalMnemonicSignerBtcTransport {
  fetchUtxos(address: string, needRawTx: boolean): Promise<BtcTransportUtxo[]>;
  broadcastTx(rawTx: string): Promise<string>;
}

export interface LocalMnemonicSignerBtcCreatePinInput {
  request: NormalizedChainWriteRequest;
  identity: DerivedIdentity;
}

export interface LocalMnemonicSignerBtcCreatePinResult {
  txids: string[];
  pinId: string;
  totalCost: number;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function fetchMvcUtxos(address: string): Promise<MvcTransportUtxo[]> {
  const all: MvcTransportUtxo[] = [];
  let flag: string | undefined;

  while (true) {
    const params = new URLSearchParams({ address, net: NET, ...(flag ? { flag } : {}) });
    const response = await fetch(`${METALET_HOST}/wallet-api/v4/mvc/address/utxo-list?${params}`);
    const json = await response.json() as {
      data?: { list?: Array<MvcTransportUtxo & { flag?: string }> };
    };
    const list = json?.data?.list ?? [];
    if (!list.length) {
      break;
    }

    all.push(...list.filter((utxo) => utxo.value >= 600));
    flag = list[list.length - 1]?.flag;
    if (!flag) {
      break;
    }
  }

  return all;
}

async function broadcastMvcTx(rawTx: string): Promise<string> {
  const response = await fetch(`${METALET_HOST}/wallet-api/v3/tx/broadcast`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      chain: 'mvc',
      net: NET,
      rawTx,
    }),
  });

  const json = await response.json() as { code?: number; message?: string; data?: string };
  if (json?.code !== 0) {
    throw new Error(json?.message || 'Broadcast failed');
  }
  return json.data ?? '';
}

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
  }>;
  address: string;
}): BtcTransportUtxo[] {
  const normalized = input.list.map((utxo) => ({
    txId: normalizeText(utxo.txId ?? utxo.txid),
    outputIndex: Number.isInteger(utxo.outputIndex) ? Number(utxo.outputIndex) : Number(utxo.vout),
    satoshis: Number(utxo.satoshis ?? utxo.value ?? 0),
    address: normalizeText(utxo.address) || input.address,
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
  return confirmed.length > 0 ? confirmed : normalized;
}

async function fetchBtcRawTxHex(txId: string): Promise<string> {
  const params = new URLSearchParams({
    txId,
    chain: 'btc',
    net: NET,
  });
  const response = await fetch(`${METALET_HOST}/wallet-api/v3/tx/raw?${params}`);
  const json = await response.json() as {
    code?: number;
    message?: string;
    data?: { rawTx?: string; hex?: string };
  };
  if (json?.code !== 0) {
    throw new Error(json?.message || 'Metalet BTC raw tx query failed.');
  }
  const rawTx = normalizeText(json?.data?.rawTx ?? json?.data?.hex);
  if (!rawTx) {
    throw new Error(`Metalet BTC raw tx response is empty for ${txId}.`);
  }
  return rawTx;
}

async function fetchBtcUtxos(address: string, needRawTx: boolean): Promise<BtcTransportUtxo[]> {
  const params = new URLSearchParams({
    address,
    unconfirmed: '1',
    net: NET,
  });
  const response = await fetch(`${METALET_HOST}/wallet-api/v3/address/btc-utxo?${params}`);
  const json = await response.json() as {
    code?: number;
    message?: string;
    data?: Array<{
      txId?: string;
      txid?: string;
      outputIndex?: number;
      vout?: number;
      satoshis?: number;
      value?: number;
      address?: string;
      confirmed?: boolean;
      status?: { confirmed?: boolean };
    }>;
  };
  if (json?.code !== 0) {
    throw new Error(json?.message || 'Metalet BTC UTXO query failed.');
  }

  const utxos = normalizeBtcUtxos({
    list: json?.data ?? [],
    address,
  });
  if (!needRawTx) {
    return utxos;
  }

  const withRawTx: BtcTransportUtxo[] = [];
  for (const utxo of utxos) {
    withRawTx.push({
      ...utxo,
      rawTx: await fetchBtcRawTxHex(utxo.txId),
    });
  }
  return withRawTx;
}

async function broadcastBtcTx(rawTx: string): Promise<string> {
  const response = await fetch(`${METALET_HOST}/wallet-api/v3/tx/broadcast`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      chain: 'btc',
      net: NET,
      rawTx,
    }),
  });

  const json = await response.json() as { code?: number; message?: string; data?: string };
  if (json?.code !== 0) {
    throw new Error(json?.message || 'BTC broadcast failed');
  }
  const txid = normalizeText(json.data);
  if (!txid) {
    throw new Error('BTC broadcast returned an empty txid.');
  }
  return txid;
}

function buildMvcOpReturnParts(input: ReturnType<typeof normalizeChainWriteRequest>): Array<string | Buffer> {
  const parts: Array<string | Buffer> = ['metaid', input.operation];
  if (input.operation !== 'init') {
    parts.push(input.path.toLowerCase());
    parts.push(input.encryption);
    parts.push(input.version);
    parts.push(input.contentType);
    parts.push(Buffer.from(input.payload, input.encoding));
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

function getEstimatedTxSizeWithoutInputs(opReturnScriptSize: number): number {
  return 4 + 1 + 1 + 43 + (9 + opReturnScriptSize) + 4;
}

function pickMvcUtxos(
  utxos: SelectedMvcUtxo[],
  totalOutput: number,
  feeRate: number,
  estimatedTxSizeWithoutInputs: number
): SelectedMvcUtxo[] {
  const confirmed = utxos.filter((utxo) => utxo.height > 0).sort(() => Math.random() - 0.5);
  const unconfirmed = utxos.filter((utxo) => utxo.height <= 0).sort(() => Math.random() - 0.5);
  const ordered = [...confirmed, ...unconfirmed];

  let current = 0;
  const picked: SelectedMvcUtxo[] = [];

  for (const utxo of ordered) {
    current += utxo.satoshis;
    picked.push(utxo);
    const estimatedTxSize = estimatedTxSizeWithoutInputs + (picked.length * P2PKH_INPUT_SIZE);
    const requiredAmount = totalOutput + Math.ceil(estimatedTxSize * feeRate);
    if (current >= requiredAmount) {
      return picked;
    }
  }

  throw new Error('MetaBot balance is insufficient for this chain write.');
}

async function loadSignerIdentity(secretStore: SecretStore): Promise<DerivedIdentity> {
  const secrets = await secretStore.readIdentitySecrets();
  if (!secrets?.mnemonic) {
    throw new Error('Local identity mnemonic is missing from the secret store.');
  }

  return loadIdentity(secrets);
}

async function buildPrivateChatIdentity(secretStore: SecretStore): Promise<PrivateChatSignerIdentity> {
  const secrets = await secretStore.readIdentitySecrets();
  if (!secrets?.mnemonic) {
    throw new Error('Local identity mnemonic is missing from the secret store.');
  }

  const identity = await loadIdentity(secrets);
  const privateKeyHex = normalizeText(secrets.privateKeyHex) || await derivePrivateKeyHex({
    mnemonic: identity.mnemonic,
    path: identity.path,
  });
  if (!privateKeyHex) {
    throw new Error('Local private key could not be derived from the secret store.');
  }

  return {
    globalMetaId: identity.globalMetaId,
    chatPublicKey: identity.chatPublicKey,
    privateKeyHex,
  };
}

function buildMvcPrivateKey(mnemonic: string, path: string): {
  privateKey: unknown;
  address: string;
} {
  const network = mvc.Networks.livenet;
  const addressIndex = parseAddressIndexFromPath(path);
  const mnemonicObject = mvc.Mnemonic.fromString(mnemonic);
  const hdPrivateKey = mnemonicObject.toHDPrivateKey('', network as never);
  const childPrivateKey = hdPrivateKey.deriveChild(`m/44'/10001'/0'/0/${addressIndex}`);
  const address = childPrivateKey.publicKey.toAddress(network as never).toString();
  return {
    privateKey: childPrivateKey.privateKey,
    address,
  };
}

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

async function runDefaultBtcCreatePin(input: {
  request: NormalizedChainWriteRequest;
  identity: DerivedIdentity;
  btcTransport: LocalMnemonicSignerBtcTransport;
  feeRate: number;
}): Promise<LocalMnemonicSignerBtcCreatePinResult> {
  const wallet = buildBtcWallet(input.identity.mnemonic, input.identity.path);
  const address = wallet.getAddress();
  const scriptType = (wallet as { getScriptType?: () => string }).getScriptType?.() ?? 'P2PKH';
  const needRawTx = scriptType === 'P2PKH';
  const utxos = await input.btcTransport.fetchUtxos(address, needRawTx);
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
      confirmed: utxo.confirmed,
    })),
    feeRate: input.feeRate,
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
  if (!commitTx?.rawTx) {
    throw new Error('BTC signTx returned no commit transaction.');
  }
  await input.btcTransport.broadcastTx(commitTx.rawTx);

  const txids: string[] = [];
  const revealTxs = Array.isArray(signResult.revealTxs) ? signResult.revealTxs : [];
  let totalCost = Number(commitTx.fee ?? 0);
  for (const revealTx of revealTxs) {
    const rawTx = normalizeText(revealTx?.rawTx);
    if (!rawTx) {
      throw new Error('BTC signTx returned an empty reveal transaction.');
    }
    txids.push(await input.btcTransport.broadcastTx(rawTx));
    totalCost += Number(revealTx?.fee ?? 0);
  }

  if (!txids.length) {
    throw new Error('BTC inscription produced no reveal transaction.');
  }

  return {
    txids,
    pinId: `${txids[0]}i0`,
    totalCost: Number.isFinite(totalCost) ? totalCost : 0,
  };
}

export function createLocalMnemonicSigner(input: {
  secretStore: SecretStore;
  mvcTransport?: LocalMnemonicSignerMvcTransport;
  btcTransport?: LocalMnemonicSignerBtcTransport;
  btcCreatePin?: (
    input: LocalMnemonicSignerBtcCreatePinInput
  ) => Promise<LocalMnemonicSignerBtcCreatePinResult>;
  btcFeeRate?: number;
}): Signer {
  const mvcTransport = input.mvcTransport ?? {
    fetchUtxos: fetchMvcUtxos,
    broadcastTx: broadcastMvcTx,
  };
  const btcTransport = input.btcTransport ?? {
    fetchUtxos: fetchBtcUtxos,
    broadcastTx: broadcastBtcTx,
  };
  const btcFeeRate = Number.isFinite(input.btcFeeRate) && Number(input.btcFeeRate) > 0
    ? Math.floor(Number(input.btcFeeRate))
    : DEFAULT_BTC_WRITE_FEE_RATE;

  return {
    getIdentity: async () => loadSignerIdentity(input.secretStore),
    getPrivateChatIdentity: async () => buildPrivateChatIdentity(input.secretStore),
    writePin: async (rawInput: ChainWriteRequest): Promise<ChainWriteResult> => {
      const request = normalizeChainWriteRequest(rawInput);
      const identity = await loadSignerIdentity(input.secretStore);

      if (request.network === 'btc') {
        const btcWrite = input.btcCreatePin ?? (async (btcInput: LocalMnemonicSignerBtcCreatePinInput) => (
          runDefaultBtcCreatePin({
            request: btcInput.request,
            identity: btcInput.identity,
            btcTransport,
            feeRate: btcFeeRate,
          })
        ));
        const result = await btcWrite({
          request,
          identity,
        });
        return {
          txids: result.txids,
          pinId: result.pinId,
          totalCost: result.totalCost,
          network: request.network,
          operation: request.operation,
          path: request.path,
          contentType: request.contentType,
          encoding: request.encoding,
          globalMetaId: identity.globalMetaId,
          mvcAddress: identity.mvcAddress,
        };
      }

      if (request.network !== 'mvc') {
        throw new Error(`Chain write network ${request.network} is not supported yet.`);
      }

      const { privateKey, address } = buildMvcPrivateKey(identity.mnemonic, identity.path);

      const utxos = await mvcTransport.fetchUtxos(address);
      const usableUtxos: SelectedMvcUtxo[] = utxos.map((utxo) => ({
        txId: utxo.txid,
        outputIndex: utxo.outIndex,
        satoshis: utxo.value,
        address,
        height: utxo.height,
      }));

      const addressObject = new mvc.Address(address, mvc.Networks.livenet as never);
      const opReturnParts = buildMvcOpReturnParts(request);
      const opReturnScriptSize = getOpReturnScriptSize(opReturnParts);
      const estimatedTxSizeWithoutInputs = getEstimatedTxSizeWithoutInputs(opReturnScriptSize);

      const txComposer = new TxComposer();
      txComposer.appendP2PKHOutput({
        address: addressObject,
        satoshis: 1,
      });
      txComposer.appendOpReturnOutput(opReturnParts);

      const totalOutput = txComposer.tx.outputs.reduce((sum, output) => sum + output.satoshis, 0);
      const pickedUtxos = pickMvcUtxos(usableUtxos, totalOutput, 1, estimatedTxSizeWithoutInputs);

      for (const utxo of pickedUtxos) {
        txComposer.appendP2PKHInput({
          address: addressObject,
          txId: utxo.txId,
          outputIndex: utxo.outputIndex,
          satoshis: utxo.satoshis,
        });
      }
      txComposer.appendChangeOutput(addressObject, 1);

      for (let inputIndex = 0; inputIndex < txComposer.tx.inputs.length; inputIndex += 1) {
        txComposer.unlockP2PKHInput(privateKey as never, inputIndex);
      }

      const rawTx = txComposer.getRawHex();
      const txid = await mvcTransport.broadcastTx(rawTx);
      const inputTotal = txComposer.tx.inputs.reduce((sum, current) => sum + (current.output?.satoshis || 0), 0);
      const outputTotal = txComposer.tx.outputs.reduce((sum, output) => sum + output.satoshis, 0);

      return {
        txids: [txid],
        pinId: `${txid}i0`,
        totalCost: inputTotal - outputTotal,
        network: request.network,
        operation: request.operation,
        path: request.path,
        contentType: request.contentType,
        encoding: request.encoding,
        globalMetaId: identity.globalMetaId,
        mvcAddress: identity.mvcAddress,
      };
    },
  };
}
