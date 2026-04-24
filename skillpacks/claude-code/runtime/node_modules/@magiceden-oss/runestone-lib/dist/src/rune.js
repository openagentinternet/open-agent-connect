"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Rune = void 0;
const network_1 = require("./network");
const constants_1 = require("./constants");
const integer_1 = require("./integer");
class Rune {
    constructor(value) {
        this.value = value;
    }
    static getMinimumAtHeight(chain, height) {
        let offset = integer_1.u128.saturatingAdd(height, (0, integer_1.u128)(1));
        const INTERVAL = (0, integer_1.u128)(constants_1.SUBSIDY_HALVING_INTERVAL / 12);
        let startSubsidyInterval = (0, integer_1.u128)(network_1.Network.getFirstRuneHeight(chain));
        let endSubsidyInterval = integer_1.u128.saturatingAdd(startSubsidyInterval, (0, integer_1.u128)(constants_1.SUBSIDY_HALVING_INTERVAL));
        if (offset < startSubsidyInterval) {
            return new Rune(Rune.STEPS[12]);
        }
        if (offset >= endSubsidyInterval) {
            return new Rune((0, integer_1.u128)(0));
        }
        let progress = integer_1.u128.saturatingSub(offset, startSubsidyInterval);
        let length = integer_1.u128.saturatingSub((0, integer_1.u128)(12n), (0, integer_1.u128)(progress / INTERVAL));
        let lengthNumber = Number(length & (0, integer_1.u128)(integer_1.u32.MAX));
        let endStepInterval = Rune.STEPS[lengthNumber];
        let startStepInterval = Rune.STEPS[lengthNumber - 1];
        let remainder = (0, integer_1.u128)(progress % INTERVAL);
        return new Rune((0, integer_1.u128)(endStepInterval - ((endStepInterval - startStepInterval) * remainder) / INTERVAL));
    }
    get reserved() {
        return this.value >= constants_1.RESERVED;
    }
    get commitment() {
        const bytes = Buffer.alloc(16);
        bytes.writeBigUInt64LE(0xffffffffffffffffn & this.value, 0);
        bytes.writeBigUInt64LE(this.value >> 64n, 8);
        let end = bytes.length;
        while (end > 0 && bytes.at(end - 1) === 0) {
            end--;
        }
        return bytes.subarray(0, end);
    }
    static getReserved(block, tx) {
        return new Rune(integer_1.u128.checkedAdd(constants_1.RESERVED, (0, integer_1.u128)((block << 32n) | tx)).unwrap());
    }
    toString() {
        let n = this.value;
        if (n === integer_1.u128.MAX) {
            return 'BCGDENLQRQWDSLRUGSNLBTMFIJAV';
        }
        n = (0, integer_1.u128)(n + 1n);
        let symbol = '';
        while (n > 0) {
            symbol = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Number((n - 1n) % 26n)] + symbol;
            n = (0, integer_1.u128)((n - 1n) / 26n);
        }
        return symbol;
    }
    static fromString(s) {
        let x = (0, integer_1.u128)(0);
        for (const i of [...Array(s.length).keys()]) {
            const c = s[i];
            if (i > 0) {
                x = (0, integer_1.u128)(x + 1n);
            }
            x = integer_1.u128.checkedMultiply(x, (0, integer_1.u128)(26)).unwrap();
            if ('A' <= c && c <= 'Z') {
                x = integer_1.u128.checkedAdd(x, (0, integer_1.u128)(c.charCodeAt(0) - 'A'.charCodeAt(0))).unwrap();
            }
            else {
                throw new Error(`invalid character in rune name: ${c}`);
            }
        }
        return new Rune(x);
    }
}
exports.Rune = Rune;
Rune.STEPS = [
    (0, integer_1.u128)(0n),
    (0, integer_1.u128)(26n),
    (0, integer_1.u128)(702n),
    (0, integer_1.u128)(18278n),
    (0, integer_1.u128)(475254n),
    (0, integer_1.u128)(12356630n),
    (0, integer_1.u128)(321272406n),
    (0, integer_1.u128)(8353082582n),
    (0, integer_1.u128)(217180147158n),
    (0, integer_1.u128)(5646683826134n),
    (0, integer_1.u128)(146813779479510n),
    (0, integer_1.u128)(3817158266467286n),
    (0, integer_1.u128)(99246114928149462n),
    (0, integer_1.u128)(2580398988131886038n),
    (0, integer_1.u128)(67090373691429037014n),
    (0, integer_1.u128)(1744349715977154962390n),
    (0, integer_1.u128)(45353092615406029022166n),
    (0, integer_1.u128)(1179180408000556754576342n),
    (0, integer_1.u128)(30658690608014475618984918n),
    (0, integer_1.u128)(797125955808376366093607894n),
    (0, integer_1.u128)(20725274851017785518433805270n),
    (0, integer_1.u128)(538857146126462423479278937046n),
    (0, integer_1.u128)(14010285799288023010461252363222n),
    (0, integer_1.u128)(364267430781488598271992561443798n),
    (0, integer_1.u128)(9470953200318703555071806597538774n),
    (0, integer_1.u128)(246244783208286292431866971536008150n),
    (0, integer_1.u128)(6402364363415443603228541259936211926n),
    (0, integer_1.u128)(166461473448801533683942072758341510102n),
];
//# sourceMappingURL=rune.js.map