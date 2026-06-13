import http from 'node:http';
import { type CreateStandaloneBrowserHostAdapterInput, type StandaloneBrowserHostAdapter } from './adapter';
export interface CreateStandaloneBrowserServerInput extends CreateStandaloneBrowserHostAdapterInput {
    adapter?: StandaloneBrowserHostAdapter;
}
export declare function createStandaloneBrowserServer(input?: CreateStandaloneBrowserServerInput): http.Server;
