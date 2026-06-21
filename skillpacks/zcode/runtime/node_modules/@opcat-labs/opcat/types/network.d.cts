export = Network;
/**
 * A network is merely a map containing values that correspond to version
 * numbers for each bitcoin network. Currently only supporting "livenet"
 * (a.k.a. "mainnet"), "testnet", "regtest".
 * @constructor
 */
declare function Network(): void;
declare class Network {
    toString(): any;
}
