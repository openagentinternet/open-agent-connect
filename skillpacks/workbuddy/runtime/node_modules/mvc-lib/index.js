'use strict'

var mvc = module.exports

// module information
mvc.version = 'v' + require('./package.json').version
mvc.versionGuard = function (version) {
  if (version !== undefined) {
    var message = `
      More than one instance of mvc found.
      Please make sure to require mvc and check that submodules do
      not also include their own mvc dependency.`
    console.warn(message)
  }
}
mvc.versionGuard(global._mvc)
global._mvc = mvc.version

// crypto
mvc.crypto = {}
mvc.crypto.BN = require('./lib/crypto/bn')
mvc.crypto.ECDSA = require('./lib/crypto/ecdsa')
mvc.crypto.Hash = require('./lib/crypto/hash')
mvc.crypto.Random = require('./lib/crypto/random')
mvc.crypto.Point = require('./lib/crypto/point')
mvc.crypto.Signature = require('./lib/crypto/signature')

// encoding
mvc.encoding = {}
mvc.encoding.Base58 = require('./lib/encoding/base58')
mvc.encoding.Base58Check = require('./lib/encoding/base58check')
mvc.encoding.BufferReader = require('./lib/encoding/bufferreader')
mvc.encoding.BufferWriter = require('./lib/encoding/bufferwriter')
mvc.encoding.Varint = require('./lib/encoding/varint')

// utilities
mvc.util = {}
mvc.util.js = require('./lib/util/js')
mvc.util.preconditions = require('./lib/util/preconditions')

// errors thrown by the library
mvc.errors = require('./lib/errors')

// main bitcoin library
mvc.Address = require('./lib/address')
mvc.Block = require('./lib/block')
mvc.MerkleBlock = require('./lib/block/merkleblock')
mvc.BlockHeader = require('./lib/block/blockheader')
mvc.HDPrivateKey = require('./lib/hdprivatekey.js')
mvc.HDPublicKey = require('./lib/hdpublickey.js')
mvc.Networks = require('./lib/networks')
mvc.Opcode = require('./lib/opcode')
mvc.PrivateKey = require('./lib/privatekey')
mvc.PublicKey = require('./lib/publickey')
mvc.Script = require('./lib/script')
mvc.Transaction = require('./lib/transaction')

// dependencies, subject to change
mvc.deps = {}
mvc.deps.bnjs = require('bn.js')
mvc.deps.bs58 = require('bs58')
mvc.deps.Buffer = Buffer
mvc.deps.elliptic = require('elliptic')
mvc.deps._ = require('./lib/util/_')

// Internal usage, exposed for testing/advanced tweaking
mvc.Transaction.sighash = require('./lib/transaction/sighash')
