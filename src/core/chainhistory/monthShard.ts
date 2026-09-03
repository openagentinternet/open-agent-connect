// Month-shard helpers for the chain history store. Records live under
// `writes/YYYY-MM/` and `reads/YYYY-MM/`; shards are named by local-timezone
// calendar month so day/month queries map to a small set of directories.
import { promises as fs } from 'node:fs';

const MONTH_SHARD_PATTERN = /^\d{4}-\d{2}$/;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Local-timezone `YYYY-MM` shard name for one timestamp. */
export function monthShardForMs(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

/** Existing `YYYY-MM` directory names under one kind root, ascending. */
export async function listMonthDirs(kindRoot: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(kindRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && MONTH_SHARD_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

/** All `YYYY-MM` shards intersecting [fromMs, toMs), ascending. */
export function monthsInWindow(fromMs: number, toMs: number): string[] {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
    return [];
  }
  const lastShard = monthShardForMs(toMs - 1);
  const cursor = new Date(fromMs);
  let year = cursor.getFullYear();
  let month = cursor.getMonth();
  const shards: string[] = [];
  while (shards.length < 1200) {
    const shard = `${year}-${pad2(month + 1)}`;
    shards.push(shard);
    if (shard === lastShard) {
      break;
    }
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return shards;
}

/** The current plus previous `count - 1` local-month shards, ascending. */
export function recentMonthShards(count: number, nowMs: number = Date.now()): string[] {
  const total = Math.max(1, Math.floor(count));
  const cursor = new Date(nowMs);
  let year = cursor.getFullYear();
  let month = cursor.getMonth();
  const shards: string[] = [];
  for (let index = 0; index < total; index += 1) {
    shards.push(`${year}-${pad2(month + 1)}`);
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
  }
  return shards.sort();
}
