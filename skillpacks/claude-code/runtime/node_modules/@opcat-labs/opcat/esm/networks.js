import _ from './util/_.js';
import JSUtil from './util/js.js';
import Network from './network.js';
var networks = [];
var networkMaps = {};

/**
 * A tool class for managing all supported networks
 * @constructor
 */
var Networks = function Networks() { }

/**
 * @function
 * @member Networks#get
 * Retrieves the network associated with a magic number or string.
 * @param {string|number|Network} arg
 * @param {string|Array} keys - if set, only check if the magic number associated with this name matches
 * @return Network
 */
Networks.get = function get(arg, keys) {
  if (~networks.indexOf(arg)) {
    return arg;
  }
  if (keys) {
    if (!_.isArray(keys)) {
      keys = [keys];
    }
    for (var i = 0; i < networks.length; i++) {
      var network = networks[i];
      var filteredNet = _.pick(network, keys);
      var netValues = _.values(filteredNet);
      if (~netValues.indexOf(arg)) {
        return network;
      }
    }
    return undefined;
  }
  return networkMaps[arg];
}

/***
 * Derives an array from the given cashAddrPrefix to be used in the computation
 * of the address' checksum.
 *
 * @param {string} cashAddrPrefix Network cashAddrPrefix. E.g.: 'bitcoincash'.
 */
function cashAddrPrefixToArray(cashAddrPrefix) {
  var result = [];
  for (var i = 0; i < cashAddrPrefix.length; i++) {
    result.push(cashAddrPrefix.charCodeAt(i) & 31);
  }
  return result;
}


function indexNetworkBy(network, keys) {
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var networkValue = network[key];
    if (!_.isUndefined(networkValue) && !_.isObject(networkValue)) {
      networkMaps[networkValue] = network;
    }
  }
}

function unindexNetworkBy(network, values) {
  for (var index = 0; index < values.length; index++) {
    var value = values[index];
    if (networkMaps[value] === network) {
      delete networkMaps[value];
    }
  }
}


/**
 * @function
 * @member Networks#add
 * Will add a custom Network
 * @param {Object} data
 * @param {string} data.name - The name of the network
 * @param {string} data.alias - The aliased name of the network
 * @param {Number} data.pubkeyhash - The publickey hash cashAddrPrefix
 * @param {Number} data.privatekey - The privatekey cashAddrPrefix
 * @param {Number} data.scripthash - The scripthash cashAddrPrefix
 * @param {Number} data.xpubkey - The extended public key magic
 * @param {Number} data.xprivkey - The extended private key magic
 * @param {Number} data.networkMagic - The network magic number
 * @param {Number} data.port - The network port
 * @param {Array}  data.dnsSeeds - An array of dns seeds
 * @return Network
 */
Networks.add = function add(data) {

  var network = new Network();

  JSUtil.defineImmutable(network, {
    name: data.name,
    alias: data.alias,
    pubkeyhash: data.pubkeyhash,
    privatekey: data.privatekey,
    scripthash: data.scripthash,
    xpubkey: data.xpubkey,
    xprivkey: data.xprivkey,
  });

  var indexBy = data.indexBy || Object.keys(data);

  if (data.cashAddrPrefix) {
    _.extend(network, {
      cashAddrPrefix: data.cashAddrPrefix,
      cashAddrPrefixArray: cashAddrPrefixToArray(data.cashAddrPrefix),
    });
  }

  if (data.networkMagic) {
    _.extend(network, {
      networkMagic: JSUtil.integerAsBuffer(data.networkMagic),
    });
  }

  if (data.port) {
    _.extend(network, {
      port: data.port,
    });
  }

  if (data.dnsSeeds) {
    _.extend(network, {
      dnsSeeds: data.dnsSeeds,
    });
  }
  networks.push(network);
  indexNetworkBy(network, indexBy);
  return network;
}



/**
 * @function
 * @member Networks#remove
 * Will remove a custom network
 * @param {Network} network
 */
Networks.remove = function remove(network) {
  for (var i = 0; i < networks.length; i++) {
    if (networks[i] === network) {
      networks.splice(i, 1);
    }
  }
  unindexNetworkBy(network, Object.keys(networkMaps));
}

var networkMagic = {
  livenet: 0xe3e1f3e8,
  testnet: 0xf4e5f3f4,
  regtest: 0xdab5bffa,
};

var dnsSeeds = [''];

var TESTNET = {
  PORT: 18333,
  NETWORK_MAGIC: networkMagic.testnet,
  DNS_SEEDS: dnsSeeds,
  PREFIX: 'testnet',
  CASHADDRPREFIX: 'opcattest',
};

var REGTEST = {
  PORT: 18444,
  NETWORK_MAGIC: networkMagic.regtest,
  DNS_SEEDS: [],
  PREFIX: 'regtest',
  CASHADDRPREFIX: 'opcatreg',
};

var liveNetwork = {
  name: 'livenet',
  alias: 'mainnet',
  prefix: 'bitcoin',
  cashAddrPrefix: 'opcat',
  pubkeyhash: 0x00,
  privatekey: 0x80,
  scripthash: 0x05,
  xpubkey: 0x0488b21e,
  xprivkey: 0x0488ade4,
  networkMagic: networkMagic.livenet,
  port: 8333,
  dnsSeeds: dnsSeeds,
};

// network magic, port, cashAddrPrefix, and dnsSeeds are overloaded by enableRegtest
var testNetwork = {
  name: 'testnet',
  prefix: TESTNET.PREFIX,
  cashAddrPrefix: TESTNET.CASHADDRPREFIX,
  pubkeyhash: 0x6f,
  privatekey: 0xef,
  scripthash: 0xc4,
  xpubkey: 0x043587cf,
  xprivkey: 0x04358394,
  networkMagic: TESTNET.NETWORK_MAGIC,
};

var regtestNetwork = {
  name: 'regtest',
  prefix: REGTEST.PREFIX,
  cashAddrPrefix: REGTEST.CASHADDRPREFIX,
  pubkeyhash: 0x6f,
  privatekey: 0xef,
  scripthash: 0xc4,
  xpubkey: 0x043587cf,
  xprivkey: 0x04358394,
  networkMagic: REGTEST.NETWORK_MAGIC,
  port: REGTEST.PORT,
  dnsSeeds: [],
  indexBy: ['port', 'name', 'cashAddrPrefix', 'networkMagic'],
};


Networks.add(testNetwork);
Networks.add(regtestNetwork);
Networks.add(liveNetwork);

var livenet = Networks.get('livenet');
var regtest = Networks.get('regtest');
var testnet = Networks.get('testnet');

Networks.livenet = livenet;
Networks.regtest = regtest;
Networks.testnet = testnet;
Networks.defaultNetwork = livenet;

Object.defineProperty(Networks.testnet, 'port', {
  enumerable: true,
  configurable: false,
  get: function () {
    if (this.regtestEnabled) {
      return REGTEST.PORT;
    } else {
      return TESTNET.PORT;
    }
  },
});

Object.defineProperty(Networks.testnet, 'networkMagic', {
  enumerable: true,
  configurable: false,
  get: function () {
    if (this.regtestEnabled) {
      return JSUtil.integerAsBuffer(REGTEST.NETWORK_MAGIC);
    } else {
      return JSUtil.integerAsBuffer(TESTNET.NETWORK_MAGIC);
    }
  },
});

Object.defineProperty(Networks.testnet, 'dnsSeeds', {
  enumerable: true,
  configurable: false,
  get: function () {
    if (this.regtestEnabled) {
      return REGTEST.DNS_SEEDS;
    } else {
      return TESTNET.DNS_SEEDS;
    }
  },
});

Object.defineProperty(Networks.testnet, 'cashAddrPrefix', {
  enumerable: true,
  configurable: false,
  get: function () {
    if (this.regtestEnabled) {
      return REGTEST.CASHADDRPREFIX;
    } else {
      return TESTNET.CASHADDRPREFIX;
    }
  },
});

Object.defineProperty(Networks.testnet, 'cashAddrPrefixArray', {
  enumerable: true,
  configurable: false,
  get: function () {
    if (this.regtestEnabled) {
      return cashAddrPrefixToArray(REGTEST.CASHADDRPREFIX);
    } else {
      return cashAddrPrefixToArray(TESTNET.CASHADDRPREFIX);
    }
  },
});


/**
 * Enables regtest network mode for testing purposes.
 * @member Networks#enableRegtest
 * @function
 */
Networks.enableRegtest = function enableRegtest() {
  testnet.regtestEnabled = true;
}


/**
 * @function
 * @member Networks#disableRegtest
 * Disables the regtest network configuration.
 * This sets the `regtestEnabled` flag to false in the testnet configuration.
 */
Networks.disableRegtest = function disableRegtest() {
  testnet.regtestEnabled = false;
}



export default Networks;
