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

import { markdownSelfLink } from '../metaweb/uri';
import type { Signer } from '../signing/signer';
import {
  METAPROTOCOL_REGISTRY_PATH,
  getMetaProtocolDetail,
  isMetaprotocolNotFoundError,
  listMetaProtocols,
  listMetaProtocolRegistrationsViaManapi,
  checkMetaProtocolPath,
  MetaprotocolResolveError,
  type MetaProtocolExisting,
  type MetaProtocolRecord,
  type MetaProtocolServiceOptions,
} from './registry';
import { METAPROTOCOL_PIN_SCHEMA, validateAgainstSchema } from './schema';

export const PIN_ID_PATTERN = /^[0-9a-f]{64}i\d+$/i;

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

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * body → JSON5 protocolContent (human protocol square semantics): each body
 * field shaped `{value, description}` becomes a doc-comment line
 * (`/** description …`, one leading space, matching the on-chain convention)
 * followed by the unwrapped value; plain values serialize directly; nested
 * objects/arrays use 2-space-per-level multiline JSON. Exposed for tests.
 */
function isDescribedValue(value: unknown): value is { value: unknown; description: string } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return 'value' in record && typeof record.description === 'string';
}

function serializeJson5Plain(value: unknown, indent: number): string {
  // On-chain convention (human protocol square): content lines sit on a
  // 1-space base indent, each deeper nesting level adds 2 spaces.
  const pad = ` ${'  '.repeat(indent)}`;
  const childPad = ` ${'  '.repeat(indent + 1)}`;
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((item) => `${childPad}${serializeJson5Plain(item, indent + 1)}`);
    return `[\n${items.join(',\n')}\n${pad}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    const lines = entries.map(
      ([key, item]) => `${childPad}${JSON.stringify(key)}: ${serializeJson5Plain(item, indent + 1)}`,
    );
    return `{\n${lines.join(',\n')}\n${pad}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function serializeMetaprotocolBody(body: Record<string, unknown>): string {
  const entries = Object.entries(body ?? {});
  if (entries.length === 0) return '{}';
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
export function incrementMetaprotocolVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) return version;
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
export function isSameRegistrant(
  author: { globalMetaId: string; metaid: string; address: string },
  identity: MetaprotocolActingIdentity,
): boolean {
  const botGlobal = identity.globalMetaId.trim().toLowerCase();
  const authorGlobal = author.globalMetaId.trim().toLowerCase();
  if (botGlobal && authorGlobal) return botGlobal === authorGlobal;
  const botMetaId = identity.metaId.trim().toLowerCase();
  const authorMetaId = author.metaid.trim().toLowerCase();
  if (botMetaId && authorMetaId) return botMetaId === authorMetaId;
  const botAddress = identity.address.trim().toLowerCase();
  const authorAddress = author.address.trim().toLowerCase();
  if (botAddress && authorAddress) return botAddress === authorAddress;
  return false;
}

/** Body/protocolContent mutual-exclusion check shared by the CLI, daemon and tool layers. */
export function checkMetaprotocolContentInput(input: { body?: unknown; protocolContent?: unknown }): string | null {
  const hasBody = input.body != null && typeof input.body === 'object';
  const rawContent = asString(input.protocolContent);
  if (hasBody === Boolean(rawContent)) {
    return 'post_metaprotocol: pass exactly one of body (field definitions) or protocolContent (raw JSON5 text).';
  }
  return null;
}

/** Free-form metadata normalization: strings are JSON.parse-ed when possible (default ''). */
function normalizeMetadata(value: unknown): unknown {
  if (value === undefined) return '';
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
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
export function buildMetaprotocolPayload(input: {
  action: 'publish' | 'update';
  request: MetaprotocolPublishInput;
  identity: MetaprotocolActingIdentity;
  /** Resolved target record for update; null for publish. */
  record: MetaProtocolRecord | null;
}): { payload: Record<string, unknown>; protocolContent: string; replacedVersion: string; nextVersion: string } {
  const { action, request, identity, record } = input;
  const protocolName = asString(request.protocolName);
  const protocolContent = request.body != null && typeof request.body === 'object'
    ? serializeMetaprotocolBody(request.body as Record<string, unknown>)
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
      ? (request.attachments as unknown[]).map((item) => asString(item)).filter(Boolean)
      : [],
    metadata: normalizeMetadata(request.metadata),
    protocolContent,
    protocolContentType: asString(request.protocolContentType) || 'application/json',
  };
  return { payload, protocolContent, replacedVersion, nextVersion };
}

/** §5.4 step 2 — draft-07 schema gate; invalid payloads never reach the wallet. */
export function validateMetaprotocolPayload(payload: Record<string, unknown>): string | null {
  const validation = validateAgainstSchema(payload, METAPROTOCOL_PIN_SCHEMA);
  if (validation.ok) return null;
  const detail = validation.errors.map((issue) => `${issue.path || '(root)'}: ${issue.message}`).join('; ');
  return `Invalid protocol payload: ${detail}. Fix the fields and retry.`;
}

/**
 * §5.4 update step 3 — resolve the update target (protocolPath most precise,
 * pinId, else exact display-name match) to its authoritative record. Throws
 * MetaprotocolResolveError with user-facing text.
 */
export async function resolveMetaprotocolUpdateTarget(target: string, options?: MetaProtocolServiceOptions): Promise<MetaProtocolRecord> {
  const notRegistered = `Protocol ${target} is not registered yet. Use action "publish" instead.`;
  try {
    if (target.startsWith('/')) {
      const detail = await getMetaProtocolDetail({ path: target }, options);
      if (!detail.record.protocolPath) throw new MetaprotocolResolveError(notRegistered);
      return detail.record;
    }
    if (PIN_ID_PATTERN.test(target)) {
      const detail = await getMetaProtocolDetail({ pinId: target }, options);
      if (!detail.record.protocolPath) throw new MetaprotocolResolveError(notRegistered);
      return detail.record;
    }
    const page = await listMetaProtocols({ query: target, size: 50 }, options);
    const matches = page.items.filter((item) => item.protocolName.toLowerCase() === target.toLowerCase());
    if (matches.length === 0) throw new MetaprotocolResolveError(notRegistered);
    if (matches.length > 1) {
      throw new MetaprotocolResolveError(
        `Multiple protocols are registered under the name "${target}": ${matches.map((item) => item.protocolPath).join(', ')}. Resolve with the protocolPath (most precise).`,
      );
    }
    const detail = await getMetaProtocolDetail({ path: matches[0].protocolPath }, options);
    if (!detail.record.protocolPath) throw new MetaprotocolResolveError(notRegistered);
    return detail.record;
  } catch (error) {
    if (error instanceof MetaprotocolResolveError) throw error;
    if (isMetaprotocolNotFoundError(error)) throw new MetaprotocolResolveError(notRegistered);
    throw new MetaprotocolResolveError(
      `Protocol registry lookup failed for "${target}": ${error instanceof Error ? error.message : String(error)}. Try again later.`,
    );
  }
}

function authorLabel(author: { name: string; globalMetaId: string; metaid: string; address: string }): string {
  return author.name || author.globalMetaId || author.metaid || author.address || 'unknown';
}

function formatDate(ts: number): string {
  return ts > 0 ? new Date(ts * 1000).toISOString().slice(0, 10) : '';
}

/**
 * §5.4 publish step 3-4 — path occupancy. Returns the conflict error text,
 * the both-down refusal text, or null when the path is free. Never throws.
 */
export async function findMetaprotocolPublishConflict(
  protocolPath: string,
  options?: MetaProtocolServiceOptions,
): Promise<string | null> {
  let existing: MetaProtocolExisting | null = null;
  try {
    const check = await checkMetaProtocolPath(protocolPath, options);
    existing = check.available ? null : check.existing;
  } catch {
    // MetaSo down — degrade to the MANAPI scan before deciding.
    let registrations;
    try {
      registrations = await listMetaProtocolRegistrationsViaManapi(options);
    } catch {
      return 'Protocol registry check is unavailable (registry and fallback both failed). Refusing to publish to avoid duplicate registration — try again later.';
    }
    const hit = registrations.find(
      (entry) =>
        entry.payload &&
        typeof entry.payload.path === 'string' &&
        entry.payload.path.toLowerCase() === protocolPath.toLowerCase(),
    );
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
  if (!existing) return null;
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
export async function writeMetaprotocolPin(
  signer: Signer,
  input: {
    action: 'publish' | 'update';
    payload: Record<string, unknown>;
    /** Resolved target record for update (source pinId + replaced version); null for publish. */
    record: MetaProtocolRecord | null;
    replacedVersion: string;
    network: MetaprotocolNetwork;
  },
): Promise<MetaprotocolPublishResult> {
  const chainWrite = await signer.writePin({
    operation: input.action === 'publish' ? 'create' : 'modify',
    path: input.action === 'publish' ? METAPROTOCOL_REGISTRY_PATH : `@${input.record!.pinId}`,
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
export function formatMetaprotocolResult(input: {
  action: 'publish' | 'update';
  pinId: string;
  txids: string[];
  totalCost: number;
  protocolPath: string;
  version: string;
  title: string;
}): string {
  const verb = input.action === 'publish' ? 'published' : 'updated';
  const lines = [
    `Protocol ${verb} on-chain: ${input.protocolPath} v${input.version || '?'} ("${input.title}").`,
  ];
  if (input.pinId) lines.push(`- protocol pinId: ${input.pinId}`);
  if (input.txids.length) lines.push(`- txids: ${input.txids.join(', ')}`);
  lines.push(`- cost: ${input.totalCost} sats`);
  if (input.pinId) {
    lines.push(`- view link: ${markdownSelfLink(`pin://${input.pinId}`)}`);
  }
  lines.push('The indexer may take ~1 minute to confirm; verify with metaprotocol_registry (action "read") or `metabot protocol read`.');
  return lines.join('\n');
}
