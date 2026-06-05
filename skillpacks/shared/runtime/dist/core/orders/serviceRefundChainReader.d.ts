import { type ParsedServiceRefundFinalize, type ParsedServiceRefundRequest } from './serviceRefundProtocol';
export interface RefundChainListOptions {
    pageSize?: number;
    maxPages?: number;
    buyerGlobalMetaId?: string;
    sellerGlobalMetaId?: string;
    sinceMs?: number;
}
export interface ServiceRefundChainReaderDeps {
    chainApiBaseUrl?: string;
    fetchImpl?: typeof fetch;
    pageSize?: number;
    maxPages?: number;
}
export interface ServiceRefundChainReader {
    listRefundRequests(options: RefundChainListOptions): Promise<ParsedServiceRefundRequest[]>;
    listRefundFinalizations(options: RefundChainListOptions): Promise<ParsedServiceRefundFinalize[]>;
}
export declare function createServiceRefundChainReader(deps: ServiceRefundChainReaderDeps): ServiceRefundChainReader;
