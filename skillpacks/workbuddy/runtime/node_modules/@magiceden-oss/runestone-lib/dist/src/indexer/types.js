"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RuneLocation = void 0;
var RuneLocation;
(function (RuneLocation) {
    function toString(runeId) {
        return `${runeId.block}:${runeId.tx}`;
    }
    RuneLocation.toString = toString;
})(RuneLocation || (exports.RuneLocation = RuneLocation = {}));
//# sourceMappingURL=types.js.map