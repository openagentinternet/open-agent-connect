"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMvcSigningIdentity = buildMvcSigningIdentity;
const meta_contract_1 = require("meta-contract");
const deriveIdentity_1 = require("../identity/deriveIdentity");
function buildMvcSigningIdentity(input) {
    const network = meta_contract_1.mvc.Networks.livenet;
    const addressIndex = (0, deriveIdentity_1.parseAddressIndexFromPath)(input.path);
    const mnemonicObject = meta_contract_1.mvc.Mnemonic.fromString(input.mnemonic);
    const hdPrivateKey = mnemonicObject.toHDPrivateKey('', network);
    const childPrivateKey = hdPrivateKey.deriveChild(`m/44'/10001'/0'/0/${addressIndex}`);
    return {
        privateKey: childPrivateKey.privateKey,
        address: childPrivateKey.publicKey.toAddress(network).toString(),
    };
}
