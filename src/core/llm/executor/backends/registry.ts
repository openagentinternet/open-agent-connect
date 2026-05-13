import { getRuntimePlatforms, type PlatformExecutorKind } from '../../../platform/platformRegistry';
import { claudeBackendFactory } from './claude';
import { codexBackendFactory } from './codex';
import { copilotBackendFactory } from './copilot';
import { cursorBackendFactory } from './cursor';
import { geminiBackendFactory } from './gemini';
import { hermesBackendFactory } from './hermes';
import { kimiBackendFactory } from './kimi';
import { kiroBackendFactory } from './kiro';
import { openClawBackendFactory } from './openclaw';
import { opencodeBackendFactory } from './opencode';
import { piBackendFactory } from './pi';
import type { LlmBackendFactory } from './backend';

const FACTORY_BY_EXECUTOR_KIND: Record<PlatformExecutorKind, LlmBackendFactory> = {
  'claude-stream-json': claudeBackendFactory,
  'codex-app-server': codexBackendFactory,
  'copilot-json': copilotBackendFactory,
  'opencode-json': opencodeBackendFactory,
  'openclaw-json': openClawBackendFactory,
  'acp-hermes': hermesBackendFactory,
  'gemini-stream-json': geminiBackendFactory,
  'pi-json': piBackendFactory,
  'cursor-stream-json': cursorBackendFactory,
  'acp-kimi': kimiBackendFactory,
  'acp-kiro': kiroBackendFactory,
};

export function createRegistryBackendFactories(): Record<string, LlmBackendFactory> {
  return Object.fromEntries(
    getRuntimePlatforms().map((platform) => [
      platform.id,
      FACTORY_BY_EXECUTOR_KIND[platform.executor.kind],
    ]),
  );
}
