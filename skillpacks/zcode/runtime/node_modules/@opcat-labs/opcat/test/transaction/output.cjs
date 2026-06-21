'use strict';

var should = require('chai').should();

var opcat = require('../..');
var BN = opcat.crypto.BN;
var BufferWriter = opcat.encoding.BufferWriter;
var BufferReader = opcat.encoding.BufferReader;
var Output = opcat.Transaction.Output;
var Script = opcat.Script;

describe('Output', function () {
  var output = new Output({
    satoshis: 0,
    script: Script.empty(),
  });

  it('throws error with unrecognized argument', function () {
    (function () {
      new Output(12345);
    }).should.throw(TypeError);
  });

  it('can be assigned a satoshi amount in big number', function () {
    var newOutput = new Output({
      satoshis: new BN(100),
      script: Script.empty(),
    });
    newOutput.satoshis.should.equal(100);
  });

  it('can be assigned a satoshi amount with a string', function () {
    var newOutput = new Output({
      satoshis: '100',
      script: Script.empty(),
    });
    newOutput.satoshis.should.equal(100);
  });

  describe('will error if output is not a positive integer', function () {
    it('-100', function () {
      (function () {
        new Output({
          satoshis: -100,
          script: Script.empty(),
        });
      }).should.throw('Output satoshis is not a natural number');
    });

    it('1.1', function () {
      (function () {
        new Output({
          satoshis: 1.1,
          script: Script.empty(),
        });
      }).should.throw('Output satoshis is not a natural number');
    });

    it('NaN', function () {
      (function () {
        new Output({
          satoshis: NaN,
          script: Script.empty(),
        });
      }).should.throw('Output satoshis is not a natural number');
    });

    it('Infinity', function () {
      (function () {
        new Output({
          satoshis: Infinity,
          script: Script.empty(),
        });
      }).should.throw('Output satoshis is not a natural number');
    });
  });

  var expectEqualOutputs = function (a, b) {
    a.satoshis.should.equal(b.satoshis);
    a.script.toString().should.equal(b.script.toString());
    a.data.toString().should.equal(b.data.toString());
  };

  it('deserializes correctly a simple output', function () {
    var writer = new BufferWriter();
    output.toBufferWriter(false, writer);
    var deserialized = Output.fromBufferReader(new BufferReader(writer.toBuffer()));
    expectEqualOutputs(output, deserialized);
  });

  it('can instantiate from an object', function () {
    var out = new Output(output.toObject());
    should.exist(out);
  });

  it('can set a script from a buffer', function () {
    var newOutput = new Output(output.toObject());
    newOutput.setScript(Script().add(0).toBuffer());
    newOutput.inspect().should.equal('<Output (0 sats) <Script: OP_0>>');
  });

  it('has a inspect property', function () {
    output.inspect().should.equal('<Output (0 sats) <Script: >>');
  });

  var output2 = new Output({
    satoshis: 1100000000,
    script: new Script(
      'OP_2 33 0x038282263212c609d9ea2a6e3e172de238d8c39' +
        'cabd5ac1ca10646e23fd5f51508 33 0x038282263212c609d9ea2a6e3e172de23' +
        '8d8c39cabd5ac1ca10646e23fd5f51508 OP_2 OP_CHECKMULTISIG OP_EQUAL',
    ),
  });

  it('toBufferWriter', function () {
    output2
      .toBufferWriter(false)
      .toBuffer()
      .toString('hex')
      .should.equal(
        '00ab904100000000485221038282263212c609d9ea2a6e3e172de2' +
          '38d8c39cabd5ac1ca10646e23fd5f5150821038282263212c609d9ea2a6e3e172d' +
          'e238d8c39cabd5ac1ca10646e23fd5f5150852ae8700',
      );
  });

  it('roundtrips to/from object', function () {
    var newOutput = new Output({
      satoshis: 50,
      script: new Script().add(0),
    });
    var otherOutput = new Output(newOutput.toObject());
    expectEqualOutputs(newOutput, otherOutput);
  });

  it('toObject will handle an invalid (null) script', function () {
    // block 000000000000000b7e48f88e86ceee3e97b4df7c139f5411d14735c1b3c36791 (livenet)
    // transaction index 2
    // txid ebc9fa1196a59e192352d76c0f6e73167046b9d37b8302b6bb6968dfd279b767
    var transaction = opcat.Transaction();
    transaction.fromString(
      '01000000019ac03d5ae6a875d970128ef9086cef276a1919684a6988023cc7254691d97e6d010000006b4830450221009d41dc793ba24e65f571473d40b299b6459087cea1509f0d381740b1ac863cb6022039c425906fcaf51b2b84d8092569fb3213de43abaff2180e2a799d4fcb4dd0aa012102d5ede09a8ae667d0f855ef90325e27f6ce35bbe60a1e6e87af7f5b3c652140fdffffffff0801000000000000000101000100000000000000020201000100000000000000014c000100000000000000034c0201000100000000000000014d000100000000000000044dffff01000100000000000000014e000100000000000000064effffffff010000000000',
    );
    var obj = transaction.toObject();
    obj.outputs[2].script.should.equal('4c');
    obj.outputs[4].script.should.equal('4d');
    obj.outputs[6].script.should.equal('4e');
  });

  it('#toObject roundtrip will handle an invalid (null) script', function () {
    var invalidOutputScript = Buffer.from('0100000000000000014c00', 'hex');
    var br = new opcat.encoding.BufferReader(invalidOutputScript);
    var output = Output.fromBufferReader(br);
    var output2 = new Output(output.toObject());
    should.equal(output2.script.toString('hex'), output.script.toString('hex'));
    should.equal(output2.script.toHex(), '4c');
    should.equal(output2.data.toString('hex'), '');
  });

  it('inspect will work with an invalid (null) script', function () {
    var invalidOutputScript = Buffer.from('0100000000000000014c00', 'hex');
    var br = new opcat.encoding.BufferReader(invalidOutputScript);
    var output = Output.fromBufferReader(br);
    output.inspect().should.equal('<Output (1 sats) <Script: OP_PUSHDATA1>>');
  });

  it('roundtrips to/from JSON', function () {
    var json = JSON.stringify(output2);
    var o3 = new Output(JSON.parse(json));
    JSON.stringify(o3).should.equal(json);
  });

  it('setScript fails with invalid input', function () {
    var out = new Output(output2.toJSON());
    out.setScript.bind(out, 45).should.throw('Invalid argument type: script');
  });

  it('sets script not null if it is an InvalidBuffer', function () {
    var output = new Output({
      satoshis: 1000,
      script: Buffer.from('4c', 'hex'),
    });
    should.equal(output.script.toString(), 'OP_PUSHDATA1');
  });
});
