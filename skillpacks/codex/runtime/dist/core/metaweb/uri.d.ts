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
/**
 * Build the Bot Browser URI for one on-chain pin, protocol-aware. `path` (the
 * full on-chain path, e.g. '/protocols/metaapp') wins over the protocol key;
 * anything unrecognized falls back to the universal pin:// scheme.
 */
export declare function buildPinBrowserUri(input: {
    pinId: string;
    path?: string;
    protocol?: string;
}): string;
/** MetaWeb URI for a search result: prefer the latest version of the pin chain. */
export declare function buildSearchItemBrowserUri(item: {
    pinId: string;
    currentPinId?: string;
    path?: string;
    protocol?: string;
}): string;
/** metaid:// URI for an identity (globalMetaId); '' when the identity is empty. */
export declare function buildMetaIdBrowserUri(globalMetaId: string): string;
/** Markdown link whose destination is the URI itself — the self-labeled form bots should quote. */
export declare function markdownSelfLink(uri: string): string;
/**
 * Shared citation rule appended to tool outputs that name on-chain pins.
 * Wording mirrors the system-prompt worldview rule so the model sees one
 * consistent contract from both surfaces.
 */
export declare const METAWEB_CITATION_RULE = "When you cite this on-chain content in your reply, keep it as a clickable MetaWeb URI markdown link with the scheme shown above (pin:// / metaapp:// / metafile:// for pins, metaid:// for people). NEVER construct Web2 viewer URLs (metaid.io, openagentinternet.org, \u2026) for on-chain content \u2014 the user's app opens MetaWeb URIs directly in its built-in Bot Browser.";
/**
 * Standing full-form rule for MetaWeb URIs, injected into every bot-facing
 * prompt layer (group-task seats, private-chat replies, host `oac-*`
 * sessions). A truncated URI is useless — not clickable, not copyable — and
 * it breaks host tooling that matches identifiers exactly (the deliverable
 * ledger, dependency waits, on-chain verification). IDBots parity:
 * libs/chainIdentifierPrompt.ts CHAIN_IDENTIFIER_VERBATIM_RULE + the
 * metaweb-worldview full-form sentence.
 */
export declare const METAWEB_URI_FULL_FORM_RULE = "MetaWeb URIs are ALWAYS written in FULL \u2014 never abbreviated, truncated, or shortened with an ellipsis (`pin://37da9088\u2026` is broken output). This covers the five MetaWeb schemes \u2014 `metaid://`, `pin://` (alias `pinid://`), `metafile://`, `metaapp://`, `map://` \u2014 whether the URI stands alone or sits inside a markdown link, link text included. The pinId part is exactly 64 lowercase hex chars + `i0` (66 chars total); copy it VERBATIM from the source. For a short readable mention, add a label AROUND the full URI (e.g. `(pin 37da9088)` after the full link) \u2014 never instead of it.";
