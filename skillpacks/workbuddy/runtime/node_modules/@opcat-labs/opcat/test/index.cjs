'use strict';

var should = require('chai').should();
var opcat = require('../');

describe('#versionGuard', function () {
  it('global.opcat should be defined', function () {
    should.equal(global.opcat, opcat.version);
  });

  it('throw an error if version is already defined', function () {
    (function () {
      opcat.versionGuard('version');
    }).should.not.throw('More than one instance of opcat');
  });
});
