import { promises as fs } from 'node:fs';
import { ensureRuntimeLayout } from '../state/runtimeStateStore';
import { resolveMetabotPaths, type MetabotPaths } from '../state/paths';

export interface RatingDetailItem {
  pinId: string;
  serviceId: string;
  servicePaidTx: string | null;
  rate: number;
  comment: string | null;
  raterGlobalMetaId: string | null;
  raterMetaId: string | null;
  createdAt: number | null;
}

export interface RatingDetailState {
  items: RatingDetailItem[];
  latestPinId: string | null;
  backfillCursor: string | null;
  lastSyncedAt: number | null;
}

export interface RatingDetailStateStore {
  paths: MetabotPaths;
  ensureLayout(): Promise<MetabotPaths>;
  read(): Promise<RatingDetailState>;
  write(nextState: RatingDetailState): Promise<RatingDetailState>;
  update(
    updater: (
      currentState: RatingDetailState
    ) => RatingDetailState | Promise<RatingDetailState>
  ): Promise<RatingDetailState>;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function createEmptyRatingDetailState(): RatingDetailState {
  return {
    items: [],
    latestPinId: null,
    backfillCursor: null,
    lastSyncedAt: null,
  };
}

function normalizeRatingDetailItem(value: RatingDetailItem | null | undefined): RatingDetailItem | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const pinId = normalizeText(value.pinId);
  const serviceId = normalizeText(value.serviceId);
  const rate = normalizeNumber(value.rate);

  if (!pinId || !serviceId || rate === null) {
    return null;
  }

  return {
    pinId,
    serviceId,
    servicePaidTx: normalizeText(value.servicePaidTx) || null,
    rate,
    comment: normalizeText(value.comment) || null,
    raterGlobalMetaId: normalizeText(value.raterGlobalMetaId) || null,
    raterMetaId: normalizeText(value.raterMetaId) || null,
    createdAt: normalizeNumber(value.createdAt),
  };
}

function normalizeRatingDetailState(value: RatingDetailState | null | undefined): RatingDetailState {
  if (!value || typeof value !== 'object') {
    return createEmptyRatingDetailState();
  }

  return {
    items: Array.isArray(value.items)
      ? value.items
          .map((item) => normalizeRatingDetailItem(item))
          .filter((item): item is RatingDetailItem => item !== null)
      : [],
    latestPinId: normalizeText(value.latestPinId) || null,
    backfillCursor: normalizeText(value.backfillCursor) || null,
    lastSyncedAt: normalizeNumber(value.lastSyncedAt),
  };
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export function createRatingDetailStateStore(homeDirOrPaths: string | MetabotPaths): RatingDetailStateStore {
  const paths = typeof homeDirOrPaths === 'string' ? resolveMetabotPaths(homeDirOrPaths) : homeDirOrPaths;

  return {
    paths,
    async ensureLayout() {
      await ensureRuntimeLayout(paths);
      return paths;
    },
    async read() {
      await ensureRuntimeLayout(paths);
      return normalizeRatingDetailState(await readJsonFile<RatingDetailState>(paths.ratingDetailStatePath));
    },
    async write(nextState) {
      await ensureRuntimeLayout(paths);
      const normalized = normalizeRatingDetailState(nextState);
      await fs.writeFile(paths.ratingDetailStatePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
      return normalized;
    },
    async update(updater) {
      const currentState = await this.read();
      const nextState = await updater(currentState);
      return this.write(nextState);
    },
  };
}
