"use strict";
/**
 * `metabot media …` — media description through the MetaID free LLM relay
 * (assist-base-service /v2/assist/llm/vision/recognize): one image, video, or
 * audio file becomes a text description / transcription, owner-identity
 * bootstrapped like the traffic verbs (no --from; the relay key is cached in
 * ~/.metabot/owner/llm-relay.json). Backs the DSH describe_image /
 * describe_video / describe_audio tools and gives humans/other hosts the same
 * capability CLI-first.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMediaCommand = runMediaCommand;
const node_path_1 = __importDefault(require("node:path"));
const commandResult_1 = require("../../core/contracts/commandResult");
const llmRelayService_1 = require("../../core/llm/llmRelayService");
const homeSelection_1 = require("../../core/state/homeSelection");
const helpers_1 = require("./helpers");
function mediaKindOf(subcommand) {
    if (subcommand === 'image' || subcommand === 'video' || subcommand === 'audio')
        return subcommand;
    return null;
}
async function runMediaCommand(args, context) {
    const subcommand = args[0];
    if (subcommand === 'describe') {
        const kind = mediaKindOf(args[1]);
        if (!kind) {
            return (0, commandResult_1.commandFailed)('invalid_argument', `Unknown media kind: ${args[1] ?? '(none)'}. Usage: metabot media describe <image|video|audio> --path <file|url>`);
        }
        const source = (0, helpers_1.readFlagValue)(args, '--path') ?? (0, helpers_1.readFlagValue)(args, '--source');
        if (!source)
            return (0, helpers_1.commandMissingFlag)(kind === 'audio' ? '--path (or --source)' : '--path');
        const question = (0, helpers_1.readFlagValue)(args, '--question') ?? (0, helpers_1.readFlagValue)(args, '--prompt');
        const relay = (0, llmRelayService_1.createLlmRelayService)({
            systemHomeDir: (0, homeSelection_1.normalizeSystemHomeDir)(context.env, context.cwd),
            ...(context.env.OAC_VISION_RELAY_URL?.trim() && context.env.OAC_VISION_RELAY_API_KEY?.trim()
                ? {
                    staticCredentials: {
                        baseUrl: context.env.OAC_VISION_RELAY_URL.trim(),
                        apiKey: context.env.OAC_VISION_RELAY_API_KEY.trim(),
                    },
                }
                : {}),
        });
        try {
            if (kind === 'audio') {
                if (!/^https?:\/\//i.test(source) && !/^data:/i.test(source) && !node_path_1.default.isAbsolute(source)) {
                    return (0, commandResult_1.commandFailed)('invalid_argument', `--path must be absolute for local audio files; received "${source}".`);
                }
                const result = await relay.describeAudio({ source, prompt: question ?? undefined });
                return (0, commandResult_1.commandSuccess)({ kind, ...result });
            }
            if (!node_path_1.default.isAbsolute(source)) {
                return (0, commandResult_1.commandFailed)('invalid_argument', `--path must be an absolute local path for ${kind} files; received "${source}".`);
            }
            const result = kind === 'image'
                ? await relay.describeImage({ path: source, question: question ?? undefined })
                : await relay.describeVideo({ path: source, question: question ?? undefined });
            return (0, commandResult_1.commandSuccess)({ kind, ...result });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return (0, commandResult_1.commandFailed)('media_describe_failed', (0, llmRelayService_1.formatMediaRelayError)(kind, message));
        }
    }
    return (0, helpers_1.commandUnknownSubcommand)(`media ${args.join(' ')}`.trim());
}
