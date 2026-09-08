/**
 * `metabot media …` — media description through the MetaID free LLM relay
 * (assist-base-service /v2/assist/llm/vision/recognize): one image, video, or
 * audio file becomes a text description / transcription, owner-identity
 * bootstrapped like the traffic verbs (no --from; the relay key is cached in
 * ~/.metabot/owner/llm-relay.json). Backs the DSH describe_image /
 * describe_video / describe_audio tools and gives humans/other hosts the same
 * capability CLI-first.
 */

import path from 'node:path';
import { commandFailed, commandSuccess, type MetabotCommandResult } from '../../core/contracts/commandResult';
import {
  createLlmRelayService,
  formatMediaRelayError,
  type MediaKind,
} from '../../core/llm/llmRelayService';
import { normalizeSystemHomeDir } from '../../core/state/homeSelection';
import { commandMissingFlag, commandUnknownSubcommand, readFlagValue } from './helpers';
import type { CliRuntimeContext } from '../types';

function mediaKindOf(subcommand: string | undefined): MediaKind | null {
  if (subcommand === 'image' || subcommand === 'video' || subcommand === 'audio') return subcommand;
  return null;
}

export async function runMediaCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>> {
  const subcommand = args[0];

  if (subcommand === 'describe') {
    const kind = mediaKindOf(args[1]);
    if (!kind) {
      return commandFailed(
        'invalid_argument',
        `Unknown media kind: ${args[1] ?? '(none)'}. Usage: metabot media describe <image|video|audio> --path <file|url>`,
      );
    }
    const source = readFlagValue(args, '--path') ?? readFlagValue(args, '--source');
    if (!source) return commandMissingFlag(kind === 'audio' ? '--path (or --source)' : '--path');
    const question = readFlagValue(args, '--question') ?? readFlagValue(args, '--prompt');
    const relay = createLlmRelayService({
      systemHomeDir: normalizeSystemHomeDir(context.env, context.cwd),
      ...(context.env.OAC_VISION_RELAY_URL?.trim() && context.env.OAC_VISION_RELAY_API_KEY?.trim()
        ? {
          staticCredentials: {
            baseUrl: context.env.OAC_VISION_RELAY_URL!.trim(),
            apiKey: context.env.OAC_VISION_RELAY_API_KEY!.trim(),
          },
        }
        : {}),
    });
    try {
      if (kind === 'audio') {
        if (!/^https?:\/\//i.test(source) && !/^data:/i.test(source) && !path.isAbsolute(source)) {
          return commandFailed('invalid_argument', `--path must be absolute for local audio files; received "${source}".`);
        }
        const result = await relay.describeAudio({ source, prompt: question ?? undefined });
        return commandSuccess({ kind, ...result });
      }
      if (!path.isAbsolute(source)) {
        return commandFailed('invalid_argument', `--path must be an absolute local path for ${kind} files; received "${source}".`);
      }
      const result = kind === 'image'
        ? await relay.describeImage({ path: source, question: question ?? undefined })
        : await relay.describeVideo({ path: source, question: question ?? undefined });
      return commandSuccess({ kind, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return commandFailed('media_describe_failed', formatMediaRelayError(kind, message));
    }
  }

  return commandUnknownSubcommand(`media ${args.join(' ')}`.trim());
}
