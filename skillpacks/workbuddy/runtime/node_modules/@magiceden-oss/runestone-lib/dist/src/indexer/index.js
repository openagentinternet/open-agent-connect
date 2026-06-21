"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RunestoneIndexer = exports.RuneUpdater = void 0;
const network_1 = require("../network");
const updater_1 = require("./updater");
const integer_1 = require("../integer");
__exportStar(require("./types"), exports);
var updater_2 = require("./updater");
Object.defineProperty(exports, "RuneUpdater", { enumerable: true, get: function () { return updater_2.RuneUpdater; } });
class RunestoneIndexer {
    constructor(options) {
        this._started = false;
        this._updateInProgress = false;
        this._rpc = options.bitcoinRpcClient;
        this._storage = options.storage;
        this._network = options.network;
    }
    async start() {
        if (this._started) {
            return;
        }
        await this._storage.connect();
        this._started = true;
        if (this._network === network_1.Network.MAINNET) {
            this._storage.seedEtchings([
                {
                    runeTicker: 'UNCOMMONGOODS',
                    runeName: 'UNCOMMON•GOODS',
                    runeId: { block: 1, tx: 0 },
                    txid: '0000000000000000000000000000000000000000000000000000000000000000',
                    valid: true,
                    symbol: '⧉',
                    terms: { amount: 1n, cap: integer_1.u128.MAX, height: { start: 840000n, end: 1050000n } },
                },
            ]);
        }
    }
    async stop() {
        if (!this._started) {
            return;
        }
        await this._storage.disconnect();
        this._started = false;
    }
    async updateRuneUtxoBalances() {
        if (!this._started) {
            throw new Error('Runestone indexer is not started');
        }
        if (this._updateInProgress) {
            return;
        }
        this._updateInProgress = true;
        try {
            await this.updateRuneUtxoBalancesImpl();
        }
        finally {
            this._updateInProgress = false;
        }
    }
    async updateRuneUtxoBalancesImpl() {
        const currentStorageBlock = await this._storage.getCurrentBlock();
        if (currentStorageBlock) {
            // walk down until matching hash is found
            const reorgBlockhashesToIndex = [];
            let blockheight = currentStorageBlock.height;
            let blockhash = (await this._rpc.getblockhash({ height: blockheight })).result;
            let storageBlockHash = currentStorageBlock.hash;
            while (storageBlockHash !== blockhash) {
                if (blockhash) {
                    reorgBlockhashesToIndex.push(blockhash);
                }
                blockheight--;
                blockhash = (await this._rpc.getblockhash({ height: blockheight })).result;
                storageBlockHash = await this._storage.getBlockhash(blockheight);
            }
            reorgBlockhashesToIndex.reverse();
            // process blocks that are reorgs
            for (const blockhash of reorgBlockhashesToIndex) {
                const blockResult = await this._rpc.getblock({ blockhash, verbosity: 2 });
                if (blockResult.error !== null) {
                    throw blockResult.error;
                }
                const block = blockResult.result;
                const runeUpdater = new updater_1.RuneUpdater(this._network, block, true, this._storage, this._rpc);
                for (const [txIndex, tx] of block.tx.entries()) {
                    await runeUpdater.indexRunes(tx, txIndex);
                }
                await this._storage.saveBlockIndex(runeUpdater);
            }
        }
        // start from first rune height or next block height, whichever is greater
        let blockheight = Math.max(network_1.Network.getFirstRuneHeight(this._network), currentStorageBlock ? currentStorageBlock.height + 1 : 0);
        let blockhash = (await this._rpc.getblockhash({ height: blockheight })).result;
        while (blockhash !== null) {
            const blockResult = await this._rpc.getblock({ blockhash, verbosity: 2 });
            if (blockResult.error !== null) {
                throw blockResult.error;
            }
            const block = blockResult.result;
            const runeUpdater = new updater_1.RuneUpdater(this._network, block, false, this._storage, this._rpc);
            for (const [txIndex, tx] of block.tx.entries()) {
                await runeUpdater.indexRunes(tx, txIndex);
            }
            await this._storage.saveBlockIndex(runeUpdater);
            blockheight++;
            blockhash = (await this._rpc.getblockhash({ height: blockheight })).result;
        }
    }
}
exports.RunestoneIndexer = RunestoneIndexer;
//# sourceMappingURL=index.js.map