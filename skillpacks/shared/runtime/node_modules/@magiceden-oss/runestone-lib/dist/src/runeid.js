"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RuneId = void 0;
const monads_1 = require("./monads");
const integer_1 = require("./integer");
class RuneId {
    constructor(block, tx) {
        this.block = block;
        this.tx = tx;
    }
    static new(block, tx) {
        const id = new RuneId(block, tx);
        if (id.block === 0n && id.tx > 0) {
            return monads_1.None;
        }
        return (0, monads_1.Some)(id);
    }
    static sort(runeIds) {
        return [...runeIds].sort((x, y) => Number(x.block - y.block || x.tx - y.tx));
    }
    delta(next) {
        const optionBlock = integer_1.u64.checkedSub(next.block, this.block);
        if (optionBlock.isNone()) {
            return monads_1.None;
        }
        const block = optionBlock.unwrap();
        let tx;
        if (block === 0n) {
            const optionTx = integer_1.u32.checkedSub(next.tx, this.tx);
            if (optionTx.isNone()) {
                return monads_1.None;
            }
            tx = optionTx.unwrap();
        }
        else {
            tx = next.tx;
        }
        return (0, monads_1.Some)([(0, integer_1.u128)(block), (0, integer_1.u128)(tx)]);
    }
    next(block, tx) {
        const optionBlock = integer_1.u128.tryIntoU64(block);
        const optionTx = integer_1.u128.tryIntoU32(tx);
        if (optionBlock.isNone() || optionTx.isNone()) {
            return monads_1.None;
        }
        const blockU64 = optionBlock.unwrap();
        const txU32 = optionTx.unwrap();
        const nextBlock = integer_1.u64.checkedAdd(this.block, blockU64);
        if (nextBlock.isNone()) {
            return monads_1.None;
        }
        let nextTx;
        if (blockU64 === 0n) {
            const optionAdd = integer_1.u32.checkedAdd(this.tx, txU32);
            if (optionAdd.isNone()) {
                return monads_1.None;
            }
            nextTx = optionAdd.unwrap();
        }
        else {
            nextTx = txU32;
        }
        return RuneId.new(nextBlock.unwrap(), nextTx);
    }
    toString() {
        return `${this.block}:${this.tx}`;
    }
    static fromString(s) {
        const parts = s.split(':');
        if (parts.length !== 2) {
            throw new Error(`invalid rune ID: ${s}`);
        }
        const [block, tx] = parts;
        if (!/^\d+$/.test(block) || !/^\d+$/.test(tx)) {
            throw new Error(`invalid rune ID: ${s}`);
        }
        return new RuneId((0, integer_1.u64)(BigInt(block)), (0, integer_1.u32)(BigInt(tx)));
    }
}
exports.RuneId = RuneId;
//# sourceMappingURL=runeid.js.map