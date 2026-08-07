"use strict";
/**
 * Game Adapter sandbox (docs/08 section 4, docs/09 section 6.6).
 *
 * The adapter runs inside a worker thread with memory resource limits; inside
 * the worker the adapter executes in a `node:vm` context that exposes only the
 * JS standard library. There is no `require`, `process`, `fetch`, `WebSocket`,
 * filesystem, wallet, host bridge, or other-group access in scope, and dynamic
 * code generation (`eval` / `new Function`) is disabled so the vm context
 * cannot reach host primordials. Execution time, output size and JSON
 * serializability are enforced by the host on every call.
 *
 * `adapterHash` is verified by the runtime before loading (see
 * `gamePackage.ts`); this module re-checks the hash of the code it receives so
 * a wrong bundle can never be executed.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sandboxSha256Hex = sandboxSha256Hex;
exports.createAdapterSandbox = createAdapterSandbox;
const node_crypto_1 = require("node:crypto");
const node_worker_threads_1 = require("node:worker_threads");
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function sandboxSha256Hex(value) {
    return (0, node_crypto_1.createHash)('sha256').update(value).digest('hex');
}
function normalizeAdapterHashHex(value) {
    const text = normalizeText(value).toLowerCase();
    return text.startsWith('sha256:') ? text.slice('sha256:'.length) : text;
}
const WORKER_BOOTSTRAP = `
const { parentPort, workerData } = require('node:worker_threads');
const vm = require('node:vm');

function transformModule(source) {
  const exportNames = [];
  const out = [];
  for (const rawLine of String(source).split('\\n')) {
    const line = rawLine;
    let match = line.match(/^export\\s+(?:async\\s+)?function\\s+([A-Za-z_$][\\w$]*)/u);
    if (match) {
      exportNames.push(match[1]);
      out.push(line.replace(/^export\\s+/u, ''));
      continue;
    }
    match = line.match(/^export\\s+(?:async\\s+)?function\\s*\\*/u);
    if (match) {
      out.push(line.replace(/^export\\s+/u, ''));
      continue;
    }
    match = line.match(/^export\\s+(const|let|var)\\s+([A-Za-z_$][\\w$]*)/u);
    if (match) {
      exportNames.push(match[2]);
      out.push(line.replace(/^export\\s+/u, ''));
      continue;
    }
    match = line.match(/^export\\s*\\{([^}]*)\\}/u);
    if (match) {
      for (const part of match[1].split(',')) {
        const specifier = part.trim();
        if (!specifier) continue;
        const name = specifier.split(/\\s+as\\s+/u).pop().trim();
        if (name) exportNames.push(name);
      }
      out.push('');
      continue;
    }
    if (/^export\\s+default/u.test(line)) {
      throw new Error('default exports are not supported by the game adapter ABI');
    }
    out.push(line);
  }
  if (exportNames.length) {
    out.push(';globalThis.__ADAPTER_EXPORTS__ = {' +
      exportNames.map((name) => name + ': typeof ' + name + ' !== "undefined" ? ' + name + ' : undefined').join(', ') +
      '};');
  }
  return out.join('\\n');
}

const SANDBOX_GLOBALS = {
  JSON, Math, Object, Array, String, Number, Boolean, Map, Set, WeakMap, WeakSet,
  Promise, Error, TypeError, RangeError, EvalError, SyntaxError, URIError, ReferenceError,
  RegExp, Symbol, BigInt, Date, Intl,
  ArrayBuffer, SharedArrayBuffer, DataView,
  Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array,
  Int8Array, Int16Array, Int32Array, Float32Array, Float64Array,
  TextEncoder, TextDecoder, structuredClone,
  isNaN, isFinite, parseFloat, parseInt,
  decodeURI, decodeURIComponent, encodeURI, encodeURIComponent,
  undefined, NaN, Infinity,
};

let adapter = null;
let loadedCodeHash = '';

function loadAdapter(code, codeHash, timeoutMs) {
  if (adapter && loadedCodeHash === codeHash) return;
  const context = vm.createContext(Object.assign({}, SANDBOX_GLOBALS), {
    codeGeneration: { strings: false, wasm: false },
  });
  const wrapped = transformModule(code);
  vm.runInContext(wrapped, context, { timeout: timeoutMs });
  const exportsTable = context.__ADAPTER_EXPORTS__ || {};
  adapter = { context, exportsTable };
  loadedCodeHash = codeHash;
}

function serializeResult(value) {
  let text;
  try {
    text = JSON.stringify(value);
  } catch (error) {
    throw new Error('adapter result is not JSON-serializable: ' + (error && error.message ? error.message : String(error)));
  }
  if (text === undefined) {
    throw new Error('adapter result must be a JSON value');
  }
  return text;
}

parentPort.on('message', async (message) => {
  const respond = (payload) => {
    try {
      parentPort.postMessage(payload);
    } catch (_) {
      // Payload too large for the worker channel: report as output limit.
      try {
        parentPort.postMessage({ id: message.id, ok: false, error: { message: 'adapter output exceeds the host output limit', code: 'adapter_error' } });
      } catch (_) {
        // Worker is gone; the host-side timeout will surface the failure.
      }
    }
  };
  try {
    if (message.kind === 'load') {
      loadAdapter(message.code, message.codeHash, message.timeoutMs);
      respond({ id: message.id, ok: true });
      return;
    }
    if (message.kind === 'call') {
      if (!adapter || loadedCodeHash !== message.codeHash) {
        loadAdapter(message.code, message.codeHash, message.timeoutMs);
      }
      const fn = adapter.exportsTable[message.method];
      if (typeof fn !== 'function') {
        throw new Error('adapter export not found: ' + message.method);
      }
      let result = fn.apply(null, message.args);
      if (result && typeof result.then === 'function') {
        result = await Promise.race([
          result,
          new Promise((_, reject) => setTimeout(() => reject(new Error('adapter call timed out')), message.timeoutMs)),
        ]);
      }
      const text = serializeResult(result);
      if (Buffer.byteLength(text, 'utf8') > message.maxOutputBytes) {
        throw new Error('adapter output exceeds the host output limit');
      }
      respond({ id: message.id, ok: true, result: JSON.parse(text) });
      return;
    }
    if (message.kind === 'has') {
      if (!adapter || loadedCodeHash !== message.codeHash) {
        loadAdapter(message.code, message.codeHash, message.timeoutMs);
      }
      respond({
        id: message.id,
        ok: true,
        result: typeof adapter.exportsTable[message.name] === 'function',
      });
      return;
    }
    throw new Error('unknown adapter sandbox message kind: ' + message.kind);
  } catch (error) {
    respond({
      id: message.id,
      ok: false,
      error: {
        message: error instanceof Error ? error.message : String(error),
        code: 'adapter_error',
      },
    });
  }
});
`;
const DEFAULT_CALL_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_MAX_OLD_GENERATION_MB = 96;
const DEFAULT_MAX_YOUNG_GENERATION_MB = 32;
/**
 * Create a sandboxed adapter session. The adapter hash is verified against the
 * code before any execution; a mismatched bundle is rejected.
 */
function createAdapterSandbox(options) {
    const code = String(options.adapterCode ?? '');
    const requestedHash = normalizeAdapterHashHex(String(options.adapterHash ?? ''));
    if (!requestedHash) {
        throw new Error('adapterHash is required and must be a sha256 hex value.');
    }
    const computedHash = sandboxSha256Hex(code);
    if (computedHash !== requestedHash) {
        throw new Error(`adapterHash mismatch: expected ${requestedHash}, computed ${computedHash}`);
    }
    const timeoutMs = Number.isFinite(options.timeoutMs) && Number(options.timeoutMs) > 0
        ? Math.trunc(Number(options.timeoutMs))
        : DEFAULT_CALL_TIMEOUT_MS;
    const maxOutputBytes = Number.isFinite(options.maxOutputBytes) && Number(options.maxOutputBytes) > 0
        ? Math.trunc(Number(options.maxOutputBytes))
        : DEFAULT_MAX_OUTPUT_BYTES;
    let worker = null;
    let nextId = 0;
    const pending = new Map();
    let broken = false;
    function spawnWorker() {
        const spawned = new node_worker_threads_1.Worker(WORKER_BOOTSTRAP, {
            eval: true,
            workerData: { code },
            resourceLimits: {
                maxOldGenerationSizeMb: Number.isFinite(options.maxOldGenerationSizeMb)
                    ? Number(options.maxOldGenerationSizeMb)
                    : DEFAULT_MAX_OLD_GENERATION_MB,
                maxYoungGenerationSizeMb: Number.isFinite(options.maxYoungGenerationSizeMb)
                    ? Number(options.maxYoungGenerationSizeMb)
                    : DEFAULT_MAX_YOUNG_GENERATION_MB,
            },
        });
        spawned.on('message', (payload) => {
            const id = Number(payload?.id);
            const entry = pending.get(id);
            if (!entry)
                return;
            pending.delete(id);
            clearTimeout(entry.timer);
            if (payload?.ok === true) {
                entry.resolve(payload.result);
            }
            else {
                const errorRecord = payload?.error && typeof payload.error === 'object'
                    ? payload.error
                    : {};
                const error = new Error(typeof errorRecord.message === 'string'
                    ? errorRecord.message
                    : 'Adapter execution failed.');
                error.code = typeof errorRecord.code === 'string'
                    ? errorRecord.code
                    : 'adapter_error';
                entry.reject(error);
            }
        });
        spawned.on('error', (error) => {
            broken = true;
            for (const entry of pending.values()) {
                clearTimeout(entry.timer);
                entry.reject(error);
            }
            pending.clear();
            void spawned.terminate().catch(() => undefined);
        });
        spawned.on('exit', (code) => {
            if (pending.size > 0) {
                broken = true;
                const error = new Error(`Adapter worker exited unexpectedly (code ${code}).`);
                error.code = 'adapter_error';
                for (const entry of pending.values()) {
                    clearTimeout(entry.timer);
                    entry.reject(error);
                }
                pending.clear();
            }
        });
        return spawned;
    }
    function ensureWorker() {
        if (worker && !broken) {
            return worker;
        }
        if (worker) {
            void worker.terminate().catch(() => undefined);
        }
        broken = false;
        worker = spawnWorker();
        return worker;
    }
    return {
        call(method, args = []) {
            const target = ensureWorker();
            const id = ++nextId;
            return new Promise((resolve, reject) => {
                const entryResolve = (value) => resolve(value);
                const timer = setTimeout(() => {
                    pending.delete(id);
                    broken = true;
                    const error = new Error(`Adapter call timed out after ${timeoutMs}ms: ${method}`);
                    error.code = 'adapter_error';
                    reject(error);
                }, timeoutMs + 2_000);
                pending.set(id, { resolve: entryResolve, reject, timer });
                try {
                    target.postMessage({
                        kind: 'call',
                        id,
                        method,
                        args,
                        code,
                        codeHash: computedHash,
                        timeoutMs,
                        maxOutputBytes,
                    });
                }
                catch (error) {
                    pending.delete(id);
                    clearTimeout(timer);
                    broken = true;
                    reject(error instanceof Error ? error : new Error(String(error)));
                }
            });
        },
        hasExport(name) {
            const target = ensureWorker();
            const id = ++nextId;
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    pending.delete(id);
                    broken = true;
                    reject(new Error(`Adapter export check timed out: ${name}`));
                }, timeoutMs + 2_000);
                pending.set(id, {
                    resolve: (value) => resolve(value === true),
                    reject,
                    timer,
                });
                try {
                    target.postMessage({
                        kind: 'has',
                        id,
                        name,
                        code,
                        codeHash: computedHash,
                        timeoutMs,
                    });
                }
                catch (error) {
                    pending.delete(id);
                    clearTimeout(timer);
                    broken = true;
                    reject(error instanceof Error ? error : new Error(String(error)));
                }
            });
        },
        dispose() {
            if (worker) {
                for (const entry of pending.values()) {
                    clearTimeout(entry.timer);
                    entry.reject(new Error('Adapter sandbox was disposed.'));
                }
                pending.clear();
                void worker.terminate().catch(() => undefined);
                worker = null;
            }
        },
    };
}
