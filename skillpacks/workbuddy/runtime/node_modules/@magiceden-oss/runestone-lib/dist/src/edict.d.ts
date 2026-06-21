import { Option } from './monads';
import { RuneId } from './runeid';
import { u128, u32 } from './integer';
export type Edict = {
    id: RuneId;
    amount: u128;
    output: u32;
};
export declare namespace Edict {
    function fromIntegers(numOutputs: number, id: RuneId, amount: u128, output: u128): Option<Edict>;
}
//# sourceMappingURL=edict.d.ts.map