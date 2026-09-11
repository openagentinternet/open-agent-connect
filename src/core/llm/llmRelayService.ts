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

import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readOwnerIdentity } from '../owner/ownerIdentity';
import { signMvcAddressMessage } from '../subsidy/mvcMessageSigning';
import { DEFAULT_DERIVATION_PATH } from '../identity/deriveIdentity';
import { createTrafficStore } from '../traffic/trafficStore';

export const DEFAULT_LLM_RELAY_API_BASE_URL = 'https://www.metaso.network/assist-open-api';

const RELAY_FILE_MODE = 0o600;
const BOOTSTRAP_TIMEOUT_MS = 15_000;
const RECOGNIZE_TIMEOUT_MS = 120_000;
const FFMPEG_TIMEOUT_MS = 120_000;
/** Cap for the post-codec JPEG payload handed to the relay (base64 excluded). */
export const VISION_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** Keep the encoded audio body below the relay's 10 MiB ceiling. */
export const VISION_AUDIO_MAX_BASE64_BYTES = 10 * 1024 * 1024;
/**
 * Target ceiling for a transcoded video's RAW bytes. The upstream accepts
 * base64 up to 10 MB and base64 inflates by ~4/3, so 6.8 MB raw encodes to
 * ~9.1 MB — inside the cap with envelope margin.
 */
export const VISION_VIDEO_MAX_RAW_BYTES = 6.8 * 1024 * 1024;
/** Videos longer than this are truncated (the describe result says so). */
export const VISION_VIDEO_MAX_SECONDS = 180;

// ---------------------------------------------------------------------------
// Spelled-letter stabilization (FIX-4)
// ---------------------------------------------------------------------------

/**
 * Prompt-level instructions cannot stop a stochastic ASR from merging
 * letter-by-letter speech ("O A C") into a plausible word (OOC / OASIS / OIC
 * on consecutive calls of the SAME audio). The pass below is deterministic
 * post-processing instead: suspect all-caps tokens get one format-constrained
 * confirmation call over the same audio (answer must be the letters or the
 * word itself), and an unresolved token marks the transcript low-confidence
 * instead of silently returning a corrupted acronym.
 */

/** All-caps tokens this common are near-always real acronyms — never spend a confirmation call on them. */
const SPELLED_LETTER_CONFIRM_SKIP = new Set([
  'AI', 'API', 'ASCII', 'ASR', 'CLI', 'CPU', 'CSS', 'DNS', 'DVD', 'EOF', 'ETA', 'FAQ', 'FYI', 'GMT', 'GPS',
  'GPU', 'GUI', 'HTML', 'HTTP', 'HTTPS', 'ID', 'IDE', 'IMO', 'IO', 'IP', 'ISO', 'JSON', 'LLM', 'OCR', 'OK',
  'PC', 'PDF', 'PIN', 'RAM', 'RGB', 'SDK', 'SIM', 'SMS', 'SQL', 'SSH', 'TCP', 'TLS', 'TTL', 'TV', 'UDP',
  'UI', 'UK', 'URL', 'US', 'USA', 'USB', 'UTC', 'UUID', 'VPN', 'XML',
]);

/** At most this many confirmation calls per transcription (daily-quota guard). */
export const MAX_SPELLED_LETTER_CONFIRMATIONS = 3;

/**
 * Suspect all-caps runs (2-5 letters) in one transcript, deduped, in order.
 * Hyphenated spelled forms (O-A-C) never match — they contain no 2+ letter
 * run — so a transcript that already kept the letters is left untouched.
 */
export function findSpelledLetterCandidates(content: string): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const match of content.matchAll(/\b[A-Z]{2,5}\b/g)) {
    const token = match[0];
    if (SPELLED_LETTER_CONFIRM_SKIP.has(token) || seen.has(token)) continue;
    seen.add(token);
    candidates.push(token);
  }
  return candidates;
}

/** The format-constrained confirmation prompt for one suspect token. */
export function buildSpelledLetterConfirmationPrompt(candidate: string): string {
  return [
    `这段音频的转写中包含一个不确定的大写片段 "${candidate}"。请只核对音频中该片段对应的发音：`,
    '如果说话者是逐字母念出这组字母，只回答这些字母并用连字符连接（例如 O-A-C）；',
    '如果说话者念的就是这个完整单词/缩写，只回答该单词本身。',
    '不要输出其他任何内容。',
  ].join('');
}

export type SpelledLetterConfirmation =
  | { kind: 'letters'; text: string }
  | { kind: 'word' }
  | { kind: 'unstable'; heard: string }
  | { kind: 'inconclusive' };

/** Parse the confirmation answer: spelled letters win, an echoed word confirms, anything else is honest doubt. */
export function parseSpelledLetterConfirmation(answer: string, candidate: string): SpelledLetterConfirmation {
  const normalized = answer.trim().replace(/^[\s"'`「『“‘]+|[\s"'`」』”’。.!！?？,，;；:：]+$/g, '');
  if (/^[A-Za-z](?:[\s-]+[A-Za-z]){1,9}$/.test(normalized)) {
    return { kind: 'letters', text: normalized.split(/[\s-]+/).join('-').toUpperCase() };
  }
  if (normalized.replace(/[\s-]+/g, '').toUpperCase() === candidate) return { kind: 'word' };
  if (/^[A-Z]{2,6}$/.test(normalized)) return { kind: 'unstable', heard: normalized };
  return { kind: 'inconclusive' };
}

export class LlmRelayError extends Error {
  /** Stable server-side message (backend error contract) when available. */
  readonly relayMessage: string | null;

  constructor(message: string, relayMessage: string | null = null) {
    super(message);
    this.name = 'LlmRelayError';
    this.relayMessage = relayMessage;
  }
}

export interface LlmRelayCredentials {
  apiKey: string;
  baseUrl: string;
}

export interface VisionRelayUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  imageTokens: number;
  estimated: boolean;
}

export interface VisionRelayRecognizeResult {
  content: string;
  model: string;
  remainingToday: number;
  usage: VisionRelayUsage;
}

export interface VisionTranscodeResult {
  /** Base64 of the transcoded mp4 (video/mp4, H.264, no audio). */
  base64: string;
  bytes: number;
  /** Source duration in seconds when probeable. */
  durationSec: number | null;
  /** True when the source exceeded VISION_VIDEO_MAX_SECONDS and was cut. */
  truncated: boolean;
}

export interface LlmRelayServiceDeps {
  /** Machine-wide home dir; the owner identity + relay key cache resolve under it. */
  systemHomeDir: string;
  fetchImpl?: typeof fetch;
  /** Gateway base override (tests, explicit deployments). */
  baseUrl?: string;
  /**
   * Pre-provisioned credentials (e.g. OAC_VISION_RELAY_URL/API_KEY env): when
   * both parts are present no bootstrap runs and no key file is read.
   */
  staticCredentials?: { apiKey?: string; baseUrl?: string };
  /** Reads one local image and returns base64 + size (plus sniffed mime); tests inject. */
  loadImageBase64Impl?: (imagePath: string) => Promise<{ base64: string; bytes: number; mimeType?: string } | null>;
  /** Transcodes one local video to a small mp4; tests inject. */
  transcodeVideoImpl?: (videoPath: string) => Promise<VisionTranscodeResult>;
  /** Extracts one video's audio track as mp3; tests inject. */
  extractAudioImpl?: (videoPath: string) => Promise<{ audioPath: string; mimeType: string; bytes: number }>;
}

export interface LlmRelayService {
  /** Relay credentials (bootstrap + persist on first use); exposes the CLI status line. */
  resolveCredentials(): Promise<LlmRelayCredentials>;
  /** Force a fresh bootstrap (re-signs, rotates the key, persists it). */
  bootstrap(): Promise<LlmRelayCredentials>;
  describeImage(input: { path: string; question?: string }): Promise<VisionRelayRecognizeResult>;
  describeVideo(input: { path: string; question?: string }): Promise<
    VisionRelayRecognizeResult & { truncated: boolean; durationSec: number | null }
  >;
  describeAudio(input: { source: string; prompt?: string }): Promise<VisionRelayRecognizeResult>;
}

/** Canonical bootstrap message (backend llm_relay/message.go — do not change). */
export function buildLlmRelayBootstrapMessage(identityAddress: string, timestamp: number): string {
  return `llm-relay-bootstrap:${identityAddress}:${timestamp}`;
}

/**
 * Derive the recognize endpoint from a relay-supplied chat baseUrl
 * (`.../v2/assist/llm/v1` -> `.../v2/assist/llm/vision/recognize`). Tolerant
 * of an explicit recognize URL or a bare gateway base so static deployments
 * and env overrides keep working.
 */
export function deriveVisionRecognizeUrl(baseUrl: string): string {
  const base = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) throw new LlmRelayError('llm relay baseUrl is empty');
  if (base.endsWith('/vision/recognize')) return base;
  const stem = base.endsWith('/v1') ? base.slice(0, -'/v1'.length) : base;
  if (stem.endsWith('/llm')) return `${stem}/vision/recognize`;
  if (stem.endsWith('/v2/assist/llm')) return `${stem}/vision/recognize`;
  if (stem.endsWith('/assist-open-api') || /\/v\d+\/assist$/.test(stem)) {
    return `${stem}/llm/vision/recognize`;
  }
  // Bare gateway base (e.g. https://www.metaso.network/assist-open-api handled
  // above); any other custom gateway gets the full documented path appended.
  return `${stem}/v2/assist/llm/vision/recognize`;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// ---------------------------------------------------------------------------
// Media typing helpers
// ---------------------------------------------------------------------------

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const AUDIO_MIME_BY_EXTENSION: Record<string, string> = {
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

export function inferAudioMimeType(reference: string, explicit?: string): string {
  const provided = explicit?.trim().toLowerCase();
  if (provided) return provided;
  try {
    const extension = path.extname(new URL(reference).pathname).toLowerCase();
    if (AUDIO_MIME_BY_EXTENSION[extension]) return AUDIO_MIME_BY_EXTENSION[extension];
  } catch {
    // Local paths are handled below.
  }
  return AUDIO_MIME_BY_EXTENSION[path.extname(reference).toLowerCase()] ?? 'audio/wav';
}

/** Sniff an image MIME from magic bytes; null when the buffer is no known image. */
export function sniffImageMime(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.length >= 6 && (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a')) return 'image/gif';
  return null;
}

function imageMimeFor(file: string, buffer: Buffer): string {
  return IMAGE_MIME_BY_EXTENSION[path.extname(file).toLowerCase()] ?? sniffImageMime(buffer)
    ?? (() => { throw new LlmRelayError(`unsupported image format: ${file} (jpeg/png/webp/gif only)`); })();
}

// ---------------------------------------------------------------------------
// ffmpeg layer (system binary; optional)
// ---------------------------------------------------------------------------

let cachedFfmpegPath: string | null | undefined;

/**
 * Resolve the ffmpeg binary. Order: `OAC_FFMPEG_PATH`, then `ffmpeg` on PATH
 * (verified once with `-version`). OAC does not bundle ffmpeg like IDBots
 * does; video transcoding and audio extraction degrade gracefully when the
 * binary is unavailable.
 */
export function resolveFfmpegPath(): string | null {
  if (cachedFfmpegPath !== undefined) return cachedFfmpegPath;
  cachedFfmpegPath = null;
  const envPath = (process.env.OAC_FFMPEG_PATH || '').trim();
  const candidate = envPath || 'ffmpeg';
  try {
    const probe = spawnSync(candidate, ['-version'], { timeout: 10_000 });
    cachedFfmpegPath = probe.status === 0 ? candidate : null;
  } catch {
    cachedFfmpegPath = null;
  }
  return cachedFfmpegPath;
}

async function runFfmpegProcess(args: string[], timeoutMs: number): Promise<{ code: number | null; stderr: string }> {
  const ffmpeg = resolveFfmpegPath();
  if (!ffmpeg) throw new LlmRelayError('ffmpeg is not available (install ffmpeg or set OAC_FFMPEG_PATH)');
  return await new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new LlmRelayError(`ffmpeg timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 8192) stderr = stderr.slice(-4096);
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
export function parseFfmpegDuration(stderr: string): number | null {
  const match = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

async function makeTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'oac-media-'));
}

async function removeTempDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // best-effort temp cleanup
  }
}

/**
 * ffmpeg args that re-encode one image to a ≤1280px JPEG (same output shape
 * as the IDBots pipeline). Exported for tests.
 */
export function buildImageEncodeArgs(input: { inputPath: string; outputPath: string }): string[] {
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
export function buildVideoTranscodeArgs(input: {
  inputPath: string;
  outputPath: string;
  maxSeconds: number;
  pass: 'standard' | 'hard';
}): string[] {
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
export function buildAudioExtractArgs(input: { inputPath: string; outputPath: string }): string[] {
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

// ---------------------------------------------------------------------------
// Credential file (~/.metabot/owner/llm-relay.json)
// ---------------------------------------------------------------------------

interface RelayFileState {
  version: 1;
  apiKey: string;
  baseUrl: string;
  updatedAt: number;
}

function relayFilePath(systemHomeDir: string): string {
  return path.join(path.resolve(systemHomeDir), '.metabot', 'owner', 'llm-relay.json');
}

async function readRelayFile(systemHomeDir: string): Promise<RelayFileState | null> {
  try {
    const raw = await fs.readFile(relayFilePath(systemHomeDir), 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const apiKey = normalizeText(parsed.apiKey);
    const baseUrl = normalizeText(parsed.baseUrl);
    if (apiKey && baseUrl) return { version: 1, apiKey, baseUrl, updatedAt: Number(parsed.updatedAt) || 0 };
  } catch {
    // unreadable/missing file falls through to bootstrap
  }
  return null;
}

async function writeRelayFile(systemHomeDir: string, credentials: LlmRelayCredentials): Promise<void> {
  const filePath = relayFilePath(systemHomeDir);
  const state: RelayFileState = { version: 1, ...credentials, updatedAt: Date.now() };
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: RELAY_FILE_MODE });
    await fs.rename(tempPath, filePath);
    if (process.platform !== 'win32') {
      await fs.chmod(filePath, RELAY_FILE_MODE).catch(() => undefined);
    }
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

async function deleteRelayFile(systemHomeDir: string): Promise<void> {
  try {
    await fs.rm(relayFilePath(systemHomeDir), { force: true });
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function createLlmRelayService(deps: LlmRelayServiceDeps): LlmRelayService {
  const fetchImpl = deps.fetchImpl ?? fetch;
  let cachedCredentials: LlmRelayCredentials | null = null;

  function normalizeStatic(): LlmRelayCredentials | null {
    const apiKey = normalizeText(deps.staticCredentials?.apiKey);
    const baseUrl = normalizeText(deps.staticCredentials?.baseUrl);
    return apiKey && baseUrl ? { apiKey, baseUrl } : null;
  }

  async function resolveGatewayBase(): Promise<string> {
    const override = normalizeText(deps.baseUrl);
    if (override) return override.replace(/\/+$/, '');
    try {
      const settings = await createTrafficStore(deps.systemHomeDir).readSettings();
      const configured = normalizeText(settings.apiBase);
      if (configured) return configured.replace(/\/+$/, '');
    } catch {
      // unreadable traffic state falls through to the production default
    }
    return DEFAULT_LLM_RELAY_API_BASE_URL;
  }

  async function fetchJson(input: {
    url: string;
    method: 'GET' | 'POST';
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
    timeoutMs: number;
  }): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);
    let response: Response;
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
    } catch (error) {
      throw new LlmRelayError(`llm relay request failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new LlmRelayError(`llm relay returned an unreadable response (HTTP ${response.status})`);
    }
    return payload as Record<string, unknown>;
  }

  async function bootstrap(): Promise<LlmRelayCredentials> {
    const identity = await readOwnerIdentity(deps.systemHomeDir);
    const mnemonic = normalizeText(identity?.mnemonic);
    const mvcAddress = normalizeText(identity?.mvcAddress);
    if (!identity || !mnemonic || !mvcAddress) {
      throw new LlmRelayError('local owner identity is missing; run `metabot user ensure` first');
    }
    const timestamp = nowSeconds();
    const { signature } = await signMvcAddressMessage({
      mnemonic,
      path: normalizeText(identity.path) || DEFAULT_DERIVATION_PATH,
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
    const data = (payload.data ?? {}) as Record<string, unknown>;
    const apiKey = normalizeText(data.apiKey);
    const baseUrl = normalizeText(data.baseUrl);
    if (Number(payload.code) !== 0 || !apiKey || !baseUrl) {
      throw new LlmRelayError(
        normalizeText(payload.message) || 'llm relay bootstrap returned no apiKey/baseUrl',
        normalizeText(payload.message) || null,
      );
    }
    const credentials = { apiKey, baseUrl };
    cachedCredentials = credentials;
    await writeRelayFile(deps.systemHomeDir, credentials).catch(() => undefined);
    return credentials;
  }

  async function resolveCredentials(): Promise<LlmRelayCredentials> {
    const staticCredentials = normalizeStatic();
    if (staticCredentials) return staticCredentials;
    if (cachedCredentials) return cachedCredentials;
    const persisted = await readRelayFile(deps.systemHomeDir);
    if (persisted) {
      cachedCredentials = { apiKey: persisted.apiKey, baseUrl: persisted.baseUrl };
      return cachedCredentials;
    }
    return await bootstrap();
  }

  async function invalidateCredentials(): Promise<void> {
    cachedCredentials = null;
    await deleteRelayFile(deps.systemHomeDir);
  }

  function normalizeRecognizeResult(payload: Record<string, unknown>, emptyMessage: string): VisionRelayRecognizeResult {
    if (Number(payload.code) !== 0) {
      const message = normalizeText(payload.message) || 'vision relay request failed';
      throw new LlmRelayError(`vision relay error: ${message}`, message);
    }
    const data = (payload.data ?? {}) as Record<string, unknown>;
    const content = normalizeText(data.content);
    if (!content) throw new LlmRelayError(emptyMessage);
    const usageRaw = (data.usage ?? {}) as Record<string, unknown>;
    const toCount = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
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

  async function postRecognizeWithKeyRetry(
    body: Record<string, unknown>,
    emptyContentMessage: string,
  ): Promise<VisionRelayRecognizeResult> {
    const attempt = async (): Promise<VisionRelayRecognizeResult> => {
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
    } catch (error) {
      // A code:1 envelope is a successful HTTP response, so the stable
      // "relay key invalid or revoked" surfaces from normalize, not fetch —
      // the whole attempt (fetch + normalize) must sit inside this guard.
      const relayMessage = error instanceof LlmRelayError ? error.relayMessage : null;
      if (relayMessage !== 'relay key invalid or revoked') throw error;
      await invalidateCredentials();
      return await attempt();
    }
  }

  /**
   * FIX-4: deterministic post-processing for letter-by-letter speech. Each
   * suspect all-caps token gets one format-constrained confirmation call over
   * the same audio; a confirmed spelling replaces the merged word, and an
   * unresolved token marks the transcript low-confidence instead of passing
   * corruption off as a clean result.
   */
  async function stabilizeSpelledLetters(
    result: VisionRelayRecognizeResult,
    audioBody: Record<string, unknown>,
  ): Promise<VisionRelayRecognizeResult> {
    const candidates = findSpelledLetterCandidates(result.content).slice(0, MAX_SPELLED_LETTER_CONFIRMATIONS);
    if (candidates.length === 0) return result;
    let content = result.content;
    const notes: string[] = [];
    for (const candidate of candidates) {
      let parsed: SpelledLetterConfirmation;
      try {
        const confirmation = await postRecognizeWithKeyRetry(
          { ...audioBody, prompt: buildSpelledLetterConfirmationPrompt(candidate) },
          'vision relay returned no audio transcription',
        );
        parsed = parseSpelledLetterConfirmation(confirmation.content, candidate);
      } catch {
        parsed = { kind: 'inconclusive' };
      }
      if (parsed.kind === 'letters') {
        content = content.replace(new RegExp(`(?<![A-Za-z])${candidate}(?![A-Za-z])`, 'g'), parsed.text);
      } else if (parsed.kind === 'unstable') {
        notes.push(`the all-caps sequence "${candidate}" was not stably recognized (also heard as "${parsed.heard}")`);
      } else if (parsed.kind === 'inconclusive') {
        notes.push(`the all-caps sequence "${candidate}" could not be confirmed as a word or as spelled-out letters`);
      }
    }
    if (notes.length === 0) return { ...result, content };
    return { ...result, content: `${content}\n[low-confidence] ${notes.join('; ')} — verify against the audio.` };
  }

  async function defaultLoadImageBase64(imagePath: string): Promise<{ base64: string; bytes: number; mimeType?: string } | null> {
    let buffer: Buffer;
    try {
      buffer = await fs.readFile(imagePath);
    } catch {
      throw new LlmRelayError(`could not read image file: ${imagePath}`);
    }
    if (buffer.length === 0) throw new LlmRelayError(`could not read image file: ${imagePath}`);
    const mimeType = imageMimeFor(imagePath, buffer);
    if (buffer.length <= VISION_MAX_IMAGE_BYTES) {
      return { base64: buffer.toString('base64'), bytes: buffer.length, mimeType };
    }
    // Oversized: re-encode to a ≤1280px JPEG when ffmpeg is available.
    const ffmpeg = resolveFfmpegPath();
    if (!ffmpeg) {
      throw new LlmRelayError('image too large (over 8 MiB) and ffmpeg is not available to compress it');
    }
    const tempDir = await makeTempDir();
    try {
      const rawPath = path.join(tempDir, 'input.img');
      await fs.writeFile(rawPath, buffer);
      const outputPath = path.join(tempDir, 'image.jpg');
      const run = await runFfmpegProcess(buildImageEncodeArgs({ inputPath: rawPath, outputPath }), FFMPEG_TIMEOUT_MS);
      if (run.code !== 0) throw new LlmRelayError('ffmpeg image compression failed; use a smaller image');
      const encoded = await fs.readFile(outputPath);
      if (encoded.length === 0 || encoded.length > VISION_MAX_IMAGE_BYTES) {
        throw new LlmRelayError('image too large after compression; keep images under 8 MiB');
      }
      return { base64: encoded.toString('base64'), bytes: encoded.length, mimeType: 'image/jpeg' };
    } finally {
      await removeTempDir(tempDir);
    }
  }

  async function loadImageBase64(imagePath: string): Promise<{ base64: string; bytes: number; mimeType?: string } | null> {
    const impl = deps.loadImageBase64Impl ?? defaultLoadImageBase64;
    try {
      return await impl(imagePath);
    } catch (error) {
      if (error instanceof LlmRelayError) throw error;
      return null;
    }
  }

  async function transcodeVideoForVision(videoPath: string): Promise<VisionTranscodeResult> {
    if (deps.transcodeVideoImpl) return deps.transcodeVideoImpl(videoPath);
    let durationSec: number | null = null;
    const ffmpeg = resolveFfmpegPath();
    if (ffmpeg) {
      try {
        const probe = await runFfmpegProcess(['-hide_banner', '-i', videoPath], 15_000).catch(() => null);
        // `ffmpeg -i` without an output exits non-zero but prints the header.
        durationSec = probe ? parseFfmpegDuration(probe.stderr) : null;
      } catch {
        durationSec = null;
      }
    }
    const truncated = durationSec != null && durationSec > VISION_VIDEO_MAX_SECONDS;
    const tempDir = await makeTempDir();
    try {
      const passes: Array<'standard' | 'hard'> = ['standard', 'hard'];
      let lastResult: VisionTranscodeResult | null = null;
      for (const pass of passes) {
        const outputPath = path.join(tempDir, `vision-${pass}.mp4`);
        const run = await runFfmpegProcess(
          buildVideoTranscodeArgs({ inputPath: videoPath, outputPath, maxSeconds: VISION_VIDEO_MAX_SECONDS, pass }),
          FFMPEG_TIMEOUT_MS,
        );
        if (run.code !== 0) {
          throw new LlmRelayError(`ffmpeg video compression failed: ${run.stderr.slice(-300)}`);
        }
        const buffer = await fs.readFile(outputPath).catch(() => null);
        if (buffer && buffer.length > 0) {
          lastResult = { base64: buffer.toString('base64'), bytes: buffer.length, durationSec, truncated };
          if (lastResult.bytes <= VISION_VIDEO_MAX_RAW_BYTES) return lastResult;
        }
      }
      if (lastResult) return lastResult; // caller rejects oversized payloads
      throw new LlmRelayError('ffmpeg produced no output; the file may not be a valid video');
    } finally {
      await removeTempDir(tempDir);
    }
  }

  async function extractAudioFromVideo(videoPath: string): Promise<{ audioPath: string; mimeType: string; bytes: number }> {
    if (deps.extractAudioImpl) return deps.extractAudioImpl(videoPath);
    const tempDir = await makeTempDir();
    const outputPath = path.join(tempDir, 'extracted.mp3');
    const run = await runFfmpegProcess(
      buildAudioExtractArgs({ inputPath: videoPath, outputPath }),
      FFMPEG_TIMEOUT_MS,
    );
    if (run.code !== 0) {
      await removeTempDir(tempDir);
      throw new LlmRelayError(`ffmpeg audio extraction failed: ${run.stderr.slice(-300)}`);
    }
    const stat = await fs.stat(outputPath).catch(() => null);
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

    async describeImage(input): Promise<VisionRelayRecognizeResult> {
      const loaded = await loadImageBase64(input.path);
      if (!loaded) throw new LlmRelayError(`could not read image file: ${input.path}`);
      const body: Record<string, unknown> = {
        imageBase64: loaded.base64,
        mimeType: loaded.mimeType ?? 'image/jpeg',
      };
      const prompt = (input.question || '').trim();
      if (prompt) body.prompt = prompt;
      return await postRecognizeWithKeyRetry(body, 'vision relay returned no image description');
    },

    async describeVideo(input) {
      const transcoded = await transcodeVideoForVision(input.path);
      if (transcoded.bytes > VISION_VIDEO_MAX_RAW_BYTES) {
        throw new LlmRelayError('video still too large after compression; keep videos under ~3 minutes');
      }
      const body: Record<string, unknown> = { videoBase64: transcoded.base64, mimeType: 'video/mp4' };
      const prompt = (input.question || '').trim();
      if (prompt) body.prompt = prompt;
      const result = await postRecognizeWithKeyRetry(body, 'vision relay returned no video description');
      return { ...result, truncated: transcoded.truncated, durationSec: transcoded.durationSec };
    },

    async describeAudio(input) {
      const source = (input.source || '').trim();
      const prompt = (input.prompt || '').trim();
      if (!source) throw new LlmRelayError('audio source is required (local path, http(s) URL, or data: reference)');
      const body: Record<string, unknown> = {};
      const isUrl = /^https?:\/\//i.test(source);
      const isData = /^data:/i.test(source);
      if (isUrl) {
        body.audioUrl = source;
        body.mimeType = inferAudioMimeType(source);
      } else if (isData) {
        const base64 = source.replace(/^data:[^;]+;base64,/, '').trim();
        if (!base64 || Buffer.byteLength(base64, 'utf8') > VISION_AUDIO_MAX_BASE64_BYTES) {
          throw new LlmRelayError('audio payload is invalid or too large; provide valid base64 under 10 MiB');
        }
        body.audioBase64 = base64;
        body.mimeType = inferAudioMimeType('', /data:(audio\/[a-z0-9.+-]+)/i.exec(source)?.[1]);
      } else {
        // Local file: a video container routes through audio extraction
        // (relay ASR wants an audio track, not the video bytes).
        if (VIDEO_EXTENSIONS.has(path.extname(source).toLowerCase())) {
          const extracted = await extractAudioFromVideo(source);
          try {
            const buffer = await fs.readFile(extracted.audioPath);
            const base64 = buffer.toString('base64');
            if (buffer.length === 0 || Buffer.byteLength(base64, 'utf8') > VISION_AUDIO_MAX_BASE64_BYTES) {
              throw new LlmRelayError('audio too large after extraction; shorten the media to keep it under 10 MiB encoded');
            }
            body.audioBase64 = base64;
            body.mimeType = extracted.mimeType;
          } finally {
            await removeTempDir(path.dirname(extracted.audioPath));
          }
        } else {
          let buffer: Buffer;
          try {
            buffer = await fs.readFile(source);
          } catch {
            throw new LlmRelayError(`could not read audio file: ${source}`);
          }
          const base64 = buffer.toString('base64');
          if (buffer.length === 0 || Buffer.byteLength(base64, 'utf8') > VISION_AUDIO_MAX_BASE64_BYTES) {
            throw new LlmRelayError('audio too large; compress or shorten the audio to keep it under 10 MiB encoded');
          }
          const mimeType = AUDIO_MIME_BY_EXTENSION[path.extname(source).toLowerCase()];
          if (!mimeType) {
            throw new LlmRelayError('audio payload is invalid (wav/mp3/m4a/ogg/webm supported)');
          }
          body.audioBase64 = base64;
          body.mimeType = mimeType;
        }
      }
      // IDBots-parity default: full verbatim transcription, no summarizing.
      // Letter-by-letter spoken sequences (O A C) must survive as O-A-C —
      // merging them into a new word (OOC) silently corrupts acronyms.
      body.prompt = prompt || '请完整转写这段音频，保留原语言、标点和说话内容，不要总结。逐字母念出的字母序列按连字符保留（例如 "O A C" 转写为 O-A-C），绝不能把逐个念出的字母合并成新词。';
      const result = await postRecognizeWithKeyRetry(body, 'vision relay returned no audio transcription');
      return await stabilizeSpelledLetters(result, body);
    },
  };
}

// ---------------------------------------------------------------------------
// Friendly error mapping shared by the CLI and host tools
// ---------------------------------------------------------------------------

export type MediaKind = 'image' | 'video' | 'audio';

/**
 * Map the backend's stable error strings to actionable tool text (IDBots
 * formatVisionRelayError/formatAudioRelayError parity, one table for all
 * kinds).
 */
export function formatMediaRelayError(kind: MediaKind, message: string): string {
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
