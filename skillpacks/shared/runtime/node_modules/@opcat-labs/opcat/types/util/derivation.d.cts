export = Derivation;
/**
 * Represents a derivation function or class (purpose to be determined based on implementation).
 * @constructor
 */
declare function Derivation(): void;
declare class Derivation {
}
declare namespace Derivation {
    let RootElementAlias: string[];
    let Hardened: number;
    /**
     * function that splits a string path into a derivation index array.
     * It will return null if the string path is malformed.
     * It does not validate if indexes are in bounds.
     *
     * @param {string} path
     * @return {Array}
     */
    function getDerivationIndexes(path: string): any[];
}
