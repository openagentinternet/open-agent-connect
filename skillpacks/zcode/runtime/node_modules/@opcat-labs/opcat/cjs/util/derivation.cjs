
var _ = require('./_.cjs');

/**
 * Represents a derivation function or class (purpose to be determined based on implementation).
 * @constructor
 */
function Derivation() {
}

Derivation.RootElementAlias = ['m', 'M', "m'", "M'"]
Derivation.Hardened = 0x80000000;

/**
 * function that splits a string path into a derivation index array.
 * It will return null if the string path is malformed.
 * It does not validate if indexes are in bounds.
 *
 * @param {string} path
 * @return {Array}
 */
Derivation.getDerivationIndexes = function getDerivationIndexes(path) {
var steps = path.split('/');

  // Special cases:
  if (_.includes(Derivation.RootElementAlias, path)) {
    return [];
  }

  if (!_.includes(Derivation.RootElementAlias, steps[0])) {
    return null;
  }

  var indexes = steps.slice(1).map(function (step) {
    var isHardened = step.slice(-1) === "'";
    if (isHardened) {
      step = step.slice(0, -1);
    }
    if (!step || step[0] === '-') {
      return NaN;
    }
    var index = +step; // cast to number
    if (isHardened) {
      index += Derivation.Hardened;
    }

    return index;
  });

  return _.some(indexes, isNaN) ? null : indexes;
}

module.exports = Derivation;