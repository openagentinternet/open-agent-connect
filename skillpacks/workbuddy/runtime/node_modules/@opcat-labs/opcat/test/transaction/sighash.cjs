'use strict';

var buffer = require('buffer');

var chai = require('chai');
chai.should();
var opcat = require('../../');
var Script = opcat.Script;
var BN = opcat.crypto.BN;
var Transaction = opcat.Transaction;
var Signature = opcat.crypto.Signature;
var sighash = Transaction.Sighash;

var vectorsSighash = require('../data/sighash.json');

describe('sighash', function () {
  it('should be able to compute sighash for a coinbase tx', function () {
    var txhex =
      '02000000010000000000000000000000000000000000000000000000000000000000000000ffffffff2e039b1e1304c0737c5b68747470733a2f2f6769746875622e636f6d2f62636578742f01000001c096020000000000ffffffff014a355009000000001976a91448b20e254c0677e760bab964aec16818d6b7134a88ac0000000000';
    var tx = new Transaction(txhex);
    tx.inputs[0].output = new Transaction.Output({
      satoshis: 1,
      script: Script.empty(),
      data: Buffer.from('')
    });
    var sighash = Transaction.Sighash.sighash(tx, Signature.SIGHASH_ALL, 0);
    sighash
      .toString('hex')
      .should.equal('82bb65a2191a2ec6f5de5563cd74bc786b4f045ae323c0af46d8fb23b021ddac');
  });

  var zeroBN = BN.Zero;
  vectorsSighash.forEach(function (vector, i) {
    if (i === 0 || !vector[6]) {
      // First element is just a row describing the next ones
      return;
    }
    it('test vector from bitcoind #' + i + ' (' + vector[6].substring(0, 16) + ')', function () {
      var txbuf = buffer.Buffer.from(vector[0], 'hex');
      var satoshis = vector[1];
      var scriptbuf = buffer.Buffer.from(vector[2], 'hex');
      var script = Script(scriptbuf);
      var data = vector[3];
      var nin = vector[4];
      var nhashtype = vector[5];
      // var nhashtype = vector[3]>>>0;
      var sighashbuf = buffer.Buffer.from(vector[6], 'hex');
      var tx = new Transaction(txbuf);
      tx.inputs[0].output = new Transaction.Output({
        satoshis: satoshis,
        script: script,
        data: data
      });

      // make sure transacion to/from buffer is isomorphic
      tx.uncheckedSerialize().should.equal(txbuf.toString('hex'));

      // sighash ought to be correct
      sighash
        .sighash(tx, nhashtype, nin)
        .toString('hex')
        .should.equal(sighashbuf.toString('hex'));
    });
  });
});
