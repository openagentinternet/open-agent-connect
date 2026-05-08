export = Words;
/**
 * Represents a collection of words for mnemonic purposes.
 * @constructor
 */
declare function Words(): void;
declare class Words {
}
declare namespace Words {
    export { chinese as CHINESE };
    export { english as ENGLISH };
    export { french as FRENCH };
    export { italian as ITALIAN };
    export { japanese as JAPANESE };
    export { spanish as SPANISH };
}
import chinese = require("./chinese.cjs");
import english = require("./english.cjs");
import french = require("./french.cjs");
import italian = require("./italian.cjs");
import japanese = require("./japanese.cjs");
import spanish = require("./spanish.cjs");
