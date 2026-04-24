"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestMvcGasSubsidy = requestMvcGasSubsidy;
const utxo_wallet_service_1 = require("@metalet/utxo-wallet-service");
const deriveIdentity_1 = require("../identity/deriveIdentity");
const DEFAULT_ADDRESS_INIT_URL = 'https://www.metaso.network/assist-open-api/v1/assist/gas/mvc/address-init';
const DEFAULT_ADDRESS_REWARD_URL = 'https://www.metaso.network/assist-open-api/v1/assist/gas/mvc/address-reward';
const DEFAULT_SUBSIDY_WAIT_MS = 5_000;
const CREDENTIAL_MESSAGE = 'metaso.network';
function getNet() {
    return 'livenet';
}
async function getCredential(mnemonic, path) {
    const addressIndex = (0, deriveIdentity_1.parseAddressIndexFromPath)(path);
    const wallet = new utxo_wallet_service_1.BtcWallet({
        coinType: utxo_wallet_service_1.CoinType.MVC,
        addressType: utxo_wallet_service_1.AddressType.SameAsMvc,
        addressIndex,
        network: getNet(),
        mnemonic,
    });
    const signature = wallet.signMessage(CREDENTIAL_MESSAGE, 'base64');
    const publicKey = wallet.getPublicKey().toString('hex');
    return { signature, publicKey };
}
async function requestMvcGasSubsidy(options, dependencies = {}) {
    const mvcAddress = typeof options.mvcAddress === 'string' ? options.mvcAddress.trim() : '';
    const mnemonic = typeof options.mnemonic === 'string' ? options.mnemonic.trim() : '';
    const derivationPath = typeof options.path === 'string' && options.path.trim()
        ? options.path.trim()
        : deriveIdentity_1.DEFAULT_DERIVATION_PATH;
    if (!mvcAddress) {
        return {
            success: false,
            error: 'mvcAddress is required',
        };
    }
    const fetchImpl = dependencies.fetchImpl ?? fetch;
    const wait = dependencies.wait ?? (async (ms) => {
        await new Promise((resolve) => setTimeout(resolve, ms));
    });
    const addressInitUrl = dependencies.addressInitUrl ?? DEFAULT_ADDRESS_INIT_URL;
    const addressRewardUrl = dependencies.addressRewardUrl ?? DEFAULT_ADDRESS_REWARD_URL;
    const waitMs = dependencies.waitMs ?? DEFAULT_SUBSIDY_WAIT_MS;
    const requestBody = JSON.stringify({
        address: mvcAddress,
        gasChain: 'mvc',
    });
    try {
        const step1Response = await fetchImpl(addressInitUrl, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: requestBody,
        });
        const step1 = await step1Response.json();
        if (!step1Response.ok) {
            return {
                success: false,
                step1,
                error: `address-init failed: ${step1Response.status} ${step1Response.statusText}`,
            };
        }
        if (!mnemonic) {
            return {
                success: true,
                step1,
            };
        }
        await wait(waitMs);
        const { signature, publicKey } = await getCredential(mnemonic, derivationPath);
        const step2Response = await fetchImpl(addressRewardUrl, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'X-Signature': signature,
                'X-Public-Key': publicKey,
            },
            body: requestBody,
        });
        const step2 = await step2Response.json();
        if (!step2Response.ok) {
            return {
                success: false,
                step1,
                step2,
                error: `address-reward failed: ${step2Response.status} ${step2Response.statusText}`,
            };
        }
        return {
            success: true,
            step1,
            step2,
        };
    }
    catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
