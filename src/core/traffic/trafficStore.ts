// File-backed traffic (「流量」 account-quota gas credit) state for the machine-wide
// owner identity. Replaces the IDBots kvStore/SQLite persistence with two files
// under `~/.metabot/owner/` (see the storage-layout v2 spec, owner/ section):
//
// - `traffic.json` — mode, apiBase override, cached account record, and the
//   bot-address → account bindings. Atomic write-then-rename, pretty JSON like
//   the other machine-wide stores.
// - `traffic-journal.jsonl` — append-only local spend journal, one JSON row per
//   line, mirroring the IDBots `traffic_spend_journal` columns 1:1 (txId,
//   botAddress, orderId, txSize, sponsoredMinerFee, savedFee, billedBy, kind,
//   createdAt). The 1-based line number is exposed as `id` so readers keep the
//   IDBots id-ASC/DESC ordering semantics. Powers the offline usage fallback
//   and ledger enrichment.
//
// Neither file contains secret material, but both sit next to the owner
// identity, so they are written with owner-only permissions like
// owner/identity.json.

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const TRAFFIC_FILE_MODE = 0o600;

export type TrafficPinMode = 'traffic' | 'selfpay';
export type TrafficFallbackPolicy = 'selfpay' | 'strict';

export interface TrafficAccountRecord {
  accountId: string;
  identityAddress: string;
  balanceBytes: number;
  reservedBytes: number;
  grantedBytesTotal: number;
  spentBytesTotal: number;
  status: number;
}

export interface TrafficAccountBinding {
  accountId: string;
  boundAt: number;
}

export interface TrafficFileState {
  version: 1;
  /** 'traffic' (account quota, default) | 'selfpay' (each MetaBot pays its own wallet). */
  mode: TrafficPinMode;
  /** Assist-service base URL override; '' = production default. */
  apiBase: string;
  account: TrafficAccountRecord | null;
  bindings: Record<string, TrafficAccountBinding>;
}

/** Settings snapshot, API-compatible with the IDBots trafficSettings module. */
export interface TrafficSettingsSnapshot {
  mode: TrafficPinMode;
  /** Stored 'strict' is ignored; account-quota mode always falls back to self-pay. */
  fallbackPolicy: TrafficFallbackPolicy;
  /** Configured assist-service base URL override; '' = production default. */
  apiBase: string;
}

export interface TrafficSpendJournalEntry {
  /** 1-based line number inside traffic-journal.jsonl (IDBots rowid analog). */
  id: number;
  txId: string;
  botAddress: string;
  orderId: string;
  txSize: number;
  sponsoredMinerFee: number;
  savedFee: number;
  /** 'traffic' = billed to the traffic account; 'quota' = legacy sponsor quota. */
  billedBy: 'traffic' | 'quota';
  /** Pin protocol path or purpose tag (e.g. /protocols/simplemsg, /file); '' when unknown. */
  kind: string;
  createdAt: number;
}

/** Row shape accepted by appendJournal (id + createdAt are assigned here). */
export type TrafficSpendJournalInput = Omit<TrafficSpendJournalEntry, 'id' | 'createdAt'> & {
  createdAt?: number;
};

export interface TrafficDailyUsageRow {
  date: string;
  botAddress: string;
  bytes: number;
  txCount: number;
}

export interface TrafficStorePaths {
  ownerRoot: string;
  trafficPath: string;
  journalPath: string;
}

export interface TrafficStore {
  paths: TrafficStorePaths;
  /** Full state; defaults when the file does not exist. Throws on malformed JSON. */
  read(): Promise<TrafficFileState>;
  write(state: TrafficFileState): Promise<void>;
  readSettings(): Promise<TrafficSettingsSnapshot>;
  /** Partial settings update; invalid apiBase values throw and are never persisted. */
  writeSettings(input: { mode?: unknown; apiBase?: unknown }): Promise<TrafficSettingsSnapshot>;
  readAccount(): Promise<TrafficAccountRecord | null>;
  writeAccount(account: TrafficAccountRecord): Promise<void>;
  readBindings(): Promise<Record<string, TrafficAccountBinding>>;
  writeBinding(botAddress: string, accountId: string): Promise<void>;
  /** Append one journal row. Returns the stored row (without id), or null when txId/botAddress are empty. */
  appendJournal(entry: Partial<TrafficSpendJournalInput> & { txId?: unknown; botAddress?: unknown }): Promise<Omit<TrafficSpendJournalEntry, 'id'> | null>;
  /** All rows, oldest first (id ASC). Malformed lines are skipped (torn tail on crash). */
  readJournal(): Promise<TrafficSpendJournalEntry[]>;
  /** Newest first (id DESC), optionally filtered by bot address and capped by limit. */
  listJournal(input?: { limit?: number; botAddress?: string }): Promise<TrafficSpendJournalEntry[]>;
  /** Latest row per sponsor orderId (for ledger enrichment). */
  latestJournalByOrderId(input?: { limit?: number }): Promise<Map<string, TrafficSpendJournalEntry>>;
  /** Local usage fallback: journal rows bucketed by UTC day + bot address. */
  aggregateDailyUsage(input?: { botAddress?: string; limit?: number }): Promise<TrafficDailyUsageRow[]>;
}

export function resolveTrafficStorePaths(systemHomeDir: string): TrafficStorePaths {
  const ownerRoot = path.join(path.resolve(systemHomeDir), '.metabot', 'owner');
  return {
    ownerRoot,
    trafficPath: path.join(ownerRoot, 'traffic.json'),
    journalPath: path.join(ownerRoot, 'traffic-journal.jsonl'),
  };
}

// ---------------------------------------------------------------------------
// Normalization (ported from IDBots trafficSettings.ts)
// ---------------------------------------------------------------------------

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function normalizeTrafficPinMode(value: unknown): TrafficPinMode {
  return String(value ?? '').trim().toLowerCase() === 'selfpay' ? 'selfpay' : 'traffic';
}

/** Stored 'strict' is ignored; account-quota mode always falls back to self-pay. */
export function normalizeTrafficFallbackPolicy(_value?: unknown): TrafficFallbackPolicy {
  return 'selfpay';
}

/**
 * Normalize an apiBase override for persistence: trims, strips trailing
 * slashes, '' clears the override. Throws on anything that is not an
 * http(s) URL (callers surface the error and must not persist).
 */
export function normalizeTrafficApiBase(value: unknown): string {
  const text = String(value ?? '').trim().replace(/\/+$/, '');
  if (!text) return '';
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error('traffic.apiBase must be a valid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('traffic.apiBase must use http or https');
  }
  return text;
}

function normalizeAccountRecord(value: unknown): TrafficAccountRecord | null {
  const record = readObject(value);
  const accountId = normalizeText(record?.accountId);
  if (!record || !accountId) return null;
  return {
    accountId,
    identityAddress: normalizeText(record.identityAddress),
    balanceBytes: toNumber(record.balanceBytes),
    reservedBytes: toNumber(record.reservedBytes),
    grantedBytesTotal: toNumber(record.grantedBytesTotal),
    spentBytesTotal: toNumber(record.spentBytesTotal),
    status: toNumber(record.status),
  };
}

function normalizeBindings(value: unknown): Record<string, TrafficAccountBinding> {
  const record = readObject(value);
  if (!record) return {};
  const result: Record<string, TrafficAccountBinding> = {};
  for (const [address, entry] of Object.entries(record)) {
    const binding = readObject(entry);
    const accountId = normalizeText(binding?.accountId);
    if (accountId) {
      result[address] = { accountId, boundAt: toNumber(binding?.boundAt) };
    }
  }
  return result;
}

export function createDefaultTrafficFileState(): TrafficFileState {
  return { version: 1, mode: 'traffic', apiBase: '', account: null, bindings: {} };
}

function normalizeTrafficFileState(value: unknown): TrafficFileState {
  const record = readObject(value);
  if (!record) return createDefaultTrafficFileState();
  return {
    version: 1,
    mode: normalizeTrafficPinMode(record.mode),
    apiBase: normalizeText(record.apiBase),
    account: normalizeAccountRecord(record.account),
    bindings: normalizeBindings(record.bindings),
  };
}

function normalizeJournalEntry(value: unknown, id: number): TrafficSpendJournalEntry | null {
  const record = readObject(value);
  if (!record) return null;
  const txId = normalizeText(record.txId);
  const botAddress = normalizeText(record.botAddress);
  if (!txId || !botAddress) return null;
  return {
    id,
    txId,
    botAddress,
    orderId: normalizeText(record.orderId),
    txSize: toNumber(record.txSize),
    sponsoredMinerFee: toNumber(record.sponsoredMinerFee),
    savedFee: toNumber(record.savedFee),
    billedBy: normalizeText(record.billedBy) === 'traffic' ? 'traffic' : 'quota',
    kind: normalizeText(record.kind),
    createdAt: toNumber(record.createdAt),
  };
}

// ---------------------------------------------------------------------------
// File primitives
// ---------------------------------------------------------------------------

async function applyTrafficFileMode(filePath: string): Promise<void> {
  if (process.platform === 'win32') return;
  try {
    await fs.chmod(filePath, TRAFFIC_FILE_MODE);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EPERM' || code === 'ENOTSUP' || code === 'EINVAL') return;
    throw error;
  }
}

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tempPath, content, { encoding: 'utf8', mode: TRAFFIC_FILE_MODE });
    await fs.rename(tempPath, filePath);
    await applyTrafficFileMode(filePath);
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
}

async function readTrafficFile(paths: TrafficStorePaths): Promise<TrafficFileState> {
  await fs.mkdir(paths.ownerRoot, { recursive: true });
  try {
    const raw = await fs.readFile(paths.trafficPath, 'utf8');
    return normalizeTrafficFileState(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return createDefaultTrafficFileState();
    }
    throw error;
  }
}

async function writeTrafficFile(paths: TrafficStorePaths, state: TrafficFileState): Promise<void> {
  await fs.mkdir(paths.ownerRoot, { recursive: true });
  await writeFileAtomic(paths.trafficPath, `${JSON.stringify(normalizeTrafficFileState(state), null, 2)}\n`);
}

async function readJournalEntries(paths: TrafficStorePaths): Promise<TrafficSpendJournalEntry[]> {
  let raw: string;
  try {
    raw = await fs.readFile(paths.journalPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const entries: TrafficSpendJournalEntry[] = [];
  const lines = raw.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Skip torn/corrupt lines: a crash can leave a partial final row and the
      // journal must stay readable for the usage fallback either way.
      continue;
    }
    const entry = normalizeJournalEntry(parsed, entries.length + 1);
    if (entry) entries.push(entry);
  }
  return entries;
}

export function createTrafficStore(systemHomeDir: string): TrafficStore {
  const paths = resolveTrafficStorePaths(systemHomeDir);

  async function listJournal(input: { limit?: number; botAddress?: string } = {}): Promise<TrafficSpendJournalEntry[]> {
    const botAddress = normalizeText(input.botAddress);
    const limit = Number.isFinite(input.limit) && (input.limit ?? 0) > 0 ? Math.trunc(input.limit as number) : 100;
    const entries = await readJournalEntries(paths);
    const filtered = botAddress
      ? entries.filter((entry) => entry.botAddress === botAddress)
      : entries;
    return filtered.slice(-limit).reverse();
  }

  return {
    paths,

    async read() {
      return readTrafficFile(paths);
    },

    async write(state) {
      await writeTrafficFile(paths, state);
    },

    async readSettings() {
      const state = await readTrafficFile(paths);
      return {
        mode: state.mode,
        fallbackPolicy: normalizeTrafficFallbackPolicy(),
        apiBase: state.apiBase,
      };
    },

    async writeSettings(input) {
      const current = await readTrafficFile(paths);
      const nextMode = input.mode === undefined ? current.mode : normalizeTrafficPinMode(input.mode);
      // Validate before touching the file: invalid values must not be persisted.
      const nextApiBase = input.apiBase === undefined ? current.apiBase : normalizeTrafficApiBase(input.apiBase);
      await writeTrafficFile(paths, { ...current, mode: nextMode, apiBase: nextApiBase });
      return {
        mode: nextMode,
        fallbackPolicy: normalizeTrafficFallbackPolicy(),
        apiBase: nextApiBase,
      };
    },

    async readAccount() {
      const state = await readTrafficFile(paths);
      return state.account;
    },

    async writeAccount(account) {
      const current = await readTrafficFile(paths);
      await writeTrafficFile(paths, { ...current, account: normalizeAccountRecord(account) });
    },

    async readBindings() {
      const state = await readTrafficFile(paths);
      return state.bindings;
    },

    async writeBinding(botAddress, accountId) {
      const current = await readTrafficFile(paths);
      await writeTrafficFile(paths, {
        ...current,
        bindings: {
          ...current.bindings,
          [botAddress]: { accountId, boundAt: Date.now() },
        },
      });
    },

    async appendJournal(entry) {
      const txId = normalizeText(entry.txId);
      const botAddress = normalizeText(entry.botAddress);
      if (!txId || !botAddress) return null;
      const row = {
        txId,
        botAddress,
        orderId: normalizeText(entry.orderId),
        txSize: Math.max(0, Math.trunc(toNumber(entry.txSize))),
        sponsoredMinerFee: Math.max(0, Math.trunc(toNumber(entry.sponsoredMinerFee))),
        savedFee: Math.max(0, Math.trunc(toNumber(entry.savedFee))),
        billedBy: entry.billedBy === 'traffic' ? 'traffic' as const : 'quota' as const,
        kind: normalizeText(entry.kind),
        createdAt: toNumber(entry.createdAt) || Date.now(),
      };
      await fs.mkdir(paths.ownerRoot, { recursive: true });
      await fs.appendFile(paths.journalPath, `${JSON.stringify(row)}\n`, { encoding: 'utf8', mode: TRAFFIC_FILE_MODE });
      await applyTrafficFileMode(paths.journalPath);
      return row;
    },

    async readJournal() {
      return readJournalEntries(paths);
    },

    async listJournal(input = {}) {
      return listJournal(input);
    },

    async latestJournalByOrderId(input = {}) {
      const byOrderId = new Map<string, TrafficSpendJournalEntry>();
      // listJournal is id-DESC: the first row per orderId is the latest.
      for (const entry of await listJournal({ limit: input.limit ?? 1000 })) {
        if (entry.orderId && !byOrderId.has(entry.orderId)) {
          byOrderId.set(entry.orderId, entry);
        }
      }
      return byOrderId;
    },

    async aggregateDailyUsage(input = {}) {
      const botAddress = normalizeText(input.botAddress);
      const rows = await listJournal({ limit: input.limit ?? 200, botAddress: botAddress || undefined });
      const buckets = new Map<string, TrafficDailyUsageRow>();
      for (const entry of rows) {
        const date = new Date(entry.createdAt).toISOString().slice(0, 10);
        const key = `${date}|${entry.botAddress}`;
        const bucket = buckets.get(key) ?? { date, botAddress: entry.botAddress, bytes: 0, txCount: 0 };
        bucket.bytes += entry.txSize;
        bucket.txCount += 1;
        buckets.set(key, bucket);
      }
      return [...buckets.values()];
    },
  };
}
