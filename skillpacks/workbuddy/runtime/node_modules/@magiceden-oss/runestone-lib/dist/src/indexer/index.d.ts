import { RunestoneIndexerOptions } from './types';
export * from './types';
export { RuneUpdater } from './updater';
export declare class RunestoneIndexer {
    private readonly _storage;
    private readonly _rpc;
    private readonly _network;
    private _started;
    private _updateInProgress;
    constructor(options: RunestoneIndexerOptions);
    start(): Promise<void>;
    stop(): Promise<void>;
    updateRuneUtxoBalances(): Promise<void>;
    private updateRuneUtxoBalancesImpl;
}
//# sourceMappingURL=index.d.ts.map