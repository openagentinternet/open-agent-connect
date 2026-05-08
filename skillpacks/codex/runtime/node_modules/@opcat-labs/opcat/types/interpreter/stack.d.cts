export = Stack;
/**
 * Represents a stack structure with optional variable stack support.
 * @constructor
 * @param {Array} rawstack - The initial stack array
 * @param {Array} [varStack] - Optional variable stack array
 */
declare function Stack(rawstack: any[], varStack?: any[]): void;
declare class Stack {
    /**
     * Represents a stack structure with optional variable stack support.
     * @constructor
     * @param {Array} rawstack - The initial stack array
     * @param {Array} [varStack] - Optional variable stack array
     */
    constructor(rawstack: any[], varStack?: any[]);
    stack: any[];
    varStack: any[];
    pushVar(varName: any): void;
    popVar(): void;
    push(n: any, varName: any): void;
    pop(): any;
    updateTopVars(vars: any): void;
    stacktop(i: any): any;
    vartop(i: any): any;
    slice(start: any, end: any): any[];
    splice(start: any, deleteCount: any, ...items: any[]): any[];
    write(i: any, value: any): void;
    copy(): Stack;
    printVarStack(): void;
    checkConsistency(): void;
    checkConsistencyWithVars(varStack: any): void;
    get length(): number;
    get rawstack(): any[];
}
