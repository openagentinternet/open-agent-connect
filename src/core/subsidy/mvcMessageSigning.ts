import '../compat/nodeLocalStorage';
import {
  AddressType,
  BtcWallet,
  CoinType,
  type Net,
} from '@metalet/utxo-wallet-service';
import { parseAddressIndexFromPath } from '../identity/deriveIdentity';

function getNet(): Net {
  return 'livenet' as Net;
}

export async function signMvcAddressMessage(input: {
  mnemonic: string;
  path: string;
  message: string;
}): Promise<{ signature: string; publicKey: string }> {
  const addressIndex = parseAddressIndexFromPath(input.path);
  const wallet = new BtcWallet({
    coinType: CoinType.MVC,
    addressType: AddressType.SameAsMvc,
    addressIndex,
    network: getNet(),
    mnemonic: input.mnemonic,
  });
  return {
    signature: wallet.signMessage(input.message, 'base64'),
    publicKey: wallet.getPublicKey().toString('hex'),
  };
}
