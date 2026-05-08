"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_DERIVATION_PATH = void 0;
exports.parseAddressIndexFromPath = parseAddressIndexFromPath;
exports.normalizeGlobalMetaId = normalizeGlobalMetaId;
exports.validateGlobalMetaId = validateGlobalMetaId;
exports.derivePrivateKeyHex = derivePrivateKeyHex;
exports.convertToGlobalMetaId = convertToGlobalMetaId;
exports.deriveIdentity = deriveIdentity;
const node_crypto_1 = require("node:crypto");
const bip39 = __importStar(require("@scure/bip39"));
const english_1 = require("@scure/bip39/wordlists/english");
const utxo_wallet_service_1 = require("@metalet/utxo-wallet-service");
const meta_contract_1 = require("meta-contract");
exports.DEFAULT_DERIVATION_PATH = "m/44'/10001'/0'/0/0";
const MAN_PUB_KEY = '048add0a6298f10a97785f7dd069eedb83d279a6f03e73deec0549e7d6fcaac4eef2c279cf7608be907a73c89eb44c28db084c27b588f1bd869321a6f104ec642d';
const RAW_GLOBAL_META_ID_VERSION_CHARS = new Set(['q', 'p', 'z', 'r', 'y', 't']);
var AddressVersion;
(function (AddressVersion) {
    AddressVersion[AddressVersion["P2PKH"] = 0] = "P2PKH";
    AddressVersion[AddressVersion["P2SH"] = 1] = "P2SH";
    AddressVersion[AddressVersion["P2WPKH"] = 2] = "P2WPKH";
    AddressVersion[AddressVersion["P2WSH"] = 3] = "P2WSH";
    AddressVersion[AddressVersion["P2MS"] = 4] = "P2MS";
    AddressVersion[AddressVersion["P2TR"] = 5] = "P2TR";
})(AddressVersion || (AddressVersion = {}));
var Bech32Encoding;
(function (Bech32Encoding) {
    Bech32Encoding[Bech32Encoding["Bech32"] = 1] = "Bech32";
    Bech32Encoding[Bech32Encoding["Bech32m"] = 2] = "Bech32m";
})(Bech32Encoding || (Bech32Encoding = {}));
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const IDADDRESS_CHARSET = BECH32_CHARSET;
const VERSION_CHARS = ['q', 'p', 'z', 'r', 'y', 't'];
const BECH32_CHARSET_MAP = {};
for (let index = 0; index < BECH32_CHARSET.length; index += 1) {
    BECH32_CHARSET_MAP[BECH32_CHARSET[index]] = index;
}
function parseAddressIndexFromPath(path) {
    if (!path || typeof path !== 'string')
        return 0;
    const match = path.match(/\/0\/(\d+)$/);
    return match ? Number.parseInt(match[1], 10) : 0;
}
function normalizeGlobalMetaId(value) {
    if (typeof value !== 'string')
        return null;
    const normalized = value.trim().toLowerCase();
    if (!normalized)
        return null;
    if (normalized.startsWith('metaid:'))
        return null;
    if (!normalized.startsWith('id'))
        return null;
    if (!RAW_GLOBAL_META_ID_VERSION_CHARS.has(normalized[2] ?? ''))
        return null;
    if (normalized[3] !== '1')
        return null;
    return normalized;
}
function validateGlobalMetaId(value) {
    return normalizeGlobalMetaId(value) !== null;
}
function getNet() {
    return 'livenet';
}
async function getV3AddressType(chain) {
    if (chain === 'mvc')
        return utxo_wallet_service_1.AddressType.LegacyMvc;
    if (chain === 'doge')
        return utxo_wallet_service_1.AddressType.DogeSameAsMvc;
    return utxo_wallet_service_1.AddressType.SameAsMvc;
}
async function getMvcWallet(mnemonic, addressIndex) {
    return new utxo_wallet_service_1.MvcWallet({
        coinType: utxo_wallet_service_1.CoinType.MVC,
        addressType: await getV3AddressType('mvc'),
        addressIndex,
        network: getNet(),
        mnemonic
    });
}
async function getBtcWallet(mnemonic, addressIndex) {
    const addressType = await getV3AddressType('btc');
    return new utxo_wallet_service_1.BtcWallet({
        coinType: addressType === utxo_wallet_service_1.AddressType.SameAsMvc ? utxo_wallet_service_1.CoinType.MVC : utxo_wallet_service_1.CoinType.BTC,
        addressType,
        addressIndex,
        network: getNet(),
        mnemonic
    });
}
async function getDogeWallet(mnemonic, addressIndex) {
    return new utxo_wallet_service_1.DogeWallet({
        mnemonic,
        network: getNet(),
        addressIndex,
        addressType: await getV3AddressType('doge'),
        coinType: utxo_wallet_service_1.CoinType.MVC
    });
}
function getPrivateKeyBufferFromWallet(wallet) {
    const privateKeyWIF = wallet.getPrivateKey();
    const privateKey = meta_contract_1.mvc.PrivateKey.fromWIF(privateKeyWIF);
    return Buffer.from(privateKey.bn.toArray('be', 32));
}
async function derivePrivateKeyHex(options = {}) {
    const mnemonic = options.mnemonic?.trim() || bip39.generateMnemonic(english_1.wordlist);
    const path = options.path?.trim() || exports.DEFAULT_DERIVATION_PATH;
    const addressIndex = parseAddressIndexFromPath(path);
    const mvcWallet = await getMvcWallet(mnemonic, addressIndex);
    return getPrivateKeyBufferFromWallet(mvcWallet).toString('hex');
}
async function deriveChatPublicKey(mnemonic, addressIndex) {
    const wallet = await getMvcWallet(mnemonic, addressIndex);
    const ecdh = (0, node_crypto_1.createECDH)('prime256v1');
    ecdh.setPrivateKey(getPrivateKeyBufferFromWallet(wallet));
    void ecdh.computeSecret(Buffer.from(MAN_PUB_KEY, 'hex'));
    return ecdh.getPublicKey('hex', 'uncompressed');
}
function computeMetaId(mvcAddress) {
    return (0, node_crypto_1.createHash)('sha256').update(mvcAddress, 'utf8').digest('hex');
}
function sha256(data) {
    return new Uint8Array((0, node_crypto_1.createHash)('sha256').update(data).digest());
}
function doubleSha256(data) {
    return sha256(sha256(data));
}
function base58Decode(value) {
    if (value.length === 0)
        return new Uint8Array(0);
    let num = BigInt(0);
    for (const char of value) {
        const index = BASE58_ALPHABET.indexOf(char);
        if (index === -1) {
            throw new Error(`Invalid Base58 character: ${char}`);
        }
        num = num * BigInt(58) + BigInt(index);
    }
    const bytes = [];
    while (num > 0) {
        bytes.unshift(Number(num % BigInt(256)));
        num /= BigInt(256);
    }
    for (const char of value) {
        if (char !== '1')
            break;
        bytes.unshift(0);
    }
    return new Uint8Array(bytes);
}
function base58CheckDecode(value) {
    const decoded = base58Decode(value);
    if (decoded.length < 5) {
        throw new Error('Decoded data too short');
    }
    const data = decoded.slice(0, -4);
    const checksum = decoded.slice(-4);
    const expectedChecksum = doubleSha256(data);
    for (let index = 0; index < 4; index += 1) {
        if (checksum[index] !== expectedChecksum[index]) {
            throw new Error('Checksum mismatch');
        }
    }
    return {
        version: data[0],
        payload: data.slice(1)
    };
}
function bech32Polymod(values) {
    const gen = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    let chk = 1;
    for (const value of values) {
        const top = chk >> 25;
        chk = ((chk & 0x1ffffff) << 5) ^ value;
        for (let index = 0; index < 5; index += 1) {
            if ((top >> index) & 1) {
                chk ^= gen[index];
            }
        }
    }
    return chk;
}
function bech32HrpExpand(hrp) {
    const result = [];
    for (let index = 0; index < hrp.length; index += 1) {
        result.push(hrp.charCodeAt(index) >> 5);
    }
    result.push(0);
    for (let index = 0; index < hrp.length; index += 1) {
        result.push(hrp.charCodeAt(index) & 31);
    }
    return result;
}
function bech32VerifyChecksum(hrp, data, encoding) {
    const polymod = bech32Polymod([...bech32HrpExpand(hrp), ...data]);
    return encoding === Bech32Encoding.Bech32 ? polymod === 1 : polymod === 0x2bc830a3;
}
function convertBits(data, fromBits, toBits, pad) {
    let acc = 0;
    let bits = 0;
    const result = [];
    const maxv = (1 << toBits) - 1;
    for (const value of data) {
        acc = (acc << fromBits) | value;
        bits += fromBits;
        while (bits >= toBits) {
            bits -= toBits;
            result.push((acc >> bits) & maxv);
        }
    }
    if (pad) {
        if (bits > 0) {
            result.push((acc << (toBits - bits)) & maxv);
        }
    }
    else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv) !== 0) {
        throw new Error('Invalid padding');
    }
    return new Uint8Array(result);
}
function bech32Decode(address) {
    const normalized = address.toLowerCase();
    const separator = normalized.lastIndexOf('1');
    if (separator < 1 || separator + 7 > normalized.length || normalized.length > 90) {
        throw new Error('Invalid bech32 address format');
    }
    const hrp = normalized.slice(0, separator);
    const data = normalized.slice(separator + 1);
    const decoded = [];
    for (const char of data) {
        const value = BECH32_CHARSET_MAP[char];
        if (value === undefined) {
            throw new Error(`Invalid bech32 character: ${char}`);
        }
        decoded.push(value);
    }
    let encoding = Bech32Encoding.Bech32m;
    if (!bech32VerifyChecksum(hrp, decoded, Bech32Encoding.Bech32m)) {
        encoding = Bech32Encoding.Bech32;
        if (!bech32VerifyChecksum(hrp, decoded, Bech32Encoding.Bech32)) {
            throw new Error('Invalid bech32 checksum');
        }
    }
    const dataWithoutChecksum = decoded.slice(0, -6);
    if (dataWithoutChecksum.length < 1) {
        throw new Error('Invalid bech32 data length');
    }
    const version = dataWithoutChecksum[0];
    const program = convertBits(new Uint8Array(dataWithoutChecksum.slice(1)), 5, 8, false);
    if (program.length < 2 || program.length > 40) {
        throw new Error('Invalid witness program length');
    }
    if (version === 0 && encoding !== Bech32Encoding.Bech32) {
        throw new Error('Witness version 0 must use bech32');
    }
    if (version !== 0 && encoding !== Bech32Encoding.Bech32m) {
        throw new Error('Witness version 1+ must use bech32m');
    }
    return { hrp, version, program, encoding };
}
function idPolymod(values) {
    const gen = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    let chk = 1;
    for (const value of values) {
        const top = chk >> 25;
        chk = ((chk & 0x1ffffff) << 5) ^ value;
        for (let index = 0; index < 5; index += 1) {
            if ((top >> index) & 1) {
                chk ^= gen[index];
            }
        }
    }
    return chk;
}
function idHrpExpand(hrp) {
    const result = [];
    for (let index = 0; index < hrp.length; index += 1) {
        result.push(hrp.charCodeAt(index) >> 5);
    }
    result.push(0);
    for (let index = 0; index < hrp.length; index += 1) {
        result.push(hrp.charCodeAt(index) & 31);
    }
    return result;
}
function createIdChecksum(data, version) {
    const hrp = `id${VERSION_CHARS[version]}`;
    const values = [...idHrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
    const mod = idPolymod(values) ^ 1;
    const checksum = [];
    for (let index = 0; index < 6; index += 1) {
        checksum.push((mod >> (5 * (5 - index))) & 31);
    }
    return checksum;
}
function convertBits8To5(data) {
    let acc = 0;
    let bits = 0;
    const result = [];
    for (const value of data) {
        acc = (acc << 8) | value;
        bits += 8;
        while (bits >= 5) {
            bits -= 5;
            result.push((acc >> bits) & 31);
        }
    }
    if (bits > 0) {
        result.push((acc << (5 - bits)) & 31);
    }
    return result;
}
function encodeIdAddress(version, data) {
    if (version < 0 || version > 5) {
        throw new Error(`Invalid version: ${version}`);
    }
    const payload = [...convertBits8To5(data), ...createIdChecksum(convertBits8To5(data), version)];
    let result = `id${VERSION_CHARS[version]}1`;
    for (const chunk of payload) {
        result += IDADDRESS_CHARSET[chunk];
    }
    return result;
}
function convertFromLegacyAddress(version, payload) {
    let idVersion;
    switch (version) {
        case 0x00:
        case 0x6f:
        case 0x1e:
            idVersion = AddressVersion.P2PKH;
            break;
        case 0x05:
        case 0xc4:
        case 0x16:
            idVersion = AddressVersion.P2SH;
            break;
        default:
            throw new Error(`Unsupported version byte: 0x${version.toString(16)}`);
    }
    return encodeIdAddress(idVersion, payload);
}
function convertFromSegWitAddress(hrp, witnessVersion, program) {
    if (hrp !== 'bc' && hrp !== 'tb') {
        throw new Error(`Unsupported network: ${hrp}`);
    }
    switch (witnessVersion) {
        case 0:
            if (program.length === 20) {
                return encodeIdAddress(AddressVersion.P2WPKH, program);
            }
            if (program.length === 32) {
                return encodeIdAddress(AddressVersion.P2WSH, program);
            }
            throw new Error(`Invalid witness v0 program length: ${program.length}`);
        case 1:
            if (program.length === 32) {
                return encodeIdAddress(AddressVersion.P2TR, program);
            }
            throw new Error(`Invalid taproot program length: ${program.length}`);
        default:
            throw new Error(`Unsupported witness version: ${witnessVersion}`);
    }
}
function convertToGlobalMetaId(address) {
    try {
        const { version, payload } = base58CheckDecode(address);
        return convertFromLegacyAddress(version, payload);
    }
    catch {
        // Fall through to Bech32 decoding.
    }
    try {
        const { hrp, version, program } = bech32Decode(address);
        return convertFromSegWitAddress(hrp, version, program);
    }
    catch {
        throw new Error(`Unsupported address format: ${address}`);
    }
}
async function deriveIdentity(options = {}) {
    const mnemonic = options.mnemonic?.trim() || bip39.generateMnemonic(english_1.wordlist);
    const path = options.path ?? exports.DEFAULT_DERIVATION_PATH;
    const addressIndex = parseAddressIndexFromPath(path);
    const [mvcWallet, btcWallet, dogeWallet, chatPublicKey] = await Promise.all([
        getMvcWallet(mnemonic, addressIndex),
        getBtcWallet(mnemonic, addressIndex),
        getDogeWallet(mnemonic, addressIndex),
        deriveChatPublicKey(mnemonic, addressIndex)
    ]);
    const mvcAddress = mvcWallet.getAddress();
    const globalMetaId = normalizeGlobalMetaId(convertToGlobalMetaId(mvcAddress));
    if (!globalMetaId) {
        throw new Error(`Failed to normalize derived GlobalMetaId for address: ${mvcAddress}`);
    }
    const btcAddress = btcWallet.getAddress();
    const dogeAddress = dogeWallet.getAddress();
    return {
        mnemonic,
        path,
        publicKey: mvcWallet.getPublicKey().toString('hex'),
        chatPublicKey,
        addresses: {
            mvc: mvcAddress,
            btc: btcAddress,
            doge: dogeAddress,
        },
        mvcAddress,
        metaId: computeMetaId(mvcAddress),
        globalMetaId
    };
}
