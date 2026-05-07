import {
  DEFAULT_DERIVATION_PATH,
  deriveIdentity,
  normalizeGlobalMetaId,
  type DerivedIdentity
} from './deriveIdentity';

export type IdentitySource = Partial<DerivedIdentity> & {
  public_key?: string;
  chat_public_key?: string;
  mvc_address?: string;
  btc_address?: string;
  doge_address?: string;
  /** Legacy: same as addresses.btc */
  btcAddress?: string;
  /** Legacy: same as addresses.doge */
  dogeAddress?: string;
  metaid?: string;
  globalmetaid?: string;
};

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function readGlobalMetaId(value: unknown): string | undefined {
  const normalized = normalizeGlobalMetaId(value);
  return normalized ?? undefined;
}

function readDerivedFields(source: IdentitySource): Partial<DerivedIdentity> {
  const mvcAddress = readString(source.mvcAddress ?? source.mvc_address);
  const btcAddress = readString(source.btcAddress ?? source.btc_address);
  const dogeAddress = readString(source.dogeAddress ?? source.doge_address);

  // Build addresses map from explicit fields
  const addresses: Record<string, string> = {};
  if (mvcAddress) addresses.mvc = mvcAddress;
  if (btcAddress) addresses.btc = btcAddress;
  if (dogeAddress) addresses.doge = dogeAddress;

  return {
    publicKey: readString(source.publicKey ?? source.public_key),
    chatPublicKey: readString(source.chatPublicKey ?? source.chat_public_key),
    mvcAddress,
    addresses: Object.keys(addresses).length > 0 ? addresses : undefined,
    metaId: readString(source.metaId ?? source.metaid),
    globalMetaId: readGlobalMetaId(source.globalMetaId ?? source.globalmetaid)
  };
}

function hasCompleteDerivedFields(derived: Partial<DerivedIdentity>): derived is Required<
  Pick<DerivedIdentity, 'publicKey' | 'chatPublicKey' | 'mvcAddress' | 'metaId' | 'globalMetaId' | 'addresses'>
> {
  return Boolean(
    derived.publicKey &&
      derived.chatPublicKey &&
      derived.mvcAddress &&
      derived.addresses &&
      derived.metaId &&
      derived.globalMetaId
  );
}

function assertDerivedFieldsMatch(expected: DerivedIdentity, actual: Partial<DerivedIdentity>): void {
  for (const key of Object.keys(actual) as Array<keyof DerivedIdentity>) {
    const value = actual[key];
    if (value === undefined) continue;

    if (key === 'addresses') {
      // Compare addresses map entries
      const actualAddresses = value as Record<string, string>;
      for (const [chain, addr] of Object.entries(actualAddresses)) {
        if (addr !== expected.addresses[chain]) {
          throw new Error(`Identity field mismatch: addresses.${chain}`);
        }
      }
      continue;
    }

    if (expected[key] !== value) {
      throw new Error(`Identity field mismatch: ${key}`);
    }
  }
}

export async function loadIdentity(source: IdentitySource): Promise<DerivedIdentity> {
  const mnemonic = readString(source.mnemonic);
  const path = readString(source.path) ?? DEFAULT_DERIVATION_PATH;
  const derivedFields = readDerivedFields(source);

  if (mnemonic) {
    const derivedIdentity = await deriveIdentity({
      mnemonic,
      path
    });
    assertDerivedFieldsMatch(derivedIdentity, derivedFields);
    return derivedIdentity;
  }

  if (hasCompleteDerivedFields(derivedFields)) {
    return {
      mnemonic: '',
      path,
      publicKey: derivedFields.publicKey,
      chatPublicKey: derivedFields.chatPublicKey,
      addresses: derivedFields.addresses,
      mvcAddress: derivedFields.mvcAddress,
      metaId: derivedFields.metaId,
      globalMetaId: derivedFields.globalMetaId,
    };
  }

  throw new Error('Identity source is missing mnemonic');
}
