import { Edict } from './edict';
import { Flaw } from './flaw';
import { u128 } from './integer';
export declare class Message {
    readonly flaws: Flaw[];
    readonly edicts: Edict[];
    readonly fields: Map<u128, u128[]>;
    constructor(flaws: Flaw[], edicts: Edict[], fields: Map<u128, u128[]>);
    static fromIntegers(numOutputs: number, payload: u128[]): Message;
}
//# sourceMappingURL=message.d.ts.map