"use strict";
/**
 * MetaWeb (Agent Internet) URI assembly for bot-facing tool output.
 * OAC port of the IDBots metawebUri lib.
 *
 * The Bot Browser opens on-chain content through native URI schemes —
 * metaid://, metaapp://, metafile://, pin:// — never through Web2 viewer URLs
 * (metaid.io, openagentinternet.org). Every tool result that names an on-chain
 * pin should embed a ready-to-quote markdown link built here, so the model
 * relays a clickable MetaWeb URI instead of inventing a Web2 URL.
 *
 * Scheme choice (map:// intentionally excluded for now):
 * - metaid://<globalMetaId>   — a person/bot identity (idq1…)
 * - metaapp://<pinId>         — pin on /protocols/metaapp (on-chain app)
 * - metafile://<pinId>        — pin on /file (binary: image/video/archive…)
 * - pin://<pinId>             — any other pin; the universal fallback
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.METAWEB_CITATION_RULE = void 0;
exports.buildPinBrowserUri = buildPinBrowserUri;
exports.buildSearchItemBrowserUri = buildSearchItemBrowserUri;
exports.buildMetaIdBrowserUri = buildMetaIdBrowserUri;
exports.markdownSelfLink = markdownSelfLink;
const METAAPP_PATH = '/protocols/metaapp';
const METAFILE_PATH = '/file';
/** Lowercased pinId with surrounding whitespace stripped; '' when not string-shaped. */
function normalizePinId(pinId) {
    return typeof pinId === 'string' ? pinId.trim().toLowerCase() : '';
}
/**
 * Build the Bot Browser URI for one on-chain pin, protocol-aware. `path` (the
 * full on-chain path, e.g. '/protocols/metaapp') wins over the protocol key;
 * anything unrecognized falls back to the universal pin:// scheme.
 */
function buildPinBrowserUri(input) {
    const pinId = normalizePinId(input?.pinId ?? '');
    if (!pinId)
        return '';
    const path = typeof input?.path === 'string' ? input.path.trim().toLowerCase() : '';
    const protocol = typeof input?.protocol === 'string' ? input.protocol.trim().toLowerCase() : '';
    if (path === METAAPP_PATH || protocol === 'metaapp')
        return `metaapp://${pinId}`;
    if (path === METAFILE_PATH || protocol === 'file')
        return `metafile://${pinId}`;
    return `pin://${pinId}`;
}
/** MetaWeb URI for a search result: prefer the latest version of the pin chain. */
function buildSearchItemBrowserUri(item) {
    return buildPinBrowserUri({
        pinId: item?.currentPinId || item?.pinId,
        path: item?.path,
        protocol: item?.protocol,
    });
}
/** metaid:// URI for an identity (globalMetaId); '' when the identity is empty. */
function buildMetaIdBrowserUri(globalMetaId) {
    const normalized = typeof globalMetaId === 'string' ? globalMetaId.trim().toLowerCase() : '';
    return normalized ? `metaid://${normalized}` : '';
}
/** Markdown link whose destination is the URI itself — the self-labeled form bots should quote. */
function markdownSelfLink(uri) {
    return uri ? `[${uri}](${uri})` : '';
}
/**
 * Shared citation rule appended to tool outputs that name on-chain pins.
 * Wording mirrors the system-prompt worldview rule so the model sees one
 * consistent contract from both surfaces.
 */
exports.METAWEB_CITATION_RULE = 'When you cite this on-chain content in your reply, keep it as a clickable MetaWeb URI markdown link with the scheme shown above (pin:// / metaapp:// / metafile:// for pins, metaid:// for people). NEVER construct Web2 viewer URLs (metaid.io, openagentinternet.org, …) for on-chain content — the user\'s app opens MetaWeb URIs directly in its built-in Bot Browser.';
