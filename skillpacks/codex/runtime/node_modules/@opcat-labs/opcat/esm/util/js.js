'use strict';

import _ from './_.js';
import $ from './preconditions.js';

/**
 * Utility functions for JavaScript operations.
 * @constructor
 */
function JSUtil() {
}

/**
 * Determines whether a string contains only hexadecimal values
 *
 * @name JSUtil.isHexa
 * @param {string} value
 * @return {boolean} true if the string is the hexa representation of a number
 */
JSUtil.isHexa = function isHexa(value) {
  if (!_.isString(value)) {
    return false;
  }
  return /^[0-9a-fA-F]+$/.test(value);
};

JSUtil.isHexaString = JSUtil.isHexa;

/**
 * Checks that a value is a natural number, a positive integer or zero.
 *
 * @param {*} value
 * @return {Boolean}
 */
JSUtil.isNaturalNumber = function isNaturalNumber(value) {
  return (
    typeof value === 'number' && isFinite(value) && Math.floor(value) === value && value >= 0
  );
}

/**
* Transform a 4-byte integer (unsigned value) into a Buffer of length 4 (Big Endian Byte Order)
*
* @param {number} integer
* @return {Buffer}
*/
JSUtil.integerAsBuffer = function integerAsBuffer(integer) {
  $.checkArgumentType(integer, 'number', 'integer');
  const buf = Buffer.allocUnsafe(4);
  buf.writeUInt32BE(integer, 0);
  return buf;
}

/**
 * Test if an argument is a valid JSON object. If it is, returns a truthy
 * value (the json object decoded), so no double JSON.parse call is necessary
 *
 * @param {string} arg
 * @return {Object|boolean} false if the argument is not a JSON string.
 */
JSUtil.isValidJSON = function isValidJSON(arg) {
  var parsed;
  if (!_.isString(arg)) {
    return false;
  }
  try {
    parsed = JSON.parse(arg);
  } catch (e) {
    return false;
  }
  if (typeof parsed === 'object') {
    return true;
  }
  return false;
}

/**
   * Define immutable properties on a target object
   *
   * @param {Object} target - An object to be extended
   * @param {Object} values - An object of properties
   * @return {Object} The target object
   */
JSUtil.defineImmutable = function defineImmutable(target, values) {
  Object.keys(values).forEach(function (key) {
    Object.defineProperty(target, key, {
      configurable: false,
      enumerable: true,
      value: values[key],
    });
  });
  return target;
}

export default JSUtil;
