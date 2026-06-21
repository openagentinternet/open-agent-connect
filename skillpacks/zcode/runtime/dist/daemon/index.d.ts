import { type MetabotPaths } from '../core/state/paths';
import type { MetabotDaemonHttpHandlers } from './routes/types';
export interface MetabotDaemonAddress {
    host: string;
    port: number;
    baseUrl: string;
}
export interface MetabotDaemonInstance {
    ownerId: string;
    lockPath: string;
    start(port?: number, host?: string): Promise<MetabotDaemonAddress>;
    close(): Promise<void>;
}
export interface CreateMetabotDaemonOptions {
    homeDirOrPaths: string | MetabotPaths;
    handlers?: MetabotDaemonHttpHandlers;
    ownerId?: string;
}
export declare function createMetabotDaemon(options: CreateMetabotDaemonOptions): MetabotDaemonInstance;
