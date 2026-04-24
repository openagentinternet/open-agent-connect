"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Flag = void 0;
const integer_1 = require("./integer");
var Flag;
(function (Flag) {
    Flag[Flag["ETCHING"] = 0] = "ETCHING";
    Flag[Flag["TERMS"] = 1] = "TERMS";
    Flag[Flag["TURBO"] = 2] = "TURBO";
    Flag[Flag["CENOTAPH"] = 127] = "CENOTAPH";
})(Flag || (exports.Flag = Flag = {}));
(function (Flag) {
    function mask(flag) {
        return (0, integer_1.u128)(1n << BigInt(flag));
    }
    Flag.mask = mask;
    function take(flags, flag) {
        const mask = Flag.mask(flag);
        const set = (flags & mask) !== 0n;
        return { set, flags: set ? (0, integer_1.u128)(flags - mask) : flags };
    }
    Flag.take = take;
    function set(flags, flag) {
        return (0, integer_1.u128)(flags | Flag.mask(flag));
    }
    Flag.set = set;
})(Flag || (exports.Flag = Flag = {}));
//# sourceMappingURL=flag.js.map