/**
 * A network is merely a map containing values that correspond to version
 * numbers for each bitcoin network. Currently only supporting "livenet"
 * (a.k.a. "mainnet"), "testnet", "regtest".
 * @constructor
 */
function Network() { }

Network.prototype.toString = function toString() {
    return this.name;
};

export default Network;