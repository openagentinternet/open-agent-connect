"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PIN_ID_PATTERN = void 0;
exports.serializeMetaprotocolBody = serializeMetaprotocolBody;
exports.incrementMetaprotocolVersion = incrementMetaprotocolVersion;
exports.isSameRegistrant = isSameRegistrant;
exports.checkMetaprotocolContentInput = checkMetaprotocolContentInput;
exports.buildMetaprotocolPayload = buildMetaprotocolPayload;
exports.validateMetaprotocolPayload = validateMetaprotocolPayload;
exports.resolveMetaprotocolUpdateTarget = resolveMetaprotocolUpdateTarget;
exports.findMetaprotocolPublishConflict = findMetaprotocolPublishConflict;
exports.writeMetaprotocolPin = writeMetaprotocolPin;
exports.formatMetaprotocolResult = formatMetaprotocolResult;
const uri_1 = require("../metaweb/uri");
const registry_1 = require("./registry");
const schema_1 = require("./schema");
exports.PIN_ID_PATTERN = /^[0-9a-f]{64}i\d+$/i;
function asString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
/**
 * body → JSON5 protocolContent (human protocol square semantics): each body
 * field shaped `{value, description}` becomes a doc-comment line
 * (`/** description …`, one leading space, matching the on-chain convention)
 * followed by the unwrapped value; plain values serialize directly; nested
 * objects/arrays use 2-space-per-level multiline JSON. Exposed for tests.
 */
function isDescribedValue(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return false;
    const record = value;
    return 'value' in record && typeof record.description === 'string';
}
function serializeJson5Plain(value, indent) {
    // On-chain convention (human protocol square): content lines sit on a
    // 1-space base indent, each deeper nesting level adds 2 spaces.
    const pad = ` ${'  '.repeat(indent)}`;
    const childPad = ` ${'  '.repeat(indent + 1)}`;
    if (Array.isArray(value)) {
        if (value.length === 0)
            return '[]';
        const items = value.map((item) => `${childPad}${serializeJson5Plain(item, indent + 1)}`);
        return `[\n${items.join(',\n')}\n${pad}]`;
    }
    if (value !== null && typeof value === 'object') {
        const entries = Object.entries(value);
        if (entries.length === 0)
            return '{}';
        const lines = entries.map(([key, item]) => `${childPad}${JSON.stringify(key)}: ${serializeJson5Plain(item, indent + 1)}`);
        return `{\n${lines.join(',\n')}\n${pad}}`;
    }
    return JSON.stringify(value) ?? 'null';
}
function serializeMetaprotocolBody(body) {
    const entries = Object.entries(body ?? {});
    if (entries.length === 0)
        return '{}';
    const pad = ' ';
    const lines = entries.map(([key, value]) => {
        if (isDescribedValue(value)) {
            return `${pad}/** ${value.description} */\n${pad}${JSON.stringify(key)}: ${serializeJson5Plain(value.value, 0)}`;
        }
        return `${pad}${JSON.stringify(key)}: ${serializeJson5Plain(value, 0)}`;
    });
    return `{\n${lines.join(',\n')}\n}`;
}
/**
 * Version auto-increment (human protocol square rule): patch+1; patch ≥ 10
 * rolls to 0 and bumps minor; minor ≥ 10 rolls to 0 and bumps major
 * (1.0.9 → 1.1.0, 1.9.9 → 2.0.0). Exposed for tests.
 */
function incrementMetaprotocolVersion(version) {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
    if (!match)
        return version;
    let major = Number(match[1]);
    let minor = Number(match[2]);
    let patch = Number(match[3]);
    patch += 1;
    if (patch >= 10) {
        patch = 0;
        minor += 1;
    }
    if (minor >= 10) {
        minor = 0;
        major += 1;
    }
    return `${major}.${minor}.${patch}`;
}
/**
 * Registrant identity check (spec §0.3): compare the highest identity layer
 * where BOTH sides have a non-empty value — globalMetaId → metaId → address.
 */
function isSameRegistrant(author, identity) {
    const botGlobal = identity.globalMetaId.trim().toLowerCase();
    const authorGlobal = author.globalMetaId.trim().toLowerCase();
    if (botGlobal && authorGlobal)
        return botGlobal === authorGlobal;
    const botMetaId = identity.metaId.trim().toLowerCase();
    const authorMetaId = author.metaid.trim().toLowerCase();
    if (botMetaId && authorMetaId)
        return botMetaId === authorMetaId;
    const botAddress = identity.address.trim().toLowerCase();
    const authorAddress = author.address.trim().toLowerCase();
    if (botAddress && authorAddress)
        return botAddress === authorAddress;
    return false;
}
/** Body/protocolContent mutual-exclusion check shared by the CLI, daemon and tool layers. */
function checkMetaprotocolContentInput(input) {
    const hasBody = input.body != null && typeof input.body === 'object';
    const rawContent = asString(input.protocolContent);
    if (hasBody === Boolean(rawContent)) {
        return 'post_metaprotocol: pass exactly one of body (field definitions) or protocolContent (raw JSON5 text).';
    }
    return null;
}
/** Free-form metadata normalization: strings are JSON.parse-ed when possible (default ''). */
function normalizeMetadata(value) {
    if (value === undefined)
        return '';
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        }
        catch {
            return value;
        }
    }
    return value;
}
/**
 * Build the §5.3 on-chain body JSON (isomorphic with the human protocol
 * square). `record` is the resolved target for update (keeps the registered
 * path); null for publish (derives the path from protocolName). Returns the
 * payload object plus the replaced version (update outer 7-tuple version).
 * Exposed for tests.
 */
function buildMetaprotocolPayload(input) {
    const { action, request, identity, record } = input;
    const protocolName = asString(request.protocolName);
    const protocolContent = request.body != null && typeof request.body === 'object'
        ? serializeMetaprotocolBody(request.body)
        : asString(request.protocolContent);
    const replacedVersion = record ? record.payload.version || record.version : '';
    const nextVersion = action === 'publish'
        ? asString(request.version) || '1.0.0'
        : asString(request.version) || (replacedVersion ? incrementMetaprotocolVersion(replacedVersion) : '');
    const payload = {
        title: asString(request.title),
        // publish derives the path from protocolName; update keeps the
        // registered path the modify pin points at.
        path: record ? record.protocolPath : `/protocols/${protocolName.toLowerCase()}`,
        version: nextVersion,
        authors: identity.name.trim() || identity.metaId.trim().slice(0, 6) || '',
        intro: asString(request.intro),
        protocolName,
        protocolAttachments: Array.isArray(request.attachments)
            ? request.attachments.map((item) => asString(item)).filter(Boolean)
            : [],
        metadata: normalizeMetadata(request.metadata),
        protocolContent,
        protocolContentType: asString(request.protocolContentType) || 'application/json',
    };
    return { payload, protocolContent, replacedVersion, nextVersion };
}
/** §5.4 step 2 — draft-07 schema gate; invalid payloads never reach the wallet. */
function validateMetaprotocolPayload(payload) {
    const validation = (0, schema_1.validateAgainstSchema)(payload, schema_1.METAPROTOCOL_PIN_SCHEMA);
    if (validation.ok)
        return null;
    const detail = validation.errors.map((issue) => `${issue.path || '(root)'}: ${issue.message}`).join('; ');
    return `Invalid protocol payload: ${detail}. Fix the fields and retry.`;
}
/**
 * §5.4 update step 3 — resolve the update target (protocolPath most precise,
 * pinId, else exact display-name match) to its authoritative record. Throws
 * MetaprotocolResolveError with user-facing text.
 */
async function resolveMetaprotocolUpdateTarget(target, options) {
    const notRegistered = `Protocol ${target} is not registered yet. Use action "publish" instead.`;
    try {
        if (target.startsWith('/')) {
            const detail = await (0, registry_1.getMetaProtocolDetail)({ path: target }, options);
            if (!detail.record.protocolPath)
                throw new registry_1.MetaprotocolResolveError(notRegistered);
            return detail.record;
        }
        if (exports.PIN_ID_PATTERN.test(target)) {
            const detail = await (0, registry_1.getMetaProtocolDetail)({ pinId: target }, options);
            if (!detail.record.protocolPath)
                throw new registry_1.MetaprotocolResolveError(notRegistered);
            return detail.record;
        }
        const page = await (0, registry_1.listMetaProtocols)({ query: target, size: 50 }, options);
        const matches = page.items.filter((item) => item.protocolName.toLowerCase() === target.toLowerCase());
        if (matches.length === 0)
            throw new registry_1.MetaprotocolResolveError(notRegistered);
        if (matches.length > 1) {
            throw new registry_1.MetaprotocolResolveError(`Multiple protocols are registered under the name "${target}": ${matches.map((item) => item.protocolPath).join(', ')}. Resolve with the protocolPath (most precise).`);
        }
        const detail = await (0, registry_1.getMetaProtocolDetail)({ path: matches[0].protocolPath }, options);
        if (!detail.record.protocolPath)
            throw new registry_1.MetaprotocolResolveError(notRegistered);
        return detail.record;
    }
    catch (error) {
        if (error instanceof registry_1.MetaprotocolResolveError)
            throw error;
        if ((0, registry_1.isMetaprotocolNotFoundError)(error))
            throw new registry_1.MetaprotocolResolveError(notRegistered);
        throw new registry_1.MetaprotocolResolveError(`Protocol registry lookup failed for "${target}": ${error instanceof Error ? error.message : String(error)}. Try again later.`);
    }
}
function authorLabel(author) {
    return author.name || author.globalMetaId || author.metaid || author.address || 'unknown';
}
function formatDate(ts) {
    return ts > 0 ? new Date(ts * 1000).toISOString().slice(0, 10) : '';
}
/**
 * §5.4 publish step 3-4 — path occupancy. Returns the conflict error text,
 * the both-down refusal text, or null when the path is free. Never throws.
 */
async function findMetaprotocolPublishConflict(protocolPath, options) {
    let existing = null;
    try {
        const check = await (0, registry_1.checkMetaProtocolPath)(protocolPath, options);
        existing = check.available ? null : check.existing;
    }
    catch {
        // MetaSo down — degrade to the MANAPI scan before deciding.
        let registrations;
        try {
            registrations = await (0, registry_1.listMetaProtocolRegistrationsViaManapi)(options);
        }
        catch {
            return 'Protocol registry check is unavailable (registry and fallback both failed). Refusing to publish to avoid duplicate registration — try again later.';
        }
        const hit = registrations.find((entry) => entry.payload &&
            typeof entry.payload.path === 'string' &&
            entry.payload.path.toLowerCase() === protocolPath.toLowerCase());
        if (hit) {
            existing = {
                pinId: hit.pinId,
                currentPinId: hit.pinId,
                title: hit.payload && typeof hit.payload.title === 'string' ? hit.payload.title : '',
                protocolName: hit.payload && typeof hit.payload.protocolName === 'string' ? hit.payload.protocolName : '',
                version: hit.payload && typeof hit.payload.version === 'string' ? hit.payload.version : hit.version,
                createdAt: hit.timestamp,
                confirmed: true,
                author: { address: hit.address, metaid: hit.metaid, globalMetaId: hit.globalMetaId, name: '' },
            };
        }
    }
    if (!existing)
        return null;
    const name = authorLabel(existing.author);
    const date = formatDate(existing.createdAt) || 'unknown';
    return `Protocol path ${protocolPath} is already registered by ${name} (first registered ${date}, current version ${existing.version}, pin://${existing.pinId}). Choose a different protocolName or path.`;
}
/**
 * §5.4 step 5 — the chain write itself. Publish creates on
 * /protocols/metaprotocol; update modifies @<source pinId> with the outer
 * 7-tuple version of the version being replaced. Callers must have run the
 * schema gate and the MetaSo precheck gates first.
 */
async function writeMetaprotocolPin(signer, input) {
    const chainWrite = await signer.writePin({
        operation: input.action === 'publish' ? 'create' : 'modify',
        path: input.action === 'publish' ? registry_1.METAPROTOCOL_REGISTRY_PATH : `@${input.record.pinId}`,
        contentType: 'application/json',
        encoding: 'utf-8',
        encryption: '0',
        version: input.action === 'publish' ? '1.0.0' : input.replacedVersion,
        payload: JSON.stringify(input.payload),
        network: input.network,
    });
    return {
        pinId: chainWrite.pinId,
        txids: Array.isArray(chainWrite.txids) ? chainWrite.txids : [],
        totalCost: chainWrite.totalCost,
        network: chainWrite.network,
        action: input.action,
        protocolPath: asString(input.payload.path),
        version: asString(input.payload.version),
        title: asString(input.payload.title),
    };
}
/**
 * Human-readable success sheet for post_metaprotocol (§5.4 receipt). Exposed
 * for tests.
 */
function formatMetaprotocolResult(input) {
    const verb = input.action === 'publish' ? 'published' : 'updated';
    const lines = [
        `Protocol ${verb} on-chain: ${input.protocolPath} v${input.version || '?'} ("${input.title}").`,
    ];
    if (input.pinId)
        lines.push(`- protocol pinId: ${input.pinId}`);
    if (input.txids.length)
        lines.push(`- txids: ${input.txids.join(', ')}`);
    lines.push(`- cost: ${input.totalCost} sats`);
    if (input.pinId) {
        lines.push(`- view link: ${(0, uri_1.markdownSelfLink)(`pin://${input.pinId}`)}`);
    }
    lines.push('The indexer may take ~1 minute to confirm; verify with metaprotocol_registry (action "read") or `metabot protocol read`.');
    return lines.join('\n');
}
