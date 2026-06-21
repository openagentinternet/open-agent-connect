'use strict'

var should = require('chai').should()
var mvc = require('../')

describe('#versionGuard', function () {
  it('global._mvc should be defined', function () {
    should.equal(global._mvc, mvc.version)
  })

  it('throw an error if version is already defined', function () {
    (function () {
      mvc.versionGuard('version')
    }).should.not.throw('More than one instance of mvc')
  })
})
