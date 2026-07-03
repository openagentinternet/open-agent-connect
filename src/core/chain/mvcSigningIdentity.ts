import { mvc } from 'meta-contract';
import { parseAddressIndexFromPath } from '../identity/deriveIdentity';

export function buildMvcSigningIdentity(input: { mnemonic: string; path: string }): {
  privateKey: unknown;
  address: string;
} {
  const network = mvc.Networks.livenet;
  const addressIndex = parseAddressIndexFromPath(input.path);
  const mnemonicObject = mvc.Mnemonic.fromString(input.mnemonic);
  const hdPrivateKey = mnemonicObject.toHDPrivateKey('', network as never);
  const childPrivateKey = hdPrivateKey.deriveChild(`m/44'/10001'/0'/0/${addressIndex}`);
  return {
    privateKey: childPrivateKey.privateKey,
    address: childPrivateKey.publicKey.toAddress(network as never).toString(),
  };
}
