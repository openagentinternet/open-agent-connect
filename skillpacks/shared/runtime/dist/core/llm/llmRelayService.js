"use strict";
/**
 * MetaID free LLM relay client (media recognition backend).
 *
 * Ports the IDBots visionRelayService/llmRelayService pair onto OAC's
 * file-based stores: the machine-wide owner identity
 * (src/core/owner/ownerIdentity.ts) signs the relay bootstrap, and the
 * returned relay key + chat baseUrl are cached in
 * `~/.metabot/owner/llm-relay.json` (0600, atomic write — the key is secret
 * material like the owner mnemonic).
 *
 * Backend contract (assist-base-service docs/llm-relay-integration.md):
 * - POST {gateway}/v2/assist/llm/bootstrap — headers X-Identity-Address /
 *   X-Timestamp / X-Signature over `llm-relay-bootstrap:<address>:<ts>`;
 *   returns { apiKey: "mrk_...", baseUrl: ".../v2/assist/llm/v1", quota }.
 * - POST {baseUrl without /v1}/vision/recognize — Bearer relay key; body
 *   carries exactly one media group (image|video|audio, base64 or URL) plus
 *   an optional prompt; returns { code:0, data:{content, model, usage,
 *   remainingToday} } or { code:1, message } with stable error strings.
 * - Media recognition consumes a separate per-identity daily quota, not the
 *   chat token quota. A revoked/lost key is recovered by exactly one
 *   re-bootstrap + retry ("relay key invalid or revoked").
 *
 * The gateway base resolves like the traffic service: deps.baseUrl override,
 * then the stored traffic.apiBase override (same backend), then the
 * production default. Node-only (fetch + optional system ffmpeg injected via
 * deps), so plain node:test coverage works.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LlmRelayError = exports.VISION_VIDEO_MAX_SECONDS = exports.VISION_VIDEO_MAX_RAW_BYTES = exports.VISION_AUDIO_MAX_BASE64_BYTES = exports.VISION_MAX_IMAGE_BYTES = exports.DEFAULT_LLM_RELAY_API_BASE_URL = void 0;
exports.buildLlmRelayBootstrapMessage = buildLlmRelayBootstrapMessage;
exports.deriveVisionRecognizeUrl = deriveVisionRecognizeUrl;
exports.inferAudioMimeType = inferAudioMimeType;
exports.sniffImageMime = sniffImageMime;
exports.resolveFfmpegPath = resolveFfmpegPath;
exports.parseFfmpegDuration = parseFfmpegDuration;
exports.buildImageEncodeArgs = buildImageEncodeArgs;
exports.buildVideoTranscodeArgs = buildVideoTranscodeArgs;
exports.buildAudioExtractArgs = buildAudioExtractArgs;
exports.createLlmRelayService = createLlmRelayService;
exports.formatMediaRelayError = formatMediaRelayError;
const node_child_process_1 = require("node:child_process");
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const ownerIdentity_1 = require("../owner/ownerIdentity");
const mvcMessageSigning_1 = require("../subsidy/mvcMessageSigning");
const deriveIdentity_1 = require("../identity/deriveIdentity");
const trafficStore_1 = require("../traffic/trafficStore");
exports.DEFAULT_LLM_RELAY_API_BASE_URL = 'https://www.metaso.network/assist-open-api';
const RELAY_FILE_MODE = 0o600;
const BOOTSTRAP_TIMEOUT_MS = 15_000;
const RECOGNIZE_TIMEOUT_MS = 120_000;
const FFMPEG_TIMEOUT_MS = 120_000;
/** Cap for the post-codec JPEG payload handed to the relay (base64 excluded). */
exports.VISION_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** Keep the encoded audio body below the relay's 10 MiB ceiling. */
exports.VISION_AUDIO_MAX_BASE64_BYTES = 10 * 1024 * 1024;
/**
 * Target ceiling for a transcoded video's RAW bytes. The upstream accepts
 * base64 up to 10 MB and base64 inflates by ~4/3, so 6.8 MB raw encodes to
 * ~9.1 MB — inside the cap with envelope margin.
 */
exports.VISION_VIDEO_MAX_RAW_BYTES = 6.8 * 1024 * 1024;
/** Videos longer than this are truncated (the describe result says so). */
exports.VISION_VIDEO_MAX_SECONDS = 180;
class LlmRelayError extends Error {
    /** Stable server-side message (backend error contract) when available. */
    relayMessage;
    constructor(message, relayMessage = null) {
        super(message);
        this.name = 'LlmRelayError';
        this.relayMessage = relayMessage;
    }
}
exports.LlmRelayError = LlmRelayError;
/** Canonical bootstrap message (backend llm_relay/message.go — do not change). */
function buildLlmRelayBootstrapMessage(identityAddress, timestamp) {
    return `llm-relay-bootstrap:${identityAddress}:${timestamp}`;
}
/**
 * Derive the recognize endpoint from a relay-supplied chat baseUrl
 * (`.../v2/assist/llm/v1` -> `.../v2/assist/llm/vision/recognize`). Tolerant
 * of an explicit recognize URL or a bare gateway base so static deployments
 * and env overrides keep working.
 */
function deriveVisionRecognizeUrl(baseUrl) {
    const base = (baseUrl || '').trim().replace(/\/+$/, '');
    if (!base)
        throw new LlmRelayError('llm relay baseUrl is empty');
    if (base.endsWith('/vision/recognize'))
        return base;
    const stem = base.endsWith('/v1') ? base.slice(0, -'/v1'.length) : base;
    if (stem.endsWith('/llm'))
        return `${stem}/vision/recognize`;
    if (stem.endsWith('/v2/assist/llm'))
        return `${stem}/vision/recognize`;
    if (stem.endsWith('/assist-open-api') || /\/v\d+\/assist$/.test(stem)) {
        return `${stem}/llm/vision/recognize`;
    }
    // Bare gateway base (e.g. https://www.metaso.network/assist-open-api handled
    // above); any other custom gateway gets the full documented path appended.
    return `${stem}/v2/assist/llm/vision/recognize`;
}
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}
function nowSeconds() {
    return Math.floor(Date.now() / 1000);
}
// ---------------------------------------------------------------------------
// Media typing helpers
// ---------------------------------------------------------------------------
const IMAGE_MIME_BY_EXTENSION = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
};
const AUDIO_MIME_BY_EXTENSION = {
    '.wav': 'audio/wav',
    '.wave': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.mpeg': 'audio/mpeg',
    '.mp4': 'audio/mp4',
    '.m4a': 'audio/m4a',
    '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg',
    '.webm': 'audio/webm',
};
const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.mkv', '.avi', '.webm', '.wmv', '.flv', '.ts']);
function inferAudioMimeType(reference, explicit) {
    const provided = explicit?.trim().toLowerCase();
    if (provided)
        return provided;
    try {
        const extension = node_path_1.default.extname(new URL(reference).pathname).toLowerCase();
        if (AUDIO_MIME_BY_EXTENSION[extension])
            return AUDIO_MIME_BY_EXTENSION[extension];
    }
    catch {
        // Local paths are handled below.
    }
    return AUDIO_MIME_BY_EXTENSION[node_path_1.default.extname(reference).toLowerCase()] ?? 'audio/wav';
}
/** Sniff an image MIME from magic bytes; null when the buffer is no known image. */
function sniffImageMime(buffer) {
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
        return 'image/jpeg';
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
        return 'image/png';
    if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP')
        return 'image/webp';
    if (buffer.length >= 6 && (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a'))
        return 'image/gif';
    return null;
}
function imageMimeFor(file, buffer) {
    return IMAGE_MIME_BY_EXTENSION[node_path_1.default.extname(file).toLowerCase()] ?? sniffImageMime(buffer)
        ?? (() => { throw new LlmRelayError(`unsupported image format: ${file} (jpeg/png/webp/gif only)`); })();
}
// ---------------------------------------------------------------------------
// ffmpeg layer (system binary; optional)
// ---------------------------------------------------------------------------
let cachedFfmpegPath;
/**
 * Resolve the ffmpeg binary. Order: `OAC_FFMPEG_PATH`, then `ffmpeg` on PATH
 * (verified once with `-version`). OAC does not bundle ffmpeg like IDBots
 * does; video transcoding and audio extraction degrade gracefully when the
 * binary is unavailable.
 */
function resolveFfmpegPath() {
    if (cachedFfmpegPath !== undefined)
        return cachedFfmpegPath;
    cachedFfmpegPath = null;
    const envPath = (process.env.OAC_FFMPEG_PATH || '').trim();
    const candidate = envPath || 'ffmpeg';
    try {
        const probe = (0, node_child_process_1.spawnSync)(candidate, ['-version'], { timeout: 10_000 });
        cachedFfmpegPath = probe.status === 0 ? candidate : null;
    }
    catch {
        cachedFfmpegPath = null;
    }
    return cachedFfmpegPath;
}
async function runFfmpegProcess(args, timeoutMs) {
    const ffmpeg = resolveFfmpegPath();
    if (!ffmpeg)
        throw new LlmRelayError('ffmpeg is not available (install ffmpeg or set OAC_FFMPEG_PATH)');
    return await new Promise((resolve, reject) => {
        const child = (0, node_child_process_1.spawn)(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new LlmRelayError(`ffmpeg timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        child.stderr?.on('data', (chunk) => {
            stderr += chunk.toString('utf8');
            if (stderr.length > 8192)
                stderr = stderr.slice(-4096);
        });
        child.on('error', (error) => {
            clearTimeout(timer);
            reject(new LlmRelayError(`ffmpeg failed to start: ${error.message}`));
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            resolve({ code, stderr });
        });
    });
}
/** Parse the source duration (seconds) out of an `ffmpeg -i` stderr probe. */
function parseFfmpegDuration(stderr) {
    const match = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr);
    if (!match)
        return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds))
        return null;
    return hours * 3600 + minutes * 60 + seconds;
}
async function makeTempDir() {
    return await node_fs_1.promises.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), 'oac-media-'));
}
async function removeTempDir(dir) {
    try {
        await node_fs_1.promises.rm(dir, { recursive: true, force: true });
    }
    catch {
        // best-effort temp cleanup
    }
}
/**
 * ffmpeg args that re-encode one image to a ≤1280px JPEG (same output shape
 * as the IDBots pipeline). Exported for tests.
 */
function buildImageEncodeArgs(input) {
    return [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-i', input.inputPath,
        '-frames:v', '1',
        '-vf', "scale='min(1280,iw)':-2",
        '-q:v', '5',
        input.outputPath,
    ];
}
/**
 * ffmpeg args for one video transcode pass. Recognition clips are throwaway:
 * tiny resolution, low fps, no audio, high CRF — the upstream samples
 * 2 frames/second regardless, so visual fidelity only needs to survive 480px.
 * Exported for tests.
 */
function buildVideoTranscodeArgs(input) {
    const scale = input.pass === 'standard' ? "scale='min(480,iw)':-2" : "scale='min(360,iw)':-2";
    const crf = input.pass === 'standard' ? '32' : '38';
    return [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-i', input.inputPath,
        '-t', String(Math.max(1, Math.floor(input.maxSeconds))),
        '-vf', scale,
        '-r', '4',
        '-an',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', crf,
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        input.outputPath,
    ];
}
/** ffmpeg args that extract a video's audio track as 16 kHz mono mp3. Exported for tests. */
function buildAudioExtractArgs(input) {
    return [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-i', input.inputPath,
        '-vn',
        '-ac', '1',
        '-ar', '16000',
        '-c:a', 'libmp3lame',
        '-b:a', '64k',
        input.outputPath,
    ];
}
function relayFilePath(systemHomeDir) {
    return node_path_1.default.join(node_path_1.default.resolve(systemHomeDir), '.metabot', 'owner', 'llm-relay.json');
}
async function readRelayFile(systemHomeDir) {
    try {
        const raw = await node_fs_1.promises.readFile(relayFilePath(systemHomeDir), 'utf8');
        const parsed = JSON.parse(raw);
        const apiKey = normalizeText(parsed.apiKey);
        const baseUrl = normalizeText(parsed.baseUrl);
        if (apiKey && baseUrl)
            return { version: 1, apiKey, baseUrl, updatedAt: Number(parsed.updatedAt) || 0 };
    }
    catch {
        // unreadable/missing file falls through to bootstrap
    }
    return null;
}
async function writeRelayFile(systemHomeDir, credentials) {
    const filePath = relayFilePath(systemHomeDir);
    const state = { version: 1, ...credentials, updatedAt: Date.now() };
    const tempPath = `${filePath}.${process.pid}.${(0, node_crypto_1.randomUUID)()}.tmp`;
    try {
        await node_fs_1.promises.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
        await node_fs_1.promises.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: RELAY_FILE_MODE });
        await node_fs_1.promises.rename(tempPath, filePath);
        if (process.platform !== 'win32') {
            await node_fs_1.promises.chmod(filePath, RELAY_FILE_MODE).catch(() => undefined);
        }
    }
    finally {
        await node_fs_1.promises.rm(tempPath, { force: true }).catch(() => undefined);
    }
}
async function deleteRelayFile(systemHomeDir) {
    try {
        await node_fs_1.promises.rm(relayFilePath(systemHomeDir), { force: true });
    }
    catch {
        // best-effort
    }
}
// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------
function createLlmRelayService(deps) {
    const fetchImpl = deps.fetchImpl ?? fetch;
    let cachedCredentials = null;
    function normalizeStatic() {
        const apiKey = normalizeText(deps.staticCredentials?.apiKey);
        const baseUrl = normalizeText(deps.staticCredentials?.baseUrl);
        return apiKey && baseUrl ? { apiKey, baseUrl } : null;
    }
    async function resolveGatewayBase() {
        const override = normalizeText(deps.baseUrl);
        if (override)
            return override.replace(/\/+$/, '');
        try {
            const settings = await (0, trafficStore_1.createTrafficStore)(deps.systemHomeDir).readSettings();
            const configured = normalizeText(settings.apiBase);
            if (configured)
                return configured.replace(/\/+$/, '');
        }
        catch {
            // unreadable traffic state falls through to the production default
        }
        return exports.DEFAULT_LLM_RELAY_API_BASE_URL;
    }
    async function fetchJson(input) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), input.timeoutMs);
        let response;
        try {
            response = await fetchImpl(input.url, {
                method: input.method,
                headers: {
                    accept: 'application/json',
                    ...(input.body ? { 'content-type': 'application/json' } : {}),
                    ...input.headers,
                },
                body: input.body ? JSON.stringify(input.body) : undefined,
                signal: controller.signal,
            });
        }
        catch (error) {
            throw new LlmRelayError(`llm relay request failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        finally {
            clearTimeout(timer);
        }
        let payload;
        try {
            payload = await response.json();
        }
        catch {
            payload = null;
        }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            throw new LlmRelayError(`llm relay returned an unreadable response (HTTP ${response.status})`);
        }
        return payload;
    }
    async function bootstrap() {
        const identity = await (0, ownerIdentity_1.readOwnerIdentity)(deps.systemHomeDir);
        const mnemonic = normalizeText(identity?.mnemonic);
        const mvcAddress = normalizeText(identity?.mvcAddress);
        if (!identity || !mnemonic || !mvcAddress) {
            throw new LlmRelayError('local owner identity is missing; run `metabot user ensure` first');
        }
        const timestamp = nowSeconds();
        const { signature } = await (0, mvcMessageSigning_1.signMvcAddressMessage)({
            mnemonic,
            path: normalizeText(identity.path) || deriveIdentity_1.DEFAULT_DERIVATION_PATH,
            message: buildLlmRelayBootstrapMessage(mvcAddress, timestamp),
        });
        const payload = await fetchJson({
            url: `${await resolveGatewayBase()}/v2/assist/llm/bootstrap`,
            method: 'POST',
            headers: {
                'X-Identity-Address': mvcAddress,
                'X-Timestamp': String(timestamp),
                'X-Signature': signature,
            },
            timeoutMs: BOOTSTRAP_TIMEOUT_MS,
        });
        const data = (payload.data ?? {});
        const apiKey = normalizeText(data.apiKey);
        const baseUrl = normalizeText(data.baseUrl);
        if (Number(payload.code) !== 0 || !apiKey || !baseUrl) {
            throw new LlmRelayError(normalizeText(payload.message) || 'llm relay bootstrap returned no apiKey/baseUrl', normalizeText(payload.message) || null);
        }
        const credentials = { apiKey, baseUrl };
        cachedCredentials = credentials;
        await writeRelayFile(deps.systemHomeDir, credentials).catch(() => undefined);
        return credentials;
    }
    async function resolveCredentials() {
        const staticCredentials = normalizeStatic();
        if (staticCredentials)
            return staticCredentials;
        if (cachedCredentials)
            return cachedCredentials;
        const persisted = await readRelayFile(deps.systemHomeDir);
        if (persisted) {
            cachedCredentials = { apiKey: persisted.apiKey, baseUrl: persisted.baseUrl };
            return cachedCredentials;
        }
        return await bootstrap();
    }
    async function invalidateCredentials() {
        cachedCredentials = null;
        await deleteRelayFile(deps.systemHomeDir);
    }
    function normalizeRecognizeResult(payload, emptyMessage) {
        if (Number(payload.code) !== 0) {
            const message = normalizeText(payload.message) || 'vision relay request failed';
            throw new LlmRelayError(`vision relay error: ${message}`, message);
        }
        const data = (payload.data ?? {});
        const content = normalizeText(data.content);
        if (!content)
            throw new LlmRelayError(emptyMessage);
        const usageRaw = (data.usage ?? {});
        const toCount = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
        return {
            content,
            model: normalizeText(data.model),
            remainingToday: typeof data.remainingToday === 'number' ? data.remainingToday : -1,
            usage: {
                promptTokens: toCount(usageRaw.promptTokens),
                completionTokens: toCount(usageRaw.completionTokens),
                totalTokens: toCount(usageRaw.totalTokens),
                imageTokens: toCount(usageRaw.imageTokens),
                estimated: usageRaw.estimated === true,
            },
        };
    }
    async function postRecognizeWithKeyRetry(body, emptyContentMessage) {
        const attempt = async () => {
            const credentials = await resolveCredentials();
            const payload = await fetchJson({
                url: deriveVisionRecognizeUrl(credentials.baseUrl),
                method: 'POST',
                headers: { authorization: `Bearer ${credentials.apiKey}` },
                body,
                timeoutMs: RECOGNIZE_TIMEOUT_MS,
            });
            return normalizeRecognizeResult(payload, emptyContentMessage);
        };
        try {
            return await attempt();
        }
        catch (error) {
            // A code:1 envelope is a successful HTTP response, so the stable
            // "relay key invalid or revoked" surfaces from normalize, not fetch —
            // the whole attempt (fetch + normalize) must sit inside this guard.
            const relayMessage = error instanceof LlmRelayError ? error.relayMessage : null;
            if (relayMessage !== 'relay key invalid or revoked')
                throw error;
            await invalidateCredentials();
            return await attempt();
        }
    }
    async function defaultLoadImageBase64(imagePath) {
        let buffer;
        try {
            buffer = await node_fs_1.promises.readFile(imagePath);
        }
        catch {
            throw new LlmRelayError(`could not read image file: ${imagePath}`);
        }
        if (buffer.length === 0)
            throw new LlmRelayError(`could not read image file: ${imagePath}`);
        const mimeType = imageMimeFor(imagePath, buffer);
        if (buffer.length <= exports.VISION_MAX_IMAGE_BYTES) {
            return { base64: buffer.toString('base64'), bytes: buffer.length, mimeType };
        }
        // Oversized: re-encode to a ≤1280px JPEG when ffmpeg is available.
        const ffmpeg = resolveFfmpegPath();
        if (!ffmpeg) {
            throw new LlmRelayError('image too large (over 8 MiB) and ffmpeg is not available to compress it');
        }
        const tempDir = await makeTempDir();
        try {
            const rawPath = node_path_1.default.join(tempDir, 'input.img');
            await node_fs_1.promises.writeFile(rawPath, buffer);
            const outputPath = node_path_1.default.join(tempDir, 'image.jpg');
            const run = await runFfmpegProcess(buildImageEncodeArgs({ inputPath: rawPath, outputPath }), FFMPEG_TIMEOUT_MS);
            if (run.code !== 0)
                throw new LlmRelayError('ffmpeg image compression failed; use a smaller image');
            const encoded = await node_fs_1.promises.readFile(outputPath);
            if (encoded.length === 0 || encoded.length > exports.VISION_MAX_IMAGE_BYTES) {
                throw new LlmRelayError('image too large after compression; keep images under 8 MiB');
            }
            return { base64: encoded.toString('base64'), bytes: encoded.length, mimeType: 'image/jpeg' };
        }
        finally {
            await removeTempDir(tempDir);
        }
    }
    async function loadImageBase64(imagePath) {
        const impl = deps.loadImageBase64Impl ?? defaultLoadImageBase64;
        try {
            return await impl(imagePath);
        }
        catch (error) {
            if (error instanceof LlmRelayError)
                throw error;
            return null;
        }
    }
    async function transcodeVideoForVision(videoPath) {
        if (deps.transcodeVideoImpl)
            return deps.transcodeVideoImpl(videoPath);
        let durationSec = null;
        const ffmpeg = resolveFfmpegPath();
        if (ffmpeg) {
            try {
                const probe = await runFfmpegProcess(['-hide_banner', '-i', videoPath], 15_000).catch(() => null);
                // `ffmpeg -i` without an output exits non-zero but prints the header.
                durationSec = probe ? parseFfmpegDuration(probe.stderr) : null;
            }
            catch {
                durationSec = null;
            }
        }
        const truncated = durationSec != null && durationSec > exports.VISION_VIDEO_MAX_SECONDS;
        const tempDir = await makeTempDir();
        try {
            const passes = ['standard', 'hard'];
            let lastResult = null;
            for (const pass of passes) {
                const outputPath = node_path_1.default.join(tempDir, `vision-${pass}.mp4`);
                const run = await runFfmpegProcess(buildVideoTranscodeArgs({ inputPath: videoPath, outputPath, maxSeconds: exports.VISION_VIDEO_MAX_SECONDS, pass }), FFMPEG_TIMEOUT_MS);
                if (run.code !== 0) {
                    throw new LlmRelayError(`ffmpeg video compression failed: ${run.stderr.slice(-300)}`);
                }
                const buffer = await node_fs_1.promises.readFile(outputPath).catch(() => null);
                if (buffer && buffer.length > 0) {
                    lastResult = { base64: buffer.toString('base64'), bytes: buffer.length, durationSec, truncated };
                    if (lastResult.bytes <= exports.VISION_VIDEO_MAX_RAW_BYTES)
                        return lastResult;
                }
            }
            if (lastResult)
                return lastResult; // caller rejects oversized payloads
            throw new LlmRelayError('ffmpeg produced no output; the file may not be a valid video');
        }
        finally {
            await removeTempDir(tempDir);
        }
    }
    async function extractAudioFromVideo(videoPath) {
        if (deps.extractAudioImpl)
            return deps.extractAudioImpl(videoPath);
        const tempDir = await makeTempDir();
        const outputPath = node_path_1.default.join(tempDir, 'extracted.mp3');
        const run = await runFfmpegProcess(buildAudioExtractArgs({ inputPath: videoPath, outputPath }), FFMPEG_TIMEOUT_MS);
        if (run.code !== 0) {
            await removeTempDir(tempDir);
            throw new LlmRelayError(`ffmpeg audio extraction failed: ${run.stderr.slice(-300)}`);
        }
        const stat = await node_fs_1.promises.stat(outputPath).catch(() => null);
        if (!stat || stat.size === 0) {
            await removeTempDir(tempDir);
            throw new LlmRelayError('ffmpeg produced no audio track; the video may not contain audio');
        }
        // The caller consumes the file inside the recognize call and removes the
        // temp dir afterwards (see describeAudio).
        return { audioPath: outputPath, mimeType: 'audio/mpeg', bytes: stat.size };
    }
    return {
        resolveCredentials,
        bootstrap,
        async describeImage(input) {
            const loaded = await loadImageBase64(input.path);
            if (!loaded)
                throw new LlmRelayError(`could not read image file: ${input.path}`);
            const body = {
                imageBase64: loaded.base64,
                mimeType: loaded.mimeType ?? 'image/jpeg',
            };
            const prompt = (input.question || '').trim();
            if (prompt)
                body.prompt = prompt;
            return await postRecognizeWithKeyRetry(body, 'vision relay returned no image description');
        },
        async describeVideo(input) {
            const transcoded = await transcodeVideoForVision(input.path);
            if (transcoded.bytes > exports.VISION_VIDEO_MAX_RAW_BYTES) {
                throw new LlmRelayError('video still too large after compression; keep videos under ~3 minutes');
            }
            const body = { videoBase64: transcoded.base64, mimeType: 'video/mp4' };
            const prompt = (input.question || '').trim();
            if (prompt)
                body.prompt = prompt;
            const result = await postRecognizeWithKeyRetry(body, 'vision relay returned no video description');
            return { ...result, truncated: transcoded.truncated, durationSec: transcoded.durationSec };
        },
        async describeAudio(input) {
            const source = (input.source || '').trim();
            const prompt = (input.prompt || '').trim();
            if (!source)
                throw new LlmRelayError('audio source is required (local path, http(s) URL, or data: reference)');
            const body = {};
            const isUrl = /^https?:\/\//i.test(source);
            const isData = /^data:/i.test(source);
            if (isUrl) {
                body.audioUrl = source;
                body.mimeType = inferAudioMimeType(source);
            }
            else if (isData) {
                const base64 = source.replace(/^data:[^;]+;base64,/, '').trim();
                if (!base64 || Buffer.byteLength(base64, 'utf8') > exports.VISION_AUDIO_MAX_BASE64_BYTES) {
                    throw new LlmRelayError('audio payload is invalid or too large; provide valid base64 under 10 MiB');
                }
                body.audioBase64 = base64;
                body.mimeType = inferAudioMimeType('', /data:(audio\/[a-z0-9.+-]+)/i.exec(source)?.[1]);
            }
            else {
                // Local file: a video container routes through audio extraction
                // (relay ASR wants an audio track, not the video bytes).
                if (VIDEO_EXTENSIONS.has(node_path_1.default.extname(source).toLowerCase())) {
                    const extracted = await extractAudioFromVideo(source);
                    try {
                        const buffer = await node_fs_1.promises.readFile(extracted.audioPath);
                        const base64 = buffer.toString('base64');
                        if (buffer.length === 0 || Buffer.byteLength(base64, 'utf8') > exports.VISION_AUDIO_MAX_BASE64_BYTES) {
                            throw new LlmRelayError('audio too large after extraction; shorten the media to keep it under 10 MiB encoded');
                        }
                        body.audioBase64 = base64;
                        body.mimeType = extracted.mimeType;
                    }
                    finally {
                        await removeTempDir(node_path_1.default.dirname(extracted.audioPath));
                    }
                }
                else {
                    let buffer;
                    try {
                        buffer = await node_fs_1.promises.readFile(source);
                    }
                    catch {
                        throw new LlmRelayError(`could not read audio file: ${source}`);
                    }
                    const base64 = buffer.toString('base64');
                    if (buffer.length === 0 || Buffer.byteLength(base64, 'utf8') > exports.VISION_AUDIO_MAX_BASE64_BYTES) {
                        throw new LlmRelayError('audio too large; compress or shorten the audio to keep it under 10 MiB encoded');
                    }
                    const mimeType = AUDIO_MIME_BY_EXTENSION[node_path_1.default.extname(source).toLowerCase()];
                    if (!mimeType) {
                        throw new LlmRelayError('audio payload is invalid (wav/mp3/m4a/ogg/webm supported)');
                    }
                    body.audioBase64 = base64;
                    body.mimeType = mimeType;
                }
            }
            // IDBots-parity default: full verbatim transcription, no summarizing.
            body.prompt = prompt || '请完整转写这段音频，保留原语言、标点和说话内容，不要总结。';
            return await postRecognizeWithKeyRetry(body, 'vision relay returned no audio transcription');
        },
    };
}
/**
 * Map the backend's stable error strings to actionable tool text (IDBots
 * formatVisionRelayError/formatAudioRelayError parity, one table for all
 * kinds).
 */
function formatMediaRelayError(kind, message) {
    const what = kind === 'image' ? 'Image reading' : kind === 'video' ? 'Video watching' : 'Audio transcription';
    const stable = message.startsWith('vision relay error: ') ? message.slice('vision relay error: '.length) : message;
    switch (stable) {
        case 'vision daily quota exhausted':
            return `Daily ${kind} quota used up. The media was NOT read; tell the user ${kind} reading resumes tomorrow.`;
        case 'vision request rate limited':
            return `${what} is rate limited. Wait about a minute, then retry with the same input.`;
        case 'vision daily budget exhausted, try again tomorrow':
            return `The shared media service hit its daily budget. The ${kind} was NOT read; tell the user to try again tomorrow.`;
        case 'imageBase64, imageUrl, audioBase64, audioUrl, videoBase64, or videoUrl is required':
        case 'image payload is invalid':
        case 'audio payload is invalid':
            return `The ${kind} file could not be encoded for the media service. Verify the input is a real ${kind} file.`;
        case 'request body too large':
            return `The ${kind} is too large even after compression. Use a smaller file.`;
        case 'vision relay is disabled':
        case 'no vision model configured':
            return `The media service is not available right now. The ${kind} was NOT read.`;
        case 'relay key invalid or revoked':
            return `The media-reading credential was rejected and could not be renewed. The ${kind} was NOT read.`;
        case 'upstream provider failed, please retry later':
            return `${what} failed upstream. Please retry later.`;
        default:
            return `${what} failed: ${message}`;
    }
}
