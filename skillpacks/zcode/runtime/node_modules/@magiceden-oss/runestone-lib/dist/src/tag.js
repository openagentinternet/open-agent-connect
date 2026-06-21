"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Tag = void 0;
const monads_1 = require("./monads");
const integer_1 = require("./integer");
var Tag;
(function (Tag) {
    Tag[Tag["BODY"] = 0] = "BODY";
    Tag[Tag["FLAGS"] = 2] = "FLAGS";
    Tag[Tag["RUNE"] = 4] = "RUNE";
    Tag[Tag["PREMINE"] = 6] = "PREMINE";
    Tag[Tag["CAP"] = 8] = "CAP";
    Tag[Tag["AMOUNT"] = 10] = "AMOUNT";
    Tag[Tag["HEIGHT_START"] = 12] = "HEIGHT_START";
    Tag[Tag["HEIGHT_END"] = 14] = "HEIGHT_END";
    Tag[Tag["OFFSET_START"] = 16] = "OFFSET_START";
    Tag[Tag["OFFSET_END"] = 18] = "OFFSET_END";
    Tag[Tag["MINT"] = 20] = "MINT";
    Tag[Tag["POINTER"] = 22] = "POINTER";
    Tag[Tag["CENOTAPH"] = 126] = "CENOTAPH";
    Tag[Tag["DIVISIBILITY"] = 1] = "DIVISIBILITY";
    Tag[Tag["SPACERS"] = 3] = "SPACERS";
    Tag[Tag["SYMBOL"] = 5] = "SYMBOL";
    Tag[Tag["NOP"] = 127] = "NOP";
})(Tag || (exports.Tag = Tag = {}));
(function (Tag) {
    function take(tag, fields, n, withFn) {
        const field = fields.get((0, integer_1.u128)(tag));
        if (field === undefined) {
            return monads_1.None;
        }
        const values = [];
        for (const i of [...Array(n).keys()]) {
            if (field[i] === undefined) {
                return monads_1.None;
            }
            values[i] = field[i];
        }
        const optionValue = withFn(values);
        if (optionValue.isNone()) {
            return monads_1.None;
        }
        field.splice(0, n);
        if (field.length === 0) {
            fields.delete((0, integer_1.u128)(tag));
        }
        return (0, monads_1.Some)(optionValue.unwrap());
    }
    Tag.take = take;
    function encode(tag, values) {
        return Buffer.concat(values.map((value) => [integer_1.u128.encodeVarInt((0, integer_1.u128)(tag)), integer_1.u128.encodeVarInt(value)]).flat());
    }
    Tag.encode = encode;
    function encodeOptionInt(tag, value) {
        return value.map((value) => Tag.encode(tag, [(0, integer_1.u128)(value)])).unwrapOr(Buffer.alloc(0));
    }
    Tag.encodeOptionInt = encodeOptionInt;
})(Tag || (exports.Tag = Tag = {}));
//# sourceMappingURL=tag.js.map