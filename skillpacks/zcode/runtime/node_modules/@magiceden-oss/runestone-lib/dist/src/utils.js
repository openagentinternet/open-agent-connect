"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Instruction = void 0;
var Instruction;
(function (Instruction) {
    function isNumber(instruction) {
        return typeof instruction === 'number';
    }
    Instruction.isNumber = isNumber;
    function isBuffer(instruction) {
        return typeof instruction !== 'number';
    }
    Instruction.isBuffer = isBuffer;
})(Instruction || (exports.Instruction = Instruction = {}));
//# sourceMappingURL=utils.js.map