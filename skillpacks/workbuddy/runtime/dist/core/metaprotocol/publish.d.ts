/**
 * Metaprotocol registry writes (docs/metaid_protocols/metaprotocol-registry-
 * agent-tools.md §2/§5): publish a NEW protocol under /protocols/<name> or
 * update an existing one with a new version. OAC port of the IDBots
 * feat/metaprotocol-registry-tools writer.
 *
 * Pins are isomorphic with the human protocol square (MetaWeb.world /
 * MetaProtocolSquare MetaApp): same 7-tuple, same body fields, same JSON5
 * serialization — registrations published by humans and Agents are mutually
 * visible and editable. The MetaID 7-tuple `version` field carries
 * protocol-level semantics: `1.0.0` for the outer create pin, and for modify
 * pins the body version of the version being replaced; the payload's own
 * `version` field is the human-readable protocol version (auto-increment on
 * update when omitted).
 *
 * Gates run BEFORE anything reaches the wallet: draft-07 schema validation
 * (schema.ts), MetaSo precheck (path occupancy for publish, record resolution
 * + registrant identity cascade for update) with the read-only MANAPI
 * degraded scan, and a hard refusal when both indexes are unreachable.
 */
import type { Signer } from '../signing/signer';
import { type MetaProtocolRecord, type MetaProtocolServiceOptions } from './registry';
export declare const PIN_ID_PATTERN: RegExp;
export type MetaprotocolNetwork = 'mvc' | 'doge' | 'btc';
export type MetaprotocolActingIdentity = {
    name: string;
    globalMetaId: string;
    metaId: string;
    address: string;
};
export type MetaprotocolPublishInput = {
    title: string;
    protocolName: string;
    intro?: string;
    /** publish: defaults to '1.0.0'; update: auto-increments from the on-chain version when omitted. */
    version?: string;
    protocolContentType?: string;
    /** Field definitions: plain values or {value, description} objects (serialized to annotated JSON5). Mutually exclusive with protocolContent. */
    body?: Record<string, unknown>;
    /** Raw JSON5 protocol definition text. Mutually exclusive with body. */
    protocolContent?: string;
    /** Free-form metadata: an object, or a string that is JSON.parse-ed when possible (default empty). */
    metadata?: unknown;
    /** Attachment URIs (metafile:// or metacode:// references). */
    attachments?: string[];
    network?: MetaprotocolNetwork;
};
export type MetaprotocolPublishResult = {
    pinId: string;
    txids: string[];
    totalCost: number;
    network: string;
    action: 'publish' | 'update';
    protocolPath: string;
    version: string;
    title: string;
};
export declare function serializeMetaprotocolBody(body: Record<string, unknown>): string;
/**
 * Version auto-increment (human protocol square rule): patch+1; patch ≥ 10
 * rolls to 0 and bumps minor; minor ≥ 10 rolls to 0 and bumps major
 * (1.0.9 → 1.1.0, 1.9.9 → 2.0.0). Exposed for tests.
 */
export declare function incrementMetaprotocolVersion(version: string): string;
/**
 * Registrant identity check (spec §0.3): compare the highest identity layer
 * where BOTH sides have a non-empty value — globalMetaId → metaId → address.
 */
export declare function isSameRegistrant(author: {
    globalMetaId: string;
    metaid: string;
    address: string;
}, identity: MetaprotocolActingIdentity): boolean;
/** Body/protocolContent mutual-exclusion check shared by the CLI, daemon and tool layers. */
export declare function checkMetaprotocolContentInput(input: {
    body?: unknown;
    protocolContent?: unknown;
}): string | null;
/**
 * Build the §5.3 on-chain body JSON (isomorphic with the human protocol
 * square). `record` is the resolved target for update (keeps the registered
 * path); null for publish (derives the path from protocolName). Returns the
 * payload object plus the replaced version (update outer 7-tuple version).
 * Exposed for tests.
 */
export declare function buildMetaprotocolPayload(input: {
    action: 'publish' | 'update';
    request: MetaprotocolPublishInput;
    identity: MetaprotocolActingIdentity;
    /** Resolved target record for update; null for publish. */
    record: MetaProtocolRecord | null;
}): {
    payload: Record<string, unknown>;
    protocolContent: string;
    replacedVersion: string;
    nextVersion: string;
};
/** §5.4 step 2 — draft-07 schema gate; invalid payloads never reach the wallet. */
export declare function validateMetaprotocolPayload(payload: Record<string, unknown>): string | null;
/**
 * §5.4 update step 3 — resolve the update target (protocolPath most precise,
 * pinId, else exact display-name match) to its authoritative record. Throws
 * MetaprotocolResolveError with user-facing text.
 */
export declare function resolveMetaprotocolUpdateTarget(target: string, options?: MetaProtocolServiceOptions): Promise<MetaProtocolRecord>;
/**
 * §5.4 publish step 3-4 — path occupancy. Returns the conflict error text,
 * the both-down refusal text, or null when the path is free. Never throws.
 */
export declare function findMetaprotocolPublishConflict(protocolPath: string, options?: MetaProtocolServiceOptions): Promise<string | null>;
/**
 * §5.4 step 5 — the chain write itself. Publish creates on
 * /protocols/metaprotocol; update modifies @<source pinId> with the outer
 * 7-tuple version of the version being replaced. Callers must have run the
 * schema gate and the MetaSo precheck gates first.
 */
export declare function writeMetaprotocolPin(signer: Signer, input: {
    action: 'publish' | 'update';
    payload: Record<string, unknown>;
    /** Resolved target record for update (source pinId + replaced version); null for publish. */
    record: MetaProtocolRecord | null;
    replacedVersion: string;
    network: MetaprotocolNetwork;
}): Promise<MetaprotocolPublishResult>;
/**
 * Human-readable success sheet for post_metaprotocol (§5.4 receipt). Exposed
 * for tests.
 */
export declare function formatMetaprotocolResult(input: {
    action: 'publish' | 'update';
    pinId: string;
    txids: string[];
    totalCost: number;
    protocolPath: string;
    version: string;
    title: string;
}): string;
