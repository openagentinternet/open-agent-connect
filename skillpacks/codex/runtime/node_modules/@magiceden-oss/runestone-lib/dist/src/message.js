"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Message = void 0;
const edict_1 = require("./edict");
const flaw_1 = require("./flaw");
const integer_1 = require("./integer");
const runeid_1 = require("./runeid");
const tag_1 = require("./tag");
class Message {
    constructor(flaws, edicts, fields) {
        this.flaws = flaws;
        this.edicts = edicts;
        this.fields = fields;
    }
    static fromIntegers(numOutputs, payload) {
        const edicts = [];
        const fields = new Map();
        const flaws = [];
        for (const i of [...Array(Math.ceil(payload.length / 2)).keys()].map((n) => n * 2)) {
            const tag = payload[i];
            if ((0, integer_1.u128)(tag_1.Tag.BODY) === tag) {
                let id = new runeid_1.RuneId((0, integer_1.u64)(0), (0, integer_1.u32)(0));
                const chunkSize = 4;
                const body = payload.slice(i + 1);
                for (let j = 0; j < body.length; j += chunkSize) {
                    const chunk = body.slice(j, j + chunkSize);
                    if (chunk.length !== chunkSize) {
                        flaws.push(flaw_1.Flaw.TRAILING_INTEGERS);
                        break;
                    }
                    const optionNext = id.next(chunk[0], chunk[1]);
                    if (optionNext.isNone()) {
                        flaws.push(flaw_1.Flaw.EDICT_RUNE_ID);
                        break;
                    }
                    const next = optionNext.unwrap();
                    const optionEdict = edict_1.Edict.fromIntegers(numOutputs, next, chunk[2], chunk[3]);
                    if (optionEdict.isNone()) {
                        flaws.push(flaw_1.Flaw.EDICT_OUTPUT);
                        break;
                    }
                    const edict = optionEdict.unwrap();
                    id = next;
                    edicts.push(edict);
                }
                break;
            }
            const value = payload[i + 1];
            if (value === undefined) {
                flaws.push(flaw_1.Flaw.TRUNCATED_FIELD);
                break;
            }
            const values = fields.get(tag) ?? [];
            values.push(value);
            fields.set(tag, values);
        }
        return new Message(flaws, edicts, fields);
    }
}
exports.Message = Message;
//# sourceMappingURL=message.js.map