#!/usr/bin/env node
/**
 * One-shot live verification of the LLM runtime platforms OAC claims to
 * support. Runs the real discovery pipeline (version probe + readiness
 * one-shot "Reply exactly OK." turn through each platform's actual backend)
 * for every runtime platform, or the subset named via --providers, and
 * prints a per-platform verdict. Run it before releases to confirm the
 * supported-platform list still works against the CLIs actually installed
 * on the machine; platforms whose CLI is absent are reported as not
 * installed rather than failed.
 *
 * Usage:
 *   node scripts/smoke-llm-runtimes.mjs [--providers claude-code,codex,...] [--models] [--json]
 *
 * --models additionally runs live model-catalog discovery for the providers
 * that support it (claude-code, codex, cursor) and prints each catalog with
 * its source (live / bundled / static fallback).
 *
 * Exit code is 1 when any discovered runtime fails to reach health=healthy,
 * so the script can gate release checklists.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { discoverLlmRuntimes } = require('../dist/core/llm/llmRuntimeDiscovery.js');
const { getRuntimePlatforms } = require('../dist/core/platform/platformRegistry.js');
const { discoverModelCatalog } = require('../dist/core/llm/modelCatalog.js');

const MODEL_CATALOG_PROVIDERS = new Set(['claude-code', 'codex', 'cursor']);

function parseArgs(argv) {
  const options = { providers: undefined, json: false, models: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--providers') {
      index += 1;
      if (!argv[index]) throw new Error('--providers requires a comma-separated list');
      options.providers = argv[index].split(',').map((value) => value.trim()).filter(Boolean);
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--models') {
      options.models = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const platforms = getRuntimePlatforms().map((platform) => platform.id);
const requested = options.providers?.filter((provider) => platforms.includes(provider)) ?? platforms;
const skippedProviders = options.providers?.filter((provider) => !platforms.includes(provider)) ?? [];
if (skippedProviders.length) {
  console.error(`Ignoring unknown providers (not runtime platforms): ${skippedProviders.join(', ')}`);
}

console.log(`[smoke] discovering providers: ${requested.join(', ')}`);
const startedAt = Date.now();
const result = await discoverLlmRuntimes({ providers: requested });
const elapsedS = ((Date.now() - startedAt) / 1000).toFixed(1);

const notInstalled = requested.filter(
  (provider) => !result.runtimes.some((runtime) => runtime.provider === provider),
);
const unhealthy = result.runtimes.filter((runtime) => runtime.health !== 'healthy');

if (options.json) {
  console.log(JSON.stringify({
    elapsedS,
    runtimes: result.runtimes.map((runtime) => ({
      provider: runtime.provider,
      binaryPath: runtime.binaryPath,
      version: runtime.version,
      health: runtime.health,
      healthReason: runtime.healthReason ?? null,
    })),
    notInstalled,
    errors: result.errors,
  }, null, 2));
} else {
  console.log(`\n[smoke] completed in ${elapsedS}s`);
  for (const runtime of result.runtimes) {
    const reason = runtime.healthReason ? ` — ${runtime.healthReason}` : '';
    console.log(`${runtime.health === 'healthy' ? 'PASS' : 'FAIL'}  ${runtime.provider.padEnd(12)} v${runtime.version ?? '?'}  ${runtime.health}${reason}`);
  }
  for (const provider of notInstalled) {
    console.log(`----  ${provider.padEnd(12)} not installed on this machine`);
  }
  for (const error of result.errors) {
    console.log(`ERR!  ${error.provider}: ${error.message}`);
  }
}

if (options.models) {
  const catalogTargets = result.runtimes.filter((runtime) => MODEL_CATALOG_PROVIDERS.has(runtime.provider));
  for (const runtime of catalogTargets) {
    const catalog = await discoverModelCatalog({
      provider: runtime.provider,
      binaryPath: runtime.binaryPath,
      version: runtime.version,
    });
    if (options.json) {
      console.log(JSON.stringify({ modelCatalog: catalog }, null, 2));
    } else {
      const ids = catalog.models.map((model) => `${model.id}${model.default ? '*' : ''}${model.disabled ? ' (disabled)' : ''}`);
      console.log(`\n[models] ${runtime.provider}: source=${catalog.source}${catalog.reason ? ` (${catalog.reason.slice(0, 120)})` : ''}`);
      console.log(`  ${ids.join(', ')}`);
    }
  }
}

if (unhealthy.length || result.errors.length) {
  console.error(`[smoke] ${unhealthy.length} discovered runtime(s) failed readiness`);
  process.exitCode = 1;
}
