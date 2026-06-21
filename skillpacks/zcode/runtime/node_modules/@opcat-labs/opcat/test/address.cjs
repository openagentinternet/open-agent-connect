'use strict';

var chai = require('chai');
var should = chai.should();
var expect = chai.expect;

var opcat = require('..');
var PublicKey = opcat.PublicKey;
var PrivateKey = opcat.PrivateKey;
var Address = opcat.Address;
var Script = opcat.Script;
var Networks = opcat.Networks;

var validbase58 = require('./data/bitcoind/base58_keys_valid.json');
var invalidbase58 = require('./data/bitcoind/base58_keys_invalid.json');

describe('Address', function () {
  var pubkeyhash = Buffer.from('3c3fa3d4adcaf8f52d5b1843975e122548269937', 'hex');
  var buf = Buffer.concat([Buffer.from([0]), pubkeyhash]);
  var str = '16VZnHwRhwrExfeHFHGjwrgEMq8VcYPs9r';

  it("can't build without data", function () {
    (function () {
      return new Address();
    }).should.throw('First argument is required, please include address data.');
  });

  it('should throw an error because of bad network param', function () {
    (function () {
      return new Address(PKHLivenet[0], 'main', 'pubkeyhash');
    }).should.throw('Second argument must be "livenet", "testnet", or "regtest".');
  });

  it('should throw an error because of bad type param', function () {
    (function () {
      return new Address(PKHLivenet[0], 'livenet', 'pubkey');
    }).should.throw('Third argument must be "pubkeyhash"');
  });

  describe('bitcoind compliance', function () {
    validbase58.map(function (d) {
      if (!d[2].isPrivkey) {
        it('should describe address ' + d[0] + ' as valid', function () {
          var type;
          if (d[2].addrType === 'script') {
            type = 'scripthash';
          } else if (d[2].addrType === 'pubkey') {
            type = 'pubkeyhash';
          }
          var network = 'livenet';
          if (d[2].isTestnet) {
            network = 'testnet';
          }
          return new Address(d[0], network, type);
        });
      }
    });
    invalidbase58.map(function (d) {
      it('should describe input ' + d[0].slice(0, 10) + '... as invalid', function () {
        expect(function () {
          return new Address(d[0]);
        }).to.throw(Error);
      });
    });
  });

  describe('generic tests', function () {
    it('should pass these tests', function () {
      var str = '13k3vneZ3yvZnc9dNWYH2RJRFsagTfAERv';
      var address = Address.fromString(str);
      address.toString().should.equal(str);
    });
  });

  // livenet valid
  var PKHLivenet = [
    '15vkcKf7gB23wLAnZLmbVuMiiVDc1Nm4a2',
    '1A6ut1tWnUq1SEQLMr4ttDh24wcbJ5o9TT',
    '1BpbpfLdY7oBS9gK7aDXgvMgr1DPvNhEB2',
    '1Jz2yCRd5ST1p2gUqFB5wsSQfdm3jaFfg7',
    '    1Jz2yCRd5ST1p2gUqFB5wsSQfdm3jaFfg7   \t\n',
  ];


  // livenet bad checksums
  var badChecksums = [
    '15vkcKf7gB23wLAnZLmbVuMiiVDc3nq4a2',
    '1A6ut1tWnUq1SEQLMr4ttDh24wcbj4w2TT',
    '1BpbpfLdY7oBS9gK7aDXgvMgr1DpvNH3B2',
    '1Jz2yCRd5ST1p2gUqFB5wsSQfdmEJaffg7',
  ];

  // livenet non-base58
  var nonBase58 = [
    '15vkcKf7g#23wLAnZLmb$uMiiVDc3nq4a2',
    '1A601ttWnUq1SEQLMr4ttDh24wcbj4w2TT',
    '1BpbpfLdY7oBS9gK7aIXgvMgr1DpvNH3B2',
    '1Jz2yCRdOST1p2gUqFB5wsSQfdmEJaffg7',
  ];

  // testnet valid
  var PKHTestnet = [
    'n28S35tqEMbt6vNad7A5K3mZ7vdn8dZ86X',
    'n45x3R2w2jaSC62BMa9MeJCd3TXxgvDEmm',
    'mursDVxqNQmmwWHACpM9VHwVVSfTddGsEM',
    'mtX8nPZZdJ8d3QNLRJ1oJTiEi26Sj6LQXS',
  ];

  describe('validation', function () {
    it('getValidationError detects network mismatchs', function () {
      var error = Address.getValidationError('HC1hAdrx7APHg1DkE4bVLsZhY1SE5Dik1r', 'testnet');
      should.exist(error);
    });


    it('validates correctly the P2PKH test vector', function () {
      for (var i = 0; i < PKHLivenet.length; i++) {
        var error = Address.getValidationError(PKHLivenet[i]);
        should.not.exist(error);
      }
    });

    it('rejects correctly the P2PKH livenet test vector with "testnet" parameter', function () {
      for (var i = 0; i < PKHLivenet.length; i++) {
        var error = Address.getValidationError(PKHLivenet[i], 'testnet');
        should.exist(error);
      }
    });

    it('validates correctly the P2PKH livenet test vector with "livenet" parameter', function () {
      for (var i = 0; i < PKHLivenet.length; i++) {
        var error = Address.getValidationError(PKHLivenet[i], 'livenet');
        should.not.exist(error);
      }
    });

    it('should not validate if checksum is invalid', function () {
      for (var i = 0; i < badChecksums.length; i++) {
        var error = Address.getValidationError(badChecksums[i], 'livenet', 'pubkeyhash');
        should.exist(error);
        error.message.should.match(/Checksum mismatch/);
      }
    });

    it('should not validate on a network mismatch', function () {
      var error, i;
      for (i = 0; i < PKHLivenet.length; i++) {
        error = Address.getValidationError(PKHLivenet[i], 'testnet', 'pubkeyhash');
        should.exist(error);
        error.message.should.equal('Address has mismatched network type.');
      }
      for (i = 0; i < PKHTestnet.length; i++) {
        error = Address.getValidationError(PKHTestnet[i], 'livenet', 'pubkeyhash');
        should.exist(error);
        error.message.should.equal('Address has mismatched network type.');
      }
    });


    it('should not validate on non-base58 characters', function () {
      for (var i = 0; i < nonBase58.length; i++) {
        var error = Address.getValidationError(nonBase58[i], 'livenet', 'pubkeyhash');
        should.exist(error);
        error.message.should.match(/Non-base58/);
      }
    });

    it('testnet addresses are validated correctly', function () {
      for (var i = 0; i < PKHTestnet.length; i++) {
        var error = Address.getValidationError(PKHTestnet[i], 'testnet');
        should.not.exist(error);
      }
    });

    it('addresses with whitespace are validated correctly', function () {
      var ws = '  \r \t    \n 1A6ut1tWnUq1SEQLMr4ttDh24wcbJ5o9TT \t \n            \r';
      var error = Address.getValidationError(ws);
      should.not.exist(error);
      Address.fromString(ws).toString().should.equal('1A6ut1tWnUq1SEQLMr4ttDh24wcbJ5o9TT');
    });
  });

  describe('instantiation', function () {
    it('can be instantiated from another address', function () {
      var address = Address.fromBuffer(buf);
      var address2 = new Address({
        hashBuffer: address.hashBuffer,
        network: address.network,
        type: address.type,
      });
      address.toString().should.equal(address2.toString());
    });
  });

  describe('@fromBuffer', function () {
    it('can be instantiated from another address', function () {
      var address = Address.fromBuffer(buf);
      var address2 = new Address({
        hashBuffer: address.hashBuffer,
        network: address.network,
        type: address.type,
      });
      address.toString().should.equal(address2.toString());
    });
  });

  describe('@fromHex', function () {
    it('can be instantiated from another address', function () {
      var address = Address.fromHex(buf.toString('hex'));
      var address2 = new Address({
        hashBuffer: address.hashBuffer,
        network: address.network,
        type: address.type,
      });
      address.toString().should.equal(address2.toString());
    });
  });

  describe('encodings', function () {
    it('should make an address from a buffer', function () {
      Address.fromBuffer(buf).toString().should.equal(str);
      new Address(buf).toString().should.equal(str);
      new Address(buf).toString().should.equal(str);
    });

    it('should make an address from a string', function () {
      Address.fromString(str).toString().should.equal(str);
      new Address(str).toString().should.equal(str);
    });

    it('should make an address using a non-string network', function () {
      Address.fromString(str, Networks.livenet).toString().should.equal(str);
    });

    it('should throw with bad network param', function () {
      (function () {
        Address.fromString(str, 'somenet');
      }).should.throw('Unknown network');
    });

    it('should error because of unrecognized data format', function () {
      (function () {
        return new Address(new Error());
      }).should.throw(opcat.errors.InvalidArgument);
    });

    it('should error because of incorrect format for pubkey hash', function () {
      (function () {
        return new Address.fromPublicKeyHash('notahash');
      }).should.throw('Address supplied is not a buffer.');
    });

    it('should error because of incorrect type for transform buffer', function () {
      (function () {
        return Address._transformBuffer('notabuffer');
      }).should.throw('Address supplied is not a buffer.');
    });

    it('should error because of incorrect length buffer for transform buffer', function () {
      (function () {
        return Address._transformBuffer(Buffer.alloc(20));
      }).should.throw('Address buffers must be exactly 21 bytes.');
    });

    it('should error because of incorrect type for pubkey transform', function () {
      (function () {
        return Address._transformPublicKey(Buffer.alloc(20));
      }).should.throw('Pubkey supplied is not a buffer with 33 or 65 bytes.');
    });

    it('should error because of incorrect type for string transform', function () {
      (function () {
        return Address._transformString(Buffer.alloc(20));
      }).should.throw('data parameter supplied is not a string.');
    });

    it('should make an address from a pubkey hash buffer', function () {
      var hash = pubkeyhash; // use the same hash
      var a = Address.fromPublicKeyHash(hash, 'livenet');
      a.network.should.equal(Networks.livenet);
      a.toString().should.equal(str);
      var b = Address.fromPublicKeyHash(hash, 'testnet');
      b.network.should.equal(Networks.testnet);
      b.type.should.equal('pubkeyhash');
      new Address(hash, 'livenet').toString().should.equal(str);
    });

    it('should make an address using the default network', function () {
      var hash = pubkeyhash; // use the same hash
      var network = Networks.defaultNetwork;
      Networks.defaultNetwork = Networks.livenet;
      var a = Address.fromPublicKeyHash(hash);
      a.network.should.equal(Networks.livenet);
      // change the default
      Networks.defaultNetwork = Networks.testnet;
      var b = Address.fromPublicKeyHash(hash);
      b.network.should.equal(Networks.testnet);
      // restore the default
      Networks.defaultNetwork = network;
    });

    it('should throw an error for invalid length hashBuffer', function () {
      (function () {
        return Address.fromPublicKeyHash(buf);
      }).should.throw('Address hashbuffers must be exactly 20 bytes.');
    });

    it('should make this address from a compressed pubkey', function () {
      var pubkey = new PublicKey(
        '0285e9737a74c30a873f74df05124f2aa6f53042c2fc0a130d6cbd7d16b944b004',
      );
      var address = Address.fromPublicKey(pubkey.toBuffer(), 'livenet');
      address.toString().should.equal('19gH5uhqY6DKrtkU66PsZPUZdzTd11Y7ke');
    });

    it('should use the default network for pubkey', function () {
      var pubkey = new PublicKey(
        '0285e9737a74c30a873f74df05124f2aa6f53042c2fc0a130d6cbd7d16b944b004',
      );
      var address = Address.fromPublicKey(pubkey.toBuffer());
      address.network.should.equal(Networks.defaultNetwork);
    });

    it('should make this address from an uncompressed pubkey', function () {
      var pubkey = new PublicKey(
        '0485e9737a74c30a873f74df05124f2aa6f53042c2fc0a130d6cbd7d16b944b00' +
          '4833fef26c8be4c4823754869ff4e46755b85d851077771c220e2610496a29d98',
      );
      var a = Address.fromPublicKey(pubkey.toBuffer(), 'livenet');
      a.toString().should.equal('16JXnhxjJUhxfyx4y6H4sFcxrgt8kQ8ewX');
      var b = new Address(pubkey.toBuffer(), 'livenet', 'pubkeyhash');
      b.toString().should.equal('16JXnhxjJUhxfyx4y6H4sFcxrgt8kQ8ewX');
    });

    it('should classify from a custom network', function () {
      var custom = {
        name: 'customnetwork',
        pubkeyhash: 10,
        privatekey: 0x1e,
        scripthash: 15,
        xpubkey: 0x02e8de8f,
        xprivkey: 0x02e8da54,
        networkMagic: 0x0c110907,
        port: 7333,
      };
      Networks.add(custom);
      var addressString = '57gZdnwcQHLirKLwDHcFiWLq9jTZwRaxaE';
      var network = Networks.get('customnetwork');
      var address = Address.fromString(addressString);
      address.type.should.equal(Address.PayToPublicKeyHash);
      address.network.should.equal(network);
      Networks.remove(network);
    });


    it('should derive from this known address string livenet', function () {
      var address = new Address(str);
      var buffer = address.toBuffer();
      var slice = buffer.slice(1);
      var sliceString = slice.toString('hex');
      sliceString.should.equal(pubkeyhash.toString('hex'));
    });

    it('should derive from this known address string testnet', function () {
      var a = new Address(PKHTestnet[0], 'testnet');
      var b = new Address(a.toString());
      b.toString().should.equal(PKHTestnet[0]);
      b.network.should.equal(Networks.testnet);
    });

  });

  describe('#toBuffer', function () {
    it('3c3fa3d4adcaf8f52d5b1843975e122548269937 corresponds to hash 16VZnHwRhwrExfeHFHGjwrgEMq8VcYPs9r', function () {
      var address = new Address(str);
      address.toBuffer().slice(1).toString('hex').should.equal(pubkeyhash.toString('hex'));
    });
  });

  describe('#toHex', function () {
    it('3c3fa3d4adcaf8f52d5b1843975e122548269937 corresponds to hash 16VZnHwRhwrExfeHFHGjwrgEMq8VcYPs9r', function () {
      var address = new Address(str);
      address.toHex().slice(2).should.equal(pubkeyhash.toString('hex'));
    });
  });

  describe('#object', function () {
    it('roundtrip to-from-to', function () {
      var obj = new Address(str).toObject();
      var address = Address.fromObject(obj);
      address.toString().should.equal(str);
    });

    it('will fail with invalid state', function () {
      expect(function () {
        return Address.fromObject('¹');
      }).to.throw(opcat.errors.InvalidState);
    });
  });

  describe('#toString', function () {
    it('livenet pubkeyhash address', function () {
      var address = new Address(str);
      address.toString().should.equal(str);
    });

    it('testnet pubkeyhash address', function () {
      var address = new Address(PKHTestnet[0]);
      address.toString().should.equal(PKHTestnet[0]);
    });
  });

  describe('#inspect', function () {
    it('should output formatted output correctly', function () {
      var address = new Address(str);
      var output =
        '<Address: 16VZnHwRhwrExfeHFHGjwrgEMq8VcYPs9r, type: pubkeyhash, network: livenet>';
      address.inspect().should.equal(output);
    });
  });

  describe('questions about the address', function () {
    it('should detect a Pay To PubkeyHash address', function () {
      new Address(PKHLivenet[0]).isPayToPublicKeyHash().should.equal(true);
      new Address(PKHTestnet[0]).isPayToPublicKeyHash().should.equal(true);
    });
  });

  it("throws an error if it couldn't instantiate", function () {
    expect(function () {
      return new Address(1);
    }).to.throw(TypeError);
  });

  it('will use the default network for an object', function () {
    var obj = {
      hash: '19a7d869032368fd1f1e26e5e73a4ad0e474960e',
      type: 'scripthash',
    };
    var address = new Address(obj);
    address.network.should.equal(Networks.defaultNetwork);
  });

  describe('#fromPublicKey', function () {
    it('should derive from public key', function () {
      let privateKey = PrivateKey.fromRandom();
      let publicKey = PublicKey.fromPrivateKey(privateKey);
      let address = Address.fromPublicKey(publicKey.toBuffer(), publicKey.network);
      address.toString()[0].should.equal('1');
    });

    it('should derive from public key testnet', function () {
      let privateKey = PrivateKey.fromRandom('testnet');
      let address = privateKey.toAddress()
      let addresStr = address.toString();
      (addresStr[0] === 'm' || addresStr[0] === 'n').should.equal(true);
    });
  });

  describe('#fromPrivateKey', function () {
    it('should derive from public key', function () {
      let privateKey = PrivateKey.fromRandom();
      let address = privateKey.toAddress()
      address.toString()[0].should.equal('1');
    });

    it('should derive from public key testnet', function () {
      let privateKey = PrivateKey.fromRandom('testnet');
      let address = privateKey.toAddress()
      let addresStr = address.toString();
      (addresStr[0] === 'm' || addresStr[0] === 'n').should.equal(true);
    });

    it('should derive from public key testnet', function () {
      let privateKey = PrivateKey.fromRandom('testnet');
      let address = privateKey.toAddress();
      (address.toString()[0] === 'm' || address.toString()[0] === 'n').should.equal(true);
    });
  });
});
