"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.signMvcAddressMessage = signMvcAddressMessage;
require("../compat/nodeLocalStorage");
const utxo_wallet_service_1 = require("@metalet/utxo-wallet-service");
const deriveIdentity_1 = require("../identity/deriveIdentity");
function getNet() {
    return 'livenet';
}
async function signMvcAddressMessage(input) {
    const addressIndex = (0, deriveIdentity_1.parseAddressIndexFromPath)(input.path);
    const wallet = new utxo_wallet_service_1.BtcWallet({
        coinType: utxo_wallet_service_1.CoinType.MVC,
        addressType: utxo_wallet_service_1.AddressType.SameAsMvc,
        addressIndex,
        network: getNet(),
        mnemonic: input.mnemonic,
    });
    return {
        signature: wallet.signMessage(input.message, 'base64'),
        publicKey: wallet.getPublicKey().toString('hex'),
    };
}
