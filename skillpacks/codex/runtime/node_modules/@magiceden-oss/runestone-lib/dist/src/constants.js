"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TAPROOT_SCRIPT_PUBKEY_TYPE = exports.COMMIT_CONFIRMATIONS = exports.TAPROOT_ANNEX_PREFIX = exports.MAGIC_NUMBER = exports.OP_RETURN = exports.MAX_SCRIPT_ELEMENT_SIZE = exports.SUBSIDY_HALVING_INTERVAL = exports.RESERVED = exports.MAX_DIVISIBILITY = void 0;
const integer_1 = require("./integer");
const script_1 = require("./script");
exports.MAX_DIVISIBILITY = (0, integer_1.u8)(38);
exports.RESERVED = (0, integer_1.u128)(6402364363415443603228541259936211926n);
exports.SUBSIDY_HALVING_INTERVAL = 210000;
exports.MAX_SCRIPT_ELEMENT_SIZE = 520;
exports.OP_RETURN = script_1.opcodes.OP_RETURN;
exports.MAGIC_NUMBER = script_1.opcodes.OP_13;
exports.TAPROOT_ANNEX_PREFIX = 0x50;
exports.COMMIT_CONFIRMATIONS = 6;
exports.TAPROOT_SCRIPT_PUBKEY_TYPE = 'witness_v1_taproot';
//# sourceMappingURL=constants.js.map