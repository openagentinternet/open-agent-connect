/**
 * Read-side renderers for the metaprotocol registry (list / read / versions,
 * plus the degraded MANAPI fallback views). Shared by the CLI's `formatted`
 * output block and the DSH metaprotocol_registry tool, mirroring the role of
 * src/core/qanda/format.ts. OAC port of the IDBots feat/metaprotocol-
 * registry-tools renderers.
 */
import type { MetaProtocolListPage, MetaProtocolManapiRegistration, MetaProtocolManapiVersion, MetaProtocolPinVersions, MetaProtocolRecord } from './registry';
/** Surrogate-safe truncation: never split a surrogate pair, mark with an ellipsis. */
export declare function truncateMetaprotocolText(value: string, max: number): string;
/** On-chain fields are arbitrary third-party text: flatten whitespace so a crafted \n cannot forge fake result lines. */
export declare function flattenInline(value: string): string;
/** UTC YYYY-MM-DD from unix seconds; '' when unknown. */
export declare function formatMetaprotocolDate(ts: number): string;
export declare function metaprotocolAuthorLabel(author: {
    name: string;
    globalMetaId: string;
    metaid: string;
    address: string;
}): string;
export declare function renderMetaprotocolList(page: MetaProtocolListPage): string;
export declare function renderMetaprotocolRead(record: MetaProtocolRecord): string;
export declare function renderMetaprotocolPinVersions(versions: MetaProtocolPinVersions, label: string): string;
export declare function renderMetaprotocolFallbackList(registrations: MetaProtocolManapiRegistration[], query: string): string;
export declare function renderMetaprotocolFallbackRead(entry: MetaProtocolManapiRegistration): string;
export declare function renderMetaprotocolFallbackVersions(versions: MetaProtocolManapiVersion[], label: string): string;
