import { method, prop } from '../decorators.js';
import { assert, len, toByteString } from '../fns/index.js';
import { SmartContractLib } from '../smartContractLib.js';
import { ByteString } from '../types/primitives.js';
import { StdUtils } from './stdUtils.js';

/**
 * A writer that serializes `ByteString`, `boolean`, `bigint`
 * @category Standard Contracts
 */
export class ByteStringWriter extends SmartContractLib {
    @prop()
    buf: ByteString;

    constructor() {
        super();
        this.buf = toByteString('');
    }
    /**
     * serializes `ByteString` with `VarInt` encoding
     * @param buf a `ByteString`
     * @returns serialized `ByteString`
     */
    @method()
    writeBytes(buf: ByteString): void {
        const n = len(buf);

        let header: ByteString = toByteString('');

        if (n < StdUtils.OP_PUSHDATA1_VAL) {
            header = StdUtils.toLEUnsigned(n, 1n);
        }
        else if (n < 0x100) {
            header = toByteString('4c') + StdUtils.toLEUnsigned(n, 1n);
        }
        else if (n < 0x10000) {
            header = toByteString('4d') + StdUtils.toLEUnsigned(n, 2n);
        }
        else if (n < 0x100000000) {
            header = toByteString('4e') + StdUtils.toLEUnsigned(n, 4n);
        }
        else {
            // shall not reach here
            assert(false);
        }

        this.buf += header + buf;
    }

    /**
     * serializes `boolean` with fixed 1 byte
     * @param x a boolean
     * @returns serialized `ByteString`
     */
    @method()
    writeBool(x: boolean): void {
        this.buf += x ? toByteString('01') : toByteString('00');
    }

    /**
     * serializes `bigint` with `VarInt` encoding
     * @param x a boolean
     * @returns serialized `ByteString`
     */
    @method()
    writeVarInt(x: bigint): void {
        assert(x >= 0n);
        let size = 0n;
        if (x < 0xfdn) {
            size = 1n;
        }
        else if (x < 0x10000n) {
            this.buf += StdUtils.VARINT_2BYTE;
            size = 2n;
        }
        else if (x < 0x100000000n) {
            size = 4n;
            this.buf += StdUtils.VARINT_4BYTE;
        }
        else {
            size = 8n;
            this.buf += StdUtils.VARINT_8BYTE;
        }
        this.buf += StdUtils.toLEUnsigned(x, size);
    }
}
