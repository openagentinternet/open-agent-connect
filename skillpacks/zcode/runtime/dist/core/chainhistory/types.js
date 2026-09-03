"use strict";
// Chain history record types and store-wide limits. Records are machine
// managed JSON files under `.runtime/chain-history/` (storage layout v2
// amendment 2026-09-03); this module owns the on-disk schema (version 1).
Object.defineProperty(exports, "__esModule", { value: true });
exports.PENDING_MAX_LIMIT = exports.PENDING_DEFAULT_LIMIT = exports.PENDING_SCAN_MONTHS = exports.DAY_LIST_MAX_PER_KIND = exports.SEARCH_MAX_LIMIT = exports.SEARCH_DEFAULT_LIMIT = exports.DEFAULT_SEARCH_WINDOW_MS = exports.SUMMARY_MAX_CHARS = exports.MAX_SUMMARY_ATTEMPTS = exports.SUMMARY_MIN_CONTENT_CHARS = exports.MAX_READ_EXCERPT_CHARS = exports.MAX_WRITE_CONTENT_CHARS = void 0;
exports.MAX_WRITE_CONTENT_CHARS = 16_000;
exports.MAX_READ_EXCERPT_CHARS = 8_000;
exports.SUMMARY_MIN_CONTENT_CHARS = 800;
exports.MAX_SUMMARY_ATTEMPTS = 3;
exports.SUMMARY_MAX_CHARS = 500;
exports.DEFAULT_SEARCH_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
exports.SEARCH_DEFAULT_LIMIT = 20;
exports.SEARCH_MAX_LIMIT = 50;
exports.DAY_LIST_MAX_PER_KIND = 50;
exports.PENDING_SCAN_MONTHS = 2;
exports.PENDING_DEFAULT_LIMIT = 50;
exports.PENDING_MAX_LIMIT = 200;
