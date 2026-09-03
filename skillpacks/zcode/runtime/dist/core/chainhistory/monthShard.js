"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.monthShardForMs = monthShardForMs;
exports.listMonthDirs = listMonthDirs;
exports.monthsInWindow = monthsInWindow;
exports.recentMonthShards = recentMonthShards;
// Month-shard helpers for the chain history store. Records live under
// `writes/YYYY-MM/` and `reads/YYYY-MM/`; shards are named by local-timezone
// calendar month so day/month queries map to a small set of directories.
const node_fs_1 = require("node:fs");
const MONTH_SHARD_PATTERN = /^\d{4}-\d{2}$/;
function pad2(value) {
    return String(value).padStart(2, '0');
}
/** Local-timezone `YYYY-MM` shard name for one timestamp. */
function monthShardForMs(ms) {
    const date = new Date(ms);
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}
/** Existing `YYYY-MM` directory names under one kind root, ascending. */
async function listMonthDirs(kindRoot) {
    let entries;
    try {
        entries = await node_fs_1.promises.readdir(kindRoot, { withFileTypes: true });
    }
    catch {
        return [];
    }
    return entries
        .filter((entry) => entry.isDirectory() && MONTH_SHARD_PATTERN.test(entry.name))
        .map((entry) => entry.name)
        .sort();
}
/** All `YYYY-MM` shards intersecting [fromMs, toMs), ascending. */
function monthsInWindow(fromMs, toMs) {
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
        return [];
    }
    const lastShard = monthShardForMs(toMs - 1);
    const cursor = new Date(fromMs);
    let year = cursor.getFullYear();
    let month = cursor.getMonth();
    const shards = [];
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
function recentMonthShards(count, nowMs = Date.now()) {
    const total = Math.max(1, Math.floor(count));
    const cursor = new Date(nowMs);
    let year = cursor.getFullYear();
    let month = cursor.getMonth();
    const shards = [];
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
