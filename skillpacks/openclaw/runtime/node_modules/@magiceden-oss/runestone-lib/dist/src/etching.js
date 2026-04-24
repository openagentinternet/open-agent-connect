"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Etching = void 0;
const monads_1 = require("./monads");
const integer_1 = require("./integer");
class Etching {
    constructor(divisibility, rune, spacers, symbol, terms, premine, turbo) {
        this.divisibility = divisibility;
        this.rune = rune;
        this.spacers = spacers;
        this.terms = terms;
        this.premine = premine;
        this.turbo = turbo;
        this.symbol = symbol.andThen((value) => {
            const codePoint = value.codePointAt(0);
            return codePoint !== undefined ? (0, monads_1.Some)(String.fromCodePoint(codePoint)) : monads_1.None;
        });
    }
    get supply() {
        const premine = this.premine.unwrapOr((0, integer_1.u128)(0));
        const cap = this.terms.andThen((terms) => terms.cap).unwrapOr((0, integer_1.u128)(0));
        const amount = this.terms.andThen((terms) => terms.amount).unwrapOr((0, integer_1.u128)(0));
        return integer_1.u128
            .checkedMultiply(cap, amount)
            .andThen((multiplyResult) => integer_1.u128.checkedAdd(premine, multiplyResult));
    }
}
exports.Etching = Etching;
//# sourceMappingURL=etching.js.map