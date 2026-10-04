"use strict";
/**
 * Game Adapter sandbox (docs/08 section 4, docs/09 section 6.6).
 *
 * The adapter runs inside a worker thread with memory resource limits; inside
 * the worker the adapter executes in a `node:vm` context built from a
 * null-prototype template, so only the context's own intrinsics are reachable.
 * No host-realm value ever enters the context: there is no `require`,
 * `process`, `fetch`, `WebSocket`, filesystem, wallet, host bridge, or
 * other-group access in scope, dynamic code generation (`eval` /
 * `new Function`) is disabled, and call arguments cross the boundary as JSON
 * text that is parsed inside the context — adapter code can never touch a
 * host-realm object, so `Object.constructor` and friends resolve to the
 * context's own (code-generation-disabled) intrinsics. Execution time, output
 * size and JSON serializability are enforced by the host on every call.
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
// JavaScript evaluated inside every fresh vm context before any adapter code
// runs. Everything it creates belongs to the context realm; it must never
// reference a worker-realm value, or that value would hand the adapter a
// bridge out of the sandbox.
const SANDBOX_PRIMER = `
'use strict';
// Shadow the ambient "constructor" lookup on the global object: the
// contextified template already has a null prototype, and this own property
// is defense in depth against the global proxy ever surfacing one.
Object.defineProperty(globalThis, 'constructor', {
  value: undefined, writable: false, configurable: false, enumerable: false,
});
// Keep Error stack formatting on the default path so adapter code can never
// receive stack-frame CallSite objects via Error.prepareStackTrace.
Object.freeze(Error);
Object.freeze(Error.prototype);
// JSON round-trip clone: adapter values must be JSON-serializable anyway.
globalThis.structuredClone = function structuredClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
};
// UTF-8 TextEncoder/TextDecoder: a bare vm context ships neither, and host
// copies must never be injected (they are host-realm objects).
globalThis.TextEncoder = class TextEncoder {
  encode(input) {
    const str = String(input === undefined ? '' : input);
    const bytes = [];
    for (let i = 0; i < str.length; i += 1) {
      let code = str.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
        const next = str.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
          i += 1;
        } else {
          code = 0xfffd;
        }
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        code = 0xfffd;
      }
      if (code < 0x80) {
        bytes.push(code);
      } else if (code < 0x800) {
        bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      } else if (code < 0x10000) {
        bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      } else {
        bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      }
    }
    return Uint8Array.from(bytes);
  }
  encodeInto(input, dest) {
    const str = String(input === undefined ? '' : input);
    const encoded = this.encode(str);
    const limit = Math.min(encoded.length, dest.length);
    dest.set(encoded.subarray(0, limit));
    let read = 0;
    let used = 0;
    for (let i = 0; i < str.length && used < limit; i += 1) {
      const code = str.charCodeAt(i);
      const width = code < 0x80 ? 1 : code < 0x800 ? 2 : (code >= 0xd800 && code <= 0xdbff) ? 4 : 3;
      if (used + width > limit) break;
      used += width;
      read += width === 4 ? 2 : 1;
    }
    return { read, written: limit };
  }
};
globalThis.TextDecoder = class TextDecoder {
  constructor(label, options) {
    const normalized = String(label === undefined ? 'utf-8' : label).toLowerCase().replace(/[\\s_]/gu, '-');
    if (normalized !== 'utf-8' && normalized !== 'utf8' && normalized !== 'unicode-1-1-utf-8') {
      throw new TypeError('TextDecoder polyfill supports utf-8 only, got: ' + label);
    }
    this.fatal = Boolean(options && options.fatal);
  }
  decode(input) {
    let view;
    if (input === undefined) {
      view = new Uint8Array(0);
    } else if (input instanceof ArrayBuffer) {
      view = new Uint8Array(input);
    } else if (ArrayBuffer.isView(input)) {
      view = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    } else {
      throw new TypeError('TextDecoder.decode expects an ArrayBuffer or a typed array');
    }
    let out = '';
    let i = 0;
    const fail = () => {
      if (this.fatal) throw new TypeError('The encoded data was not valid utf-8');
      return 0xfffd;
    };
    while (i < view.length) {
      const first = view[i];
      let code = 0;
      let size = 0;
      if (first < 0x80) { code = first; size = 1; }
      else if ((first & 0xe0) === 0xc0) { code = first & 0x1f; size = 2; }
      else if ((first & 0xf0) === 0xe0) { code = first & 0x0f; size = 3; }
      else if ((first & 0xf8) === 0xf0) { code = first & 0x07; size = 4; }
      else { code = fail(); size = 1; }
      if (size > 1) {
        let valid = i + size <= view.length;
        for (let j = 1; valid && j < size; j += 1) {
          if ((view[i + j] & 0xc0) !== 0x80) valid = false;
        }
        if (valid) {
          for (let j = 1; j < size; j += 1) code = (code << 6) | (view[i + j] & 0x3f);
          const overlong = (size === 2 && code < 0x80) || (size === 3 && code < 0x800) || (size === 4 && code < 0x10000);
          if (overlong || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
            code = fail();
          }
        } else {
          code = fail();
          size = 1;
        }
      }
      i += size;
      if (code <= 0xffff) {
        out += String.fromCharCode(code);
      } else {
        code -= 0x10000;
        out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
      }
    }
    return out;
  }
};
// Argument bridge: the worker passes call arguments as JSON text and the
// context parses them with its own JSON, so adapter code only ever receives
// context-realm values — never a worker-realm object it could climb out of.
globalThis.__SANDBOX_PARSE_ARGS__ = function parseSandboxArgs(json) {
  return JSON.parse(json);
};
`;
const WORKER_BOOTSTRAP = `
const { parentPort, workerData } = require('node:worker_threads');
const vm = require('node:vm');

const SANDBOX_PRIMER = ${JSON.stringify(SANDBOX_PRIMER)};

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

let adapter = null;
let loadedCodeHash = '';

// The context is built from a null-prototype template and gets only the
// primer: every value adapter code can reach is a context-realm intrinsic.
// Never add host/worker-realm values here — a single one (Object, a host
// function, a host-created argument) reopens the constructor escape.
function loadAdapter(code, codeHash, timeoutMs) {
  if (adapter && loadedCodeHash === codeHash) return;
  const context = vm.createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false },
  });
  vm.runInContext(SANDBOX_PRIMER, context, { timeout: timeoutMs });
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
      // Arguments arrive as JSON text and are parsed inside the context:
      // passing worker-realm values directly would hand the adapter host
      // primordials through their prototype chain.
      const argsJson = typeof message.argsJson === 'string' ? message.argsJson : '[]';
      const args = adapter.context.__SANDBOX_PARSE_ARGS__(argsJson);
      let result = fn.apply(null, args);
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
            // Defense in depth: the adapter must never observe the host process
            // environment even if a sandbox escape is ever found.
            env: {},
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
                let argsJson;
                try {
                    argsJson = JSON.stringify(args) ?? '[]';
                }
                catch (error) {
                    pending.delete(id);
                    clearTimeout(timer);
                    const argError = new Error(`adapter args are not JSON-serializable: ${error instanceof Error ? error.message : String(error)}`);
                    argError.code = 'adapter_error';
                    reject(argError);
                    return;
                }
                try {
                    target.postMessage({
                        kind: 'call',
                        id,
                        method,
                        argsJson,
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
