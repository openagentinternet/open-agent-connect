import http from 'node:http';
import type { MetabotDaemonHttpHandlers } from './routes/types';
export declare function createHttpServer(handlers?: MetabotDaemonHttpHandlers): http.Server;
