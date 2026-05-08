'use strict';

require('chai').should();
var expect = require('chai').expect;

var opcat = require('../..');
var Transaction = opcat.Transaction;
var TransactionSignature = opcat.Transaction.Signature;
var Script = opcat.Script;
var PrivateKey = opcat.PrivateKey;
var errors = opcat.errors;

describe('TransactionSignature', function () {
  var fromAddress = 'mszYqVnqKoQx4jcTdJXxwKAissE3Jbrrc1';
  var privateKey = 'cSBnVM4xvxarwGQuAfQFwqDg9k5tErHUHzgWsEfD4zdwUasvqRVY';
  var simpleUtxoWith100000Satoshis = {
    address: fromAddress,
    txId: 'a477af6b2667c29670467e4e0728b685ee07b240235771862318e29ddbe58458',
    outputIndex: 0,
    script: Script.buildPublicKeyHashOut(fromAddress).toString(),
    satoshis: 100000,
  };

  var getSignatureFromTransaction = function () {
    var transaction = new Transaction();
    transaction.from(simpleUtxoWith100000Satoshis);
    return transaction.getSignatures(privateKey)[0];
  };

  it('can be created without the `new` keyword', function () {
    var signature = getSignatureFromTransaction();
    var serialized = signature.toObject();
    var nonew = TransactionSignature(serialized);
    expect(nonew.toObject()).to.deep.equal(serialized);
  });

  it('can be retrieved from Transaction#getSignatures', function () {
    var signature = getSignatureFromTransaction();
    expect(signature instanceof TransactionSignature).to.equal(true);
  });

  it('fails when trying to create from invalid arguments', function () {
    expect(function () {
      return new TransactionSignature();
    }).to.throw(errors.InvalidArgument);
    expect(function () {
      return new TransactionSignature(1);
    }).to.throw(errors.InvalidArgument);
    expect(function () {
      return new TransactionSignature('hello world');
    }).to.throw(errors.InvalidArgument);
  });
  it('returns the same object if called with a TransactionSignature', function () {
    var signature = getSignatureFromTransaction();
    expect(new TransactionSignature(signature)).to.equal(signature);
  });

  it('can be aplied to a Transaction with Transaction#addSignature', function () {
    var transaction = new Transaction();
    transaction.from(simpleUtxoWith100000Satoshis);
    var signature = transaction.getSignatures(privateKey)[0];
    var addSignature = function () {
      return transaction.applySignature(signature);
    };
    expect(signature instanceof TransactionSignature).to.equal(true);
    expect(addSignature).to.not.throw();
  });

  describe('serialization', function () {
    it('serializes to an object and roundtrips correctly', function () {
      var signature = getSignatureFromTransaction();
      var serialized = signature.toObject();
      expect(new TransactionSignature(serialized).toObject()).to.deep.equal(serialized);
    });

    it('can be deserialized with fromObject', function () {
      var signature = getSignatureFromTransaction();
      var serialized = signature.toObject();
      expect(TransactionSignature.fromObject(serialized).toObject()).to.deep.equal(serialized);
    });

    it('can deserialize when signature is a buffer', function () {
      var signature = getSignatureFromTransaction();
      var serialized = signature.toObject();
      serialized.signature = Buffer.from(serialized.signature, 'hex');
      expect(TransactionSignature.fromObject(serialized).toObject()).to.deep.equal(
        signature.toObject(),
      );
    });

    it('can roundtrip to/from json', function () {
      var signature = getSignatureFromTransaction();
      var serialized = signature.toObject();
      var json = JSON.stringify(signature);
      expect(TransactionSignature(JSON.parse(json)).toObject()).to.deep.equal(serialized);
      expect(TransactionSignature.fromObject(JSON.parse(json)).toObject()).to.deep.equal(
        serialized,
      );
    });

    it('can parse a previously known json string', function () {
      var str = JSON.stringify(TransactionSignature(JSON.parse(testJSON)));
      expect(JSON.parse(str)).to.deep.equal(JSON.parse(testJSON));
    });

    it('can deserialize a previously known object', function () {
      expect(TransactionSignature(testObject).toObject()).to.deep.equal(testObject);
    });
  });

  var testJSON =
    '{"publicKey":"0223078d2942df62c45621d209fab84ea9a7a23346201b7727b9b45a29c4e76f5e","prevTxId":"a477af6b2667c29670467e4e0728b685ee07b240235771862318e29ddbe58458","outputIndex":0,"inputIndex":0,"signature":"3045022100c728eac064154edba15d4f3e6cbd9be6da3498f80a783ab3391f992b4d9d71ca0220729eff4564dc06aa1d80ab73100540fe5ebb6f280b4a87bc32399f861a7b2563","sigtype":1}';
  var testObject = JSON.parse(testJSON);
});
