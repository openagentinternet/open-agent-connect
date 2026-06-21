import decodeHex from './decode-hex.js';
import opcodes from '../opcode.js';
import BufferWriter from './bufferwriter.js';
import writePushData from '../script/write-push-data.js';

function decodeASM(script) {
  const parts = script.split(' ');
  const writer = new BufferWriter();
  parts.forEach((part) => {
    if (part in opcodes) {
      writer.write([opcodes[part]]);
    } else if (part === '0') {
      writer.write([opcodes.OP_0]);
    } else if (part === '-1') {
      writer.write([opcodes.OP_1NEGATE]);
    } else {
      const buf = decodeHex(part);
      writePushData(writer, buf);
    }
  });
  return writer.toBuffer();
}

export default decodeASM;
