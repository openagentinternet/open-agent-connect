import { BigNumber } from '../index';
declare const toBigIntHex: (value: BigNumber) => string;
declare const fromBigIntHex: (value: string) => BigNumber;
declare const bigNumber2String: (value: BigNumber, base?: number) => string;
declare const string2BigNumber: (n: string | number, base?: number) => BigNumber;
export { toBigIntHex, fromBigIntHex, bigNumber2String, string2BigNumber };
