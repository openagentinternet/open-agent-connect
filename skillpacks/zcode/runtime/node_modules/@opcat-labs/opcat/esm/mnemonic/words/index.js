import chinese from './chinese.js';
import english from './english.js';
import french from './french.js';
import italian from './italian.js';
import japanese from './japanese.js';
import spanish from './spanish.js';


/**
 * Represents a collection of words for mnemonic purposes.
 * @constructor
 */
function Words() {

}

/**
 * Chinese word list for mnemonic generation.
 * @memberof Words
 * @type {string[]}
 * @name CHINESE
 */
Words.CHINESE = chinese;

/**
 * English word list for mnemonic generation.
 * @memberof Words
 * @type {string[]}
 * @name ENGLISH
 */
Words.ENGLISH = english;

/**
 * French word list for mnemonic generation.
 * @memberof Words
 * @type {string[]}
 * @name FRENCH
 */
Words.FRENCH = french;


/**
 * Italian word list for mnemonic generation.
 * @memberof Words
 * @type {string[]}
 * @name ITALIAN
 */
Words.ITALIAN = italian;

/**
 * Japanese word list for mnemonic generation.
 * @memberof Words
 * @type {string[]}
 * @name JAPANESE
 */
Words.JAPANESE = japanese;

/**
 * Spanish word list for mnemonic generation.
 * @memberof Words
 * @type {string[]}
 * @name SPANISH
 */
Words.SPANISH = spanish;

export default Words;
