"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpacedRune = void 0;
const rune_1 = require("./rune");
class SpacedRune {
    constructor(rune, spacers) {
        this.rune = rune;
        this.spacers = spacers;
    }
    static fromString(s) {
        let rune = '';
        let spacers = 0;
        for (const c of s) {
            if ('A' <= c && c <= 'Z') {
                rune += c;
            }
            else if ('.' === c || '•' === c) {
                if (rune.length === 0) {
                    throw new Error('leading spacer');
                }
                const flag = 1 << (rune.length - 1);
                if ((spacers & flag) !== 0) {
                    throw new Error('double spacer');
                }
                spacers |= flag;
            }
            else {
                throw new Error('invalid character');
            }
        }
        if (spacers >= 1 << (rune.length - 1)) {
            throw new Error('trailing spacer');
        }
        return new SpacedRune(rune_1.Rune.fromString(rune), spacers);
    }
    toString() {
        const rune = this.rune.toString();
        let i = 0;
        let result = '';
        for (const c of rune) {
            result += c;
            if (i < rune.length - 1 && (this.spacers & (1 << i)) !== 0) {
                result += '•';
            }
            i++;
        }
        return result;
    }
}
exports.SpacedRune = SpacedRune;
//# sourceMappingURL=spacedrune.js.map