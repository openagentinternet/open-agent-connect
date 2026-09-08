/**
 * `metabot media …` — media description through the MetaID free LLM relay
 * (assist-base-service /v2/assist/llm/vision/recognize): one image, video, or
 * audio file becomes a text description / transcription, owner-identity
 * bootstrapped like the traffic verbs (no --from; the relay key is cached in
 * ~/.metabot/owner/llm-relay.json). Backs the DSH describe_image /
 * describe_video / describe_audio tools and gives humans/other hosts the same
 * capability CLI-first.
 */
import { type MetabotCommandResult } from '../../core/contracts/commandResult';
import type { CliRuntimeContext } from '../types';
export declare function runMediaCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>>;
