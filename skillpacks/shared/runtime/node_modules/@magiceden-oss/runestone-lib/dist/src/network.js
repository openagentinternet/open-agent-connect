"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Network = void 0;
const constants_1 = require("./constants");
var Network;
(function (Network) {
    Network[Network["MAINNET"] = 0] = "MAINNET";
    Network[Network["SIGNET"] = 1] = "SIGNET";
    Network[Network["TESTNET"] = 2] = "TESTNET";
    Network[Network["REGTEST"] = 3] = "REGTEST";
})(Network || (exports.Network = Network = {}));
(function (Network) {
    function getFirstRuneHeight(chain) {
        switch (chain) {
            case Network.MAINNET:
                return constants_1.SUBSIDY_HALVING_INTERVAL * 4;
            case Network.REGTEST:
                return constants_1.SUBSIDY_HALVING_INTERVAL * 0;
            case Network.SIGNET:
                return constants_1.SUBSIDY_HALVING_INTERVAL * 0;
            case Network.TESTNET:
                return constants_1.SUBSIDY_HALVING_INTERVAL * 12;
        }
    }
    Network.getFirstRuneHeight = getFirstRuneHeight;
})(Network || (exports.Network = Network = {}));
//# sourceMappingURL=network.js.map