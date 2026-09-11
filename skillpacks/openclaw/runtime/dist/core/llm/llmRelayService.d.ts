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
export declare const DEFAULT_LLM_RELAY_API_BASE_URL = "https://www.metaso.network/assist-open-api";
/** Cap for the post-codec JPEG payload handed to the relay (base64 excluded). */
export declare const VISION_MAX_IMAGE_BYTES: number;
/** Keep the encoded audio body below the relay's 10 MiB ceiling. */
export declare const VISION_AUDIO_MAX_BASE64_BYTES: number;
/**
 * Target ceiling for a transcoded video's RAW bytes. The upstream accepts
 * base64 up to 10 MB and base64 inflates by ~4/3, so 6.8 MB raw encodes to
 * ~9.1 MB — inside the cap with envelope margin.
 */
export declare const VISION_VIDEO_MAX_RAW_BYTES: number;
/** Videos longer than this are truncated (the describe result says so). */
export declare const VISION_VIDEO_MAX_SECONDS = 180;
/** At most this many confirmation calls per transcription (daily-quota guard). */
export declare const MAX_SPELLED_LETTER_CONFIRMATIONS = 3;
/**
 * Suspect all-caps runs (2-5 letters) in one transcript, deduped, in order.
 * Hyphenated spelled forms (O-A-C) never match — they contain no 2+ letter
 * run — so a transcript that already kept the letters is left untouched.
 */
export declare function findSpelledLetterCandidates(content: string): string[];
/** The format-constrained confirmation prompt for one suspect token. */
export declare function buildSpelledLetterConfirmationPrompt(candidate: string): string;
export type SpelledLetterConfirmation = {
    kind: 'letters';
    text: string;
} | {
    kind: 'word';
} | {
    kind: 'unstable';
    heard: string;
} | {
    kind: 'inconclusive';
};
/** Parse the confirmation answer: spelled letters win, an echoed word confirms, anything else is honest doubt. */
export declare function parseSpelledLetterConfirmation(answer: string, candidate: string): SpelledLetterConfirmation;
export declare class LlmRelayError extends Error {
    /** Stable server-side message (backend error contract) when available. */
    readonly relayMessage: string | null;
    constructor(message: string, relayMessage?: string | null);
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
    staticCredentials?: {
        apiKey?: string;
        baseUrl?: string;
    };
    /** Reads one local image and returns base64 + size (plus sniffed mime); tests inject. */
    loadImageBase64Impl?: (imagePath: string) => Promise<{
        base64: string;
        bytes: number;
        mimeType?: string;
    } | null>;
    /** Transcodes one local video to a small mp4; tests inject. */
    transcodeVideoImpl?: (videoPath: string) => Promise<VisionTranscodeResult>;
    /** Extracts one video's audio track as mp3; tests inject. */
    extractAudioImpl?: (videoPath: string) => Promise<{
        audioPath: string;
        mimeType: string;
        bytes: number;
    }>;
}
export interface LlmRelayService {
    /** Relay credentials (bootstrap + persist on first use); exposes the CLI status line. */
    resolveCredentials(): Promise<LlmRelayCredentials>;
    /** Force a fresh bootstrap (re-signs, rotates the key, persists it). */
    bootstrap(): Promise<LlmRelayCredentials>;
    describeImage(input: {
        path: string;
        question?: string;
    }): Promise<VisionRelayRecognizeResult>;
    describeVideo(input: {
        path: string;
        question?: string;
    }): Promise<VisionRelayRecognizeResult & {
        truncated: boolean;
        durationSec: number | null;
    }>;
    describeAudio(input: {
        source: string;
        prompt?: string;
    }): Promise<VisionRelayRecognizeResult>;
}
/** Canonical bootstrap message (backend llm_relay/message.go — do not change). */
export declare function buildLlmRelayBootstrapMessage(identityAddress: string, timestamp: number): string;
/**
 * Derive the recognize endpoint from a relay-supplied chat baseUrl
 * (`.../v2/assist/llm/v1` -> `.../v2/assist/llm/vision/recognize`). Tolerant
 * of an explicit recognize URL or a bare gateway base so static deployments
 * and env overrides keep working.
 */
export declare function deriveVisionRecognizeUrl(baseUrl: string): string;
export declare function inferAudioMimeType(reference: string, explicit?: string): string;
/** Sniff an image MIME from magic bytes; null when the buffer is no known image. */
export declare function sniffImageMime(buffer: Buffer): string | null;
/**
 * Resolve the ffmpeg binary. Order: `OAC_FFMPEG_PATH`, then `ffmpeg` on PATH
 * (verified once with `-version`). OAC does not bundle ffmpeg like IDBots
 * does; video transcoding and audio extraction degrade gracefully when the
 * binary is unavailable.
 */
export declare function resolveFfmpegPath(): string | null;
/** Parse the source duration (seconds) out of an `ffmpeg -i` stderr probe. */
export declare function parseFfmpegDuration(stderr: string): number | null;
/**
 * ffmpeg args that re-encode one image to a ≤1280px JPEG (same output shape
 * as the IDBots pipeline). Exported for tests.
 */
export declare function buildImageEncodeArgs(input: {
    inputPath: string;
    outputPath: string;
}): string[];
/**
 * ffmpeg args for one video transcode pass. Recognition clips are throwaway:
 * tiny resolution, low fps, no audio, high CRF — the upstream samples
 * 2 frames/second regardless, so visual fidelity only needs to survive 480px.
 * Exported for tests.
 */
export declare function buildVideoTranscodeArgs(input: {
    inputPath: string;
    outputPath: string;
    maxSeconds: number;
    pass: 'standard' | 'hard';
}): string[];
/** ffmpeg args that extract a video's audio track as 16 kHz mono mp3. Exported for tests. */
export declare function buildAudioExtractArgs(input: {
    inputPath: string;
    outputPath: string;
}): string[];
export declare function createLlmRelayService(deps: LlmRelayServiceDeps): LlmRelayService;
export type MediaKind = 'image' | 'video' | 'audio';
/**
 * Map the backend's stable error strings to actionable tool text (IDBots
 * formatVisionRelayError/formatAudioRelayError parity, one table for all
 * kinds).
 */
export declare function formatMediaRelayError(kind: MediaKind, message: string): string;
