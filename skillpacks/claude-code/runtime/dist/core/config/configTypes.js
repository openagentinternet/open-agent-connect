"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_WRITE_NETWORKS = void 0;
exports.isDefaultWriteNetwork = isDefaultWriteNetwork;
exports.createDefaultConfig = createDefaultConfig;
exports.DEFAULT_WRITE_NETWORKS = ['mvc', 'btc', 'doge', 'opcat'];
function isDefaultWriteNetwork(value) {
    return typeof value === 'string' && exports.DEFAULT_WRITE_NETWORKS.includes(value);
}
function createDefaultConfig() {
    return {
        chain: {
            defaultWriteNetwork: 'mvc',
        },
        a2a: {
            simplemsgListenerEnabled: true,
        },
    };
}
