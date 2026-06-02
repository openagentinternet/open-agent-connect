# Chat Allowed Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build profile-configured `allowChatSkills` so local MetaBots can use only explicitly allowed local skills while replying to A2A private chat messages.

**Architecture:** Reuse the Skill Service primary-runtime skill catalog as the single source of executable skill truth. Persist the operator-selected allow-list in profile runtime state and mirror it to `/info/bio.allowChatSkills`. Enforce private-chat skill access by passing exact `skills` and `skillSourcePaths` into `LlmExecutor.execute()`, with prompt text used only as guidance.

**Tech Stack:** TypeScript, Node.js test runner, existing daemon handlers, existing Bot UI script, existing LLM executor skill injection, MetaBot profile v2 storage.

---

## Execution Rules

- Before implementation, create or switch to an isolated feature branch such as `codex/chat-allowed-skills`. Do not implement this feature directly on `main`.
- Leave unrelated files untouched. The current workspace may contain an unrelated untracked `.codex_tmp/`; do not add, remove, or edit it.
- Use one fresh subagent per task when executing this plan.
- Use model `gpt-5.5` for review and test subagents.
- Each task must end with one commit for its independent, verified unit of work.
- After every commit, publish a detailed development diary with the `metabot-post-buzz` skill.
- Do not add skill selection to the new Bot creation modal.
- Do not introduce code or documentation that depends on legacy `.metabot/hot`.

## File Structure

Create:

- `src/core/services/chatSkillPolicy.ts`
  - Owns `allowChatSkills` normalization, strict save-time validation, and tolerant runtime resolution.
- `tests/services/chatSkillPolicy.test.mjs`
  - Tests normalization, validation against the primary runtime catalog, and runtime fail-closed resolution.
- `src/core/chat/privateChatAllowedSkills.ts`
  - Builds per-profile private-chat allowed-skill resolvers from profile state and Skill Service catalog dependencies.
- `tests/chat/privateChatAllowedSkills.test.mjs`
  - Tests per-profile resolver behavior with configured, empty, missing, and stale skill allow-lists.

Modify:

- `src/core/state/paths.ts`
  - Add `chatSkillPolicyPath` under profile `.runtime/state`.
- `src/core/bot/metabotProfileManager.ts`
  - Add `allowChatSkills` to profile types, local state read/write, profile update flow, and `/info/bio` payloads.
- `src/daemon/defaultHandlers.ts`
  - Parse and validate Bot profile `allowChatSkills` updates. Preserve chain-first semantics.
- `src/ui/pages/bot/app.ts`
  - Add Bot detail Info tab controls for selecting chat allowed skills from `/api/services/skills?from=<slug>`.
- `src/ui/pages/bot/index.html`
  - Add compact styling for the chat skill picker, chips, and empty/loading states.
- `src/core/chat/hostLlmChatReplyRunner.ts`
  - Resolve allowed skills before execution, add prompt guidance, and pass exact `skills` and `skillSourcePaths`.
- `src/cli/runtime.ts`
  - Add a shared private-chat reply-runner factory and wire it into both active-profile and multi-profile private chat orchestrators.
- `tests/bot/metabotProfileManager.test.mjs`
  - Cover profile state persistence and chain bio payloads.
- `tests/daemon/defaultBotHandlers.test.mjs`
  - Cover update validation, chain-first bio writes, and create-flow boundary.
- `tests/ui/botPageScript.test.mjs`
  - Cover UI selection/add/remove/save payload and unchanged new Bot modal behavior.
- `tests/chat/hostLlmChatReplyRunner.test.mjs`
  - Cover executor-level skill injection and prompt guidance.
- `tests/cli/autoReplyProfileDispatcher.test.mjs`
  - Cover the multi-profile dispatcher default runner wiring.
- `tests/cli/runtime.test.mjs`
  - Cover the shared CLI private-chat reply-runner factory used by the active-profile path.

## Task 1: Shared Chat Skill Policy Utilities

**Files:**
- Create: `src/core/services/chatSkillPolicy.ts`
- Create: `tests/services/chatSkillPolicy.test.mjs`

- [ ] **Step 1: Write failing normalization tests**

Add `tests/services/chatSkillPolicy.test.mjs` with these initial tests:

```js
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createLlmBindingStore } = require('../../dist/core/llm/llmBindingStore.js');
const { createLlmRuntimeStore } = require('../../dist/core/llm/llmRuntimeStore.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const {
  normalizeAllowChatSkills,
  resolveAllowChatSkillsForRuntime,
  validateAllowChatSkills,
} = require('../../dist/core/services/chatSkillPolicy.js');

async function createProfileHome(slug = 'chat-skill-profile') {
  const systemHome = await fs.mkdtemp(path.join(os.tmpdir(), 'oac-chat-skill-policy-'));
  const profileRoot = path.join(systemHome, '.metabot', 'profiles', slug);
  await fs.mkdir(path.join(systemHome, '.metabot', 'manager'), { recursive: true });
  await fs.mkdir(path.join(systemHome, '.metabot', 'LLM'), { recursive: true });
  await fs.mkdir(profileRoot, { recursive: true });
  return { systemHome, profileRoot, slug };
}

function runtime(id, provider, health = 'healthy') {
  const now = '2026-06-03T00:00:00.000Z';
  return {
    id,
    provider,
    displayName: `${provider} runtime`,
    binaryPath: `/bin/${provider}`,
    version: '1.0.0',
    authState: 'authenticated',
    health,
    capabilities: ['tool-use'],
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function binding(id, slug, runtimeId, role, priority = 0, enabled = true) {
  const now = '2026-06-03T00:00:00.000Z';
  return {
    id,
    metaBotSlug: slug,
    llmRuntimeId: runtimeId,
    role,
    priority,
    enabled,
    createdAt: now,
    updatedAt: now,
  };
}

async function writeSkill(root, name, body = `# ${name}\n`) {
  await fs.mkdir(path.join(root, name), { recursive: true });
  await fs.writeFile(path.join(root, name, 'SKILL.md'), body, 'utf8');
}

async function createValidationContext(options = {}) {
  const { systemHome, profileRoot, slug } = await createProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const runtimeStore = createLlmRuntimeStore(paths);
  const bindingStore = createLlmBindingStore(paths);
  if (options.withRuntime !== false) {
    await runtimeStore.write({
      version: 1,
      runtimes: [
        runtime('runtime-codex', 'codex', options.health || 'healthy'),
      ],
    });
  }
  if (options.withBinding !== false) {
    await bindingStore.write({
      version: 1,
      bindings: [
        binding('binding-codex-primary', slug, 'runtime-codex', 'primary'),
      ],
    });
  }
  for (const skillName of options.skills || ['metabot-weather']) {
    await writeSkill(path.join(systemHome, '.codex', 'skills'), skillName);
  }
  return { systemHome, profileRoot, slug, runtimeStore, bindingStore };
}

test('normalizeAllowChatSkills trims, drops empties, and dedupes in first-seen order', () => {
  assert.deepEqual(
    normalizeAllowChatSkills([' metabot-weather ', '', 'metabot-post-buzz', 'metabot-weather']),
    ['metabot-weather', 'metabot-post-buzz'],
  );
});

test('normalizeAllowChatSkills rejects non-array input', () => {
  assert.throws(
    () => normalizeAllowChatSkills('metabot-weather'),
    /allowChatSkills must be an array/,
  );
});

test('normalizeAllowChatSkills rejects non-string entries', () => {
  assert.throws(
    () => normalizeAllowChatSkills(['metabot-weather', 42]),
    /allowChatSkills entries must be strings/,
  );
});

test('normalizeAllowChatSkills rejects unsafe skill names', () => {
  assert.throws(
    () => normalizeAllowChatSkills(['../secret']),
    /safe skill directory names/,
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run build
node --test tests/services/chatSkillPolicy.test.mjs
```

Expected: build fails because `src/core/services/chatSkillPolicy.ts` does not exist, or the test fails because exported functions do not exist.

- [ ] **Step 3: Implement normalization and validation API**

Create `src/core/services/chatSkillPolicy.ts`:

```ts
import type { LlmBindingStore } from '../llm/llmBindingStore';
import type { LlmRuntimeStore } from '../llm/llmRuntimeStore';
import {
  createPlatformSkillCatalog,
  isSafeProviderSkillName,
  type PlatformSkillCatalogEntry,
  type PlatformSkillRootDiagnostic,
} from './platformSkillCatalog';
import type { LlmRuntime } from '../llm/llmTypes';
import type { PlatformDefinition } from '../platform/platformRegistry';

export type ChatSkillPolicyFailureCode =
  | 'invalid_allow_chat_skills'
  | 'primary_runtime_missing'
  | 'primary_runtime_unavailable'
  | 'primary_runtime_provider_unsupported'
  | 'chat_skill_missing';

export interface ChatSkillPolicyDeps {
  metaBotSlug: string;
  allowChatSkills: unknown;
  runtimeStore: LlmRuntimeStore;
  bindingStore: LlmBindingStore;
  systemHomeDir: string;
  projectRoot: string;
  env?: NodeJS.ProcessEnv;
}

export interface ChatSkillPolicySuccess {
  ok: true;
  allowChatSkills: string[];
  skills: PlatformSkillCatalogEntry[];
  skillSourcePaths: Record<string, string>;
  runtime?: LlmRuntime;
  platform?: Pick<PlatformDefinition, 'id' | 'displayName' | 'logoPath'>;
  rootDiagnostics: PlatformSkillRootDiagnostic[];
  skippedSkills: string[];
  warning?: string;
}

export interface ChatSkillPolicyFailure {
  ok: false;
  code: ChatSkillPolicyFailureCode;
  message: string;
  allowChatSkills: string[];
  runtime?: LlmRuntime;
  platform?: Pick<PlatformDefinition, 'id' | 'displayName' | 'logoPath'>;
  rootDiagnostics: PlatformSkillRootDiagnostic[];
}

export type ChatSkillPolicyValidationResult = ChatSkillPolicySuccess | ChatSkillPolicyFailure;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeAllowChatSkills(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error('allowChatSkills must be an array of safe skill directory names.');
  }

  const seen = new Set<string>();
  const skills: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      throw new Error('allowChatSkills entries must be strings.');
    }
    const skillName = normalizeText(entry);
    if (!skillName) {
      continue;
    }
    if (!isSafeProviderSkillName(skillName)) {
      throw new Error('allowChatSkills must contain only safe skill directory names.');
    }
    if (!seen.has(skillName)) {
      seen.add(skillName);
      skills.push(skillName);
    }
  }
  return skills;
}

function buildSkillSourcePaths(skills: PlatformSkillCatalogEntry[]): Record<string, string> {
  return Object.fromEntries(skills.map((skill) => [skill.skillName, skill.absolutePath]));
}

export async function validateAllowChatSkills(
  input: ChatSkillPolicyDeps,
): Promise<ChatSkillPolicyValidationResult> {
  let allowChatSkills: string[];
  try {
    allowChatSkills = normalizeAllowChatSkills(input.allowChatSkills);
  } catch (error) {
    return {
      ok: false,
      code: 'invalid_allow_chat_skills',
      message: error instanceof Error ? error.message : String(error),
      allowChatSkills: [],
      rootDiagnostics: [],
    };
  }

  if (allowChatSkills.length === 0) {
    return {
      ok: true,
      allowChatSkills,
      skills: [],
      skillSourcePaths: {},
      rootDiagnostics: [],
      skippedSkills: [],
    };
  }

  const catalog = createPlatformSkillCatalog({
    runtimeStore: input.runtimeStore,
    bindingStore: input.bindingStore,
    systemHomeDir: input.systemHomeDir,
    projectRoot: input.projectRoot,
    env: input.env,
  });
  const catalogResult = await catalog.listPrimaryRuntimeSkills({ metaBotSlug: input.metaBotSlug });
  if (!catalogResult.ok) {
    return {
      ok: false,
      code: catalogResult.code,
      message: catalogResult.message,
      allowChatSkills,
      runtime: catalogResult.runtime,
      rootDiagnostics: catalogResult.rootDiagnostics,
    };
  }

  const skillsByName = new Map(catalogResult.skills.map((skill) => [skill.skillName, skill] as const));
  const missingSkills = allowChatSkills.filter((skillName) => !skillsByName.has(skillName));
  if (missingSkills.length > 0) {
    return {
      ok: false,
      code: 'chat_skill_missing',
      message: `allowChatSkills contains skills that are not installed in the selected MetaBot primary runtime skill roots: ${missingSkills.join(', ')}`,
      allowChatSkills,
      runtime: catalogResult.runtime,
      platform: catalogResult.platform,
      rootDiagnostics: catalogResult.rootDiagnostics,
    };
  }

  const skills = allowChatSkills
    .map((skillName) => skillsByName.get(skillName))
    .filter((skill): skill is PlatformSkillCatalogEntry => Boolean(skill));

  return {
    ok: true,
    allowChatSkills,
    skills,
    skillSourcePaths: buildSkillSourcePaths(skills),
    runtime: catalogResult.runtime,
    platform: catalogResult.platform,
    rootDiagnostics: catalogResult.rootDiagnostics,
    skippedSkills: [],
  };
}

export async function resolveAllowChatSkillsForRuntime(
  input: ChatSkillPolicyDeps,
): Promise<ChatSkillPolicySuccess> {
  let allowChatSkills: string[];
  try {
    allowChatSkills = normalizeAllowChatSkills(input.allowChatSkills);
  } catch (error) {
    return {
      ok: true,
      allowChatSkills: [],
      skills: [],
      skillSourcePaths: {},
      rootDiagnostics: [],
      skippedSkills: [],
      warning: error instanceof Error ? error.message : String(error),
    };
  }

  if (allowChatSkills.length === 0) {
    return {
      ok: true,
      allowChatSkills,
      skills: [],
      skillSourcePaths: {},
      rootDiagnostics: [],
      skippedSkills: [],
    };
  }

  const catalog = createPlatformSkillCatalog({
    runtimeStore: input.runtimeStore,
    bindingStore: input.bindingStore,
    systemHomeDir: input.systemHomeDir,
    projectRoot: input.projectRoot,
    env: input.env,
  });
  const catalogResult = await catalog.listPrimaryRuntimeSkills({ metaBotSlug: input.metaBotSlug });
  if (!catalogResult.ok) {
    return {
      ok: true,
      allowChatSkills,
      skills: [],
      skillSourcePaths: {},
      runtime: catalogResult.runtime,
      rootDiagnostics: catalogResult.rootDiagnostics,
      skippedSkills: allowChatSkills,
      warning: catalogResult.message,
    };
  }

  const skillsByName = new Map(catalogResult.skills.map((skill) => [skill.skillName, skill] as const));
  const skills = allowChatSkills
    .map((skillName) => skillsByName.get(skillName))
    .filter((skill): skill is PlatformSkillCatalogEntry => Boolean(skill));
  const resolvedNames = new Set(skills.map((skill) => skill.skillName));
  const skippedSkills = allowChatSkills.filter((skillName) => !resolvedNames.has(skillName));

  return {
    ok: true,
    allowChatSkills,
    skills,
    skillSourcePaths: buildSkillSourcePaths(skills),
    runtime: catalogResult.runtime,
    platform: catalogResult.platform,
    rootDiagnostics: catalogResult.rootDiagnostics,
    skippedSkills,
    ...(skippedSkills.length > 0
      ? { warning: `Configured chat skills are not currently available: ${skippedSkills.join(', ')}` }
      : {}),
  };
}
```

- [ ] **Step 4: Add catalog validation and runtime resolution tests**

Append these tests to `tests/services/chatSkillPolicy.test.mjs`:

```js
test('validateAllowChatSkills succeeds against the primary runtime catalog', async () => {
  const context = await createValidationContext({ skills: ['metabot-weather', 'metabot-post-buzz'] });
  const result = await validateAllowChatSkills({
    metaBotSlug: context.slug,
    allowChatSkills: ['metabot-weather', 'metabot-post-buzz'],
    runtimeStore: context.runtimeStore,
    bindingStore: context.bindingStore,
    systemHomeDir: context.systemHome,
    projectRoot: context.profileRoot,
    env: {},
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.allowChatSkills, ['metabot-weather', 'metabot-post-buzz']);
  assert.deepEqual(result.skills.map((skill) => skill.skillName), ['metabot-weather', 'metabot-post-buzz']);
  assert.ok(result.skillSourcePaths['metabot-weather'].endsWith(path.join('.codex', 'skills', 'metabot-weather')));
});

test('validateAllowChatSkills fails when a configured skill is missing', async () => {
  const context = await createValidationContext({ skills: ['metabot-weather'] });
  const result = await validateAllowChatSkills({
    metaBotSlug: context.slug,
    allowChatSkills: ['metabot-weather', 'metabot-missing'],
    runtimeStore: context.runtimeStore,
    bindingStore: context.bindingStore,
    systemHomeDir: context.systemHome,
    projectRoot: context.profileRoot,
    env: {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'chat_skill_missing');
  assert.match(result.message, /metabot-missing/);
});

test('validateAllowChatSkills fails when the primary runtime catalog is unavailable', async () => {
  const context = await createValidationContext({ health: 'unavailable' });
  const result = await validateAllowChatSkills({
    metaBotSlug: context.slug,
    allowChatSkills: ['metabot-weather'],
    runtimeStore: context.runtimeStore,
    bindingStore: context.bindingStore,
    systemHomeDir: context.systemHome,
    projectRoot: context.profileRoot,
    env: {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'primary_runtime_unavailable');
});

test('resolveAllowChatSkillsForRuntime excludes stale skills instead of failing open', async () => {
  const context = await createValidationContext({ skills: ['metabot-weather'] });
  const result = await resolveAllowChatSkillsForRuntime({
    metaBotSlug: context.slug,
    allowChatSkills: ['metabot-weather', 'metabot-missing'],
    runtimeStore: context.runtimeStore,
    bindingStore: context.bindingStore,
    systemHomeDir: context.systemHome,
    projectRoot: context.profileRoot,
    env: {},
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.skills.map((skill) => skill.skillName), ['metabot-weather']);
  assert.deepEqual(result.skippedSkills, ['metabot-missing']);
  assert.match(result.warning, /metabot-missing/);
});

test('resolveAllowChatSkillsForRuntime returns no skills when catalog cannot be resolved', async () => {
  const context = await createValidationContext({ withBinding: false });
  const result = await resolveAllowChatSkillsForRuntime({
    metaBotSlug: context.slug,
    allowChatSkills: ['metabot-weather'],
    runtimeStore: context.runtimeStore,
    bindingStore: context.bindingStore,
    systemHomeDir: context.systemHome,
    projectRoot: context.profileRoot,
    env: {},
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.skills, []);
  assert.deepEqual(result.skillSourcePaths, {});
  assert.deepEqual(result.skippedSkills, ['metabot-weather']);
  assert.match(result.warning, /primary runtime/i);
});
```

- [ ] **Step 5: Run focused verification**

Run:

```bash
npm run build
node --test tests/services/chatSkillPolicy.test.mjs
node --test tests/services/servicePublishValidation.test.mjs
```

Expected: all listed commands pass.

- [ ] **Step 6: Commit and post diary**

Run:

```bash
git add src/core/services/chatSkillPolicy.ts tests/services/chatSkillPolicy.test.mjs
git commit -m "feat: add chat skill policy validation"
```

Then use `metabot-post-buzz` to publish a diary covering the new policy utility, tests, and verification commands.

## Task 2: Profile State and Bio Persistence

**Files:**
- Modify: `src/core/state/paths.ts`
- Modify: `src/core/bot/metabotProfileManager.ts`
- Modify: `tests/bot/metabotProfileManager.test.mjs`

- [ ] **Step 1: Write failing profile persistence tests**

Append tests to `tests/bot/metabotProfileManager.test.mjs`:

```js
test('metabot profile persists allowChatSkills under runtime state after update', async (t) => {
  const systemHomeDir = await createSystemHome();

  const created = await createMetabotProfile(systemHomeDir, {
    name: 'Chat Skills Bot',
  });
  assert.deepEqual(created.allowChatSkills, []);

  const updated = await updateMetabotProfile(systemHomeDir, created.slug, {
    allowChatSkills: ['metabot-weather', 'metabot-post-buzz'],
  });
  const paths = resolveMetabotPaths(updated.homeDir);
  const rawPolicy = JSON.parse(await readFile(paths.chatSkillPolicyPath, 'utf8'));
  const loaded = await getMetabotProfile(systemHomeDir, updated.slug);

  assert.deepEqual(rawPolicy.allowChatSkills, ['metabot-weather', 'metabot-post-buzz']);
  assert.equal(typeof rawPolicy.updatedAt, 'string');
  assert.deepEqual(updated.allowChatSkills, ['metabot-weather', 'metabot-post-buzz']);
  assert.deepEqual(loaded.allowChatSkills, ['metabot-weather', 'metabot-post-buzz']);
});

test('updateMetabotProfile preserves and clears allowChatSkills explicitly', async (t) => {
  const systemHomeDir = await createSystemHome();

  const created = await createMetabotProfile(systemHomeDir, {
    name: 'Policy Bot',
  });

  const configured = await updateMetabotProfile(systemHomeDir, created.slug, {
    allowChatSkills: ['metabot-weather'],
  });
  assert.deepEqual(configured.allowChatSkills, ['metabot-weather']);

  const renamed = await updateMetabotProfile(systemHomeDir, created.slug, {
    name: 'Policy Bot Updated',
  });
  assert.deepEqual(renamed.allowChatSkills, ['metabot-weather']);

  const cleared = await updateMetabotProfile(systemHomeDir, created.slug, {
    allowChatSkills: [],
  });
  assert.deepEqual(cleared.allowChatSkills, []);
});
```

Update the existing `syncMetabotInfoToChain writes name, avatar, and bio pins in chain-first order` test so the profile input includes:

```js
allowChatSkills: ['metabot-weather'],
```

and add:

```js
assert.deepEqual(JSON.parse(calls[2].payload).allowChatSkills, ['metabot-weather']);
```

Update the `syncMetabotInfoToChain skips local-only profiles without a globalMetaId` profile object with:

```js
allowChatSkills: [],
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run build
node --test tests/bot/metabotProfileManager.test.mjs
```

Expected: build or tests fail because `chatSkillPolicyPath` and `allowChatSkills` profile fields do not exist.

- [ ] **Step 3: Add path support**

Modify `src/core/state/paths.ts`.

Add to `MetabotPaths`:

```ts
chatSkillPolicyPath: string;
```

Add to `buildMetabotPaths()` input type:

```ts
chatSkillPolicyPath: string;
```

Add to the returned object near the other `.runtime/state` paths:

```ts
chatSkillPolicyPath: input.chatSkillPolicyPath,
```

Add to `resolveMetabotPaths()` when calling `buildMetabotPaths()`:

```ts
chatSkillPolicyPath: path.join(stateRoot, 'chat-skill-policy.json'),
```

- [ ] **Step 4: Add profile manager state helpers and types**

Modify `src/core/bot/metabotProfileManager.ts`.

Import the normalizer:

```ts
import { normalizeAllowChatSkills } from '../services/chatSkillPolicy';
```

Extend constants and interfaces:

```ts
const BIO_FIELDS = new Set(['role', 'soul', 'goal', 'primaryProvider', 'fallbackProvider', 'allowChatSkills']);

export interface MetabotProfileFull extends IdentityProfileRecord {
  role: string;
  soul: string;
  goal: string;
  avatarDataUrl?: string;
  primaryProvider?: LlmProvider | null;
  fallbackProvider?: LlmProvider | null;
  allowChatSkills: string[];
}

export interface CreateMetabotInput {
  name: string;
  role?: string;
  soul?: string;
  goal?: string;
  avatarDataUrl?: string;
  primaryProvider?: LlmProvider | null;
  fallbackProvider?: LlmProvider | null;
}

export interface UpdateMetabotInfoInput {
  name?: string;
  role?: string;
  soul?: string;
  goal?: string;
  avatarDataUrl?: string;
  primaryProvider?: LlmProvider | null;
  fallbackProvider?: LlmProvider | null;
  allowChatSkills?: string[];
}
```

Add helpers near `readTextFile()`:

```ts
async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readAllowChatSkills(profileHomeDir: string): Promise<string[]> {
  const paths = resolveMetabotPaths(profileHomeDir);
  const policy = await readJsonFile<{ allowChatSkills?: unknown }>(paths.chatSkillPolicyPath);
  try {
    return normalizeAllowChatSkills(policy?.allowChatSkills ?? []);
  } catch {
    return [];
  }
}

async function writeAllowChatSkills(profileHomeDir: string, allowChatSkills: string[]): Promise<void> {
  const paths = resolveMetabotPaths(profileHomeDir);
  await writeJsonFile(paths.chatSkillPolicyPath, {
    allowChatSkills: normalizeAllowChatSkills(allowChatSkills),
    updatedAt: new Date().toISOString(),
  });
}
```

- [ ] **Step 5: Wire read/update/sync flows**

In `buildMetabotProfileFull()`, include `allowChatSkills` in the parallel reads:

```ts
const [role, soul, goal, avatarDataUrl, providerBindings, allowChatSkills] = await Promise.all([
  readTextFile(paths.roleMdPath),
  readTextFile(paths.soulMdPath),
  readTextFile(paths.goalMdPath),
  readTextFile(resolveAvatarPath(profile.homeDir)),
  readProfileProviderBindings(profile),
  readAllowChatSkills(profile.homeDir),
]);
```

and return:

```ts
allowChatSkills,
```

In `buildMetabotProfileDraftFromIdentity()`, include:

```ts
allowChatSkills: [],
```

Do not add `allowChatSkills` to `CreateMetabotInput` or `CreateMetabotFromIdentityInput`. New Bots start with an empty allow-list and are configured later through `updateMetabotProfile()`.

In `updateMetabotProfile()`, after provider binding writes:

```ts
if (input.allowChatSkills !== undefined) {
  await writeAllowChatSkills(current.homeDir, input.allowChatSkills);
}
```

In `syncMetabotInfoToChain()`, add `allowChatSkills` to the `/info/bio` payload:

```ts
allowChatSkills: normalizeAllowChatSkills(profile.allowChatSkills ?? []),
```

- [ ] **Step 6: Run focused verification**

Run:

```bash
npm run build
node --test tests/services/chatSkillPolicy.test.mjs
node --test tests/bot/metabotProfileManager.test.mjs
```

Expected: all listed commands pass.

- [ ] **Step 7: Commit and post diary**

Run:

```bash
git add src/core/state/paths.ts src/core/bot/metabotProfileManager.ts tests/bot/metabotProfileManager.test.mjs
git commit -m "feat: persist chat allowed skills on profiles"
```

Then use `metabot-post-buzz` to publish a diary covering the profile state file, bio payload change, and verification commands.

## Task 3: Bot Handler Validation and Chain-First Updates

**Files:**
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `tests/daemon/defaultBotHandlers.test.mjs`

- [ ] **Step 1: Write failing daemon handler tests**

Append to `tests/daemon/defaultBotHandlers.test.mjs`:

```js
test('default bot updateProfile validates allowChatSkills and writes chain bio before local state', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-', 'active-bot');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  await createLlmRuntimeStore(homeDir).write({
    version: 1,
    runtimes: [
      runtime('codex', 'runtime-codex', 'healthy'),
    ],
  });
  await createLlmBindingStore(homeDir).write({
    version: 1,
    bindings: [
      {
        id: 'binding-codex-primary',
        metaBotSlug: 'active-bot',
        llmRuntimeId: 'runtime-codex',
        role: 'primary',
        priority: 0,
        enabled: true,
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z',
      },
    ],
  });
  const skillRoot = path.join(systemHomeDir, '.codex', 'skills', 'metabot-weather');
  await mkdir(skillRoot, { recursive: true });
  await writeFile(path.join(skillRoot, 'SKILL.md'), '# metabot-weather\n', 'utf8');

  const bioPayloads = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    signer: makeSigner(async (input) => {
      if (input.path === '/info/bio') {
        bioPayloads.push(JSON.parse(input.payload));
        const paths = resolveMetabotPaths(homeDir);
        await assert.rejects(() => access(paths.chatSkillPolicyPath), /ENOENT/);
      }
      return {
        txids: [`allow-chat-skills-tx-${bioPayloads.length}`],
        pinId: `allow-chat-skills-pin-${bioPayloads.length}`,
        totalCost: 1,
        network: 'mvc',
        operation: input.operation,
        path: input.path,
        contentType: input.contentType,
        encoding: input.encoding ?? 'utf-8',
        globalMetaId: 'gm-active-bot',
        mvcAddress: 'mvc-active-bot',
      };
    }),
  });

  const result = await handlers.bot.updateProfile({
    slug: 'active-bot',
    allowChatSkills: ['metabot-weather'],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(bioPayloads.at(-1).allowChatSkills, ['metabot-weather']);
  assert.deepEqual(result.data.profile.allowChatSkills, ['metabot-weather']);
});

test('default bot updateProfile rejects unavailable allowChatSkills', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-', 'active-bot');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  await createLlmRuntimeStore(homeDir).write({
    version: 1,
    runtimes: [
      runtime('codex', 'runtime-codex', 'healthy'),
    ],
  });
  await createLlmBindingStore(homeDir).write({
    version: 1,
    bindings: [
      {
        id: 'binding-codex-primary',
        metaBotSlug: 'active-bot',
        llmRuntimeId: 'runtime-codex',
        role: 'primary',
        priority: 0,
        enabled: true,
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z',
      },
    ],
  });
  const signerCalls = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    signer: makeSigner(async (input) => {
      signerCalls.push(input);
      throw new Error('chain should not be called for invalid skills');
    }),
  });

  const result = await handlers.bot.updateProfile({
    slug: 'active-bot',
    allowChatSkills: ['missing-skill'],
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_metabot_profile_update');
  assert.match(result.message, /missing-skill/);
  assert.deepEqual(signerCalls, []);
});
```

Also update the existing `default bot createProfile persists requested provider fields after chain bio write` expectation to include:

```js
allowChatSkills: [],
```

Add a create boundary test:

```js
test('default bot createProfile does not accept non-empty allowChatSkills before Bot detail setup', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-', 'active-bot');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir: deriveSystemHome(homeDir),
    getDaemonRecord: () => null,
    ...makeChainedCreateOverrides(),
  });

  const result = await handlers.bot.createProfile({
    name: 'Create Boundary Bot',
    allowChatSkills: ['metabot-weather'],
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_metabot_profile_create');
  assert.match(result.message, /after MetaBot creation/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run build
node --test tests/daemon/defaultBotHandlers.test.mjs
```

Expected: tests fail because handler parsing and validation are not wired.

- [ ] **Step 3: Parse and compare allowChatSkills in handlers**

Modify imports in `src/daemon/defaultHandlers.ts`:

```ts
import {
  normalizeAllowChatSkills,
  validateAllowChatSkills,
} from '../core/services/chatSkillPolicy';
```

In `buildMetabotUpdateInput()`:

```ts
if (hasOwnField(input, 'allowChatSkills')) {
  update.allowChatSkills = normalizeAllowChatSkills(input.allowChatSkills);
}
```

In `buildMetabotCreateInput()`:

```ts
if (hasOwnField(input, 'allowChatSkills')) {
  const requestedAllowChatSkills = normalizeAllowChatSkills(input.allowChatSkills);
  if (requestedAllowChatSkills.length > 0) {
    throw new Error('allowChatSkills can be configured after MetaBot creation from the Bot detail page.');
  }
}
```

Add an array helper near `calculateMetabotChangedFields()`:

```ts
function sameStringArray(left: string[] = [], right: string[] = []): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
```

In `calculateMetabotChangedFields()`:

```ts
if (
  update.allowChatSkills !== undefined
  && !sameStringArray(update.allowChatSkills, current.allowChatSkills ?? [])
) {
  changedFields.push('allowChatSkills');
}
```

In `buildMetabotChainProfile()`:

```ts
allowChatSkills: update.allowChatSkills !== undefined
  ? update.allowChatSkills
  : (current.allowChatSkills ?? []),
```

- [ ] **Step 4: Add update validation**

Create-time non-empty `allowChatSkills` is rejected inside `buildMetabotCreateInput()`. Explicit empty `allowChatSkills: []` is accepted as a no-op so JSON clients can send a normalized empty value without configuring skills before creation.

In `updateProfile`, after `update = buildMetabotUpdateInput(body);` and before `validateMetabotProviderAvailability(current, update);`, add strict validation:

```ts
if (update.allowChatSkills !== undefined && update.allowChatSkills.length > 0) {
  const validation = await validateAllowChatSkills({
    metaBotSlug: current.slug,
    allowChatSkills: update.allowChatSkills,
    runtimeStore: createLlmRuntimeStore(current.homeDir),
    bindingStore: createLlmBindingStore(current.homeDir),
    systemHomeDir: normalizedSystemHomeDir,
    projectRoot: current.homeDir,
    env: process.env,
  });
  if (!validation.ok) {
    throw new Error(validation.message);
  }
  update.allowChatSkills = validation.allowChatSkills;
}
```

Do not validate the primary runtime catalog for an explicit empty list; clearing must work even when a runtime is unavailable.

- [ ] **Step 5: Run focused verification**

Run:

```bash
npm run build
node --test tests/services/chatSkillPolicy.test.mjs
node --test tests/bot/metabotProfileManager.test.mjs
node --test tests/daemon/defaultBotHandlers.test.mjs
```

Expected: all listed commands pass.

- [ ] **Step 6: Commit and post diary**

Run:

```bash
git add src/daemon/defaultHandlers.ts tests/daemon/defaultBotHandlers.test.mjs
git commit -m "feat: validate bot chat allowed skills"
```

Then use `metabot-post-buzz` to publish a diary covering daemon validation, chain-first behavior, and verification commands.

## Task 4: Bot Detail UI Controls

**Files:**
- Modify: `src/ui/pages/bot/app.ts`
- Modify: `src/ui/pages/bot/index.html`
- Modify: `tests/ui/botPageScript.test.mjs`

- [ ] **Step 1: Write failing UI tests**

Append to `tests/ui/botPageScript.test.mjs`:

```js
test('bot page loads chat skill options from Skill Service catalog for the selected profile', async () => {
  const root = { innerHTML: '' };
  const context = createBotScriptContext({
    elements: {
      '[data-info-content]': root,
    },
    fetch: (url) => {
      if (url === '/api/services/skills?from=alice-bot') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            data: {
              skills: [
                { skillName: 'metabot-weather', title: 'Weather' },
                { skillName: 'metabot-post-buzz', title: 'Post Buzz' },
              ],
            },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, data: {} }) });
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice-bot';
  context.state.profiles = [{
    slug: 'alice-bot',
    name: 'Alice',
    role: 'Role',
    soul: 'Soul',
    goal: 'Goal',
    allowChatSkills: ['metabot-weather'],
  }];

  context.renderInfoTab();
  await context.loadChatSkillOptions('alice-bot');
  context.renderInfoTab();

  assert.match(root.innerHTML, /Chat Allowed Skills/);
  assert.match(root.innerHTML, /metabot-weather/);
  assert.match(root.innerHTML, /metabot-post-buzz/);
  assert.match(root.innerHTML, /data-chat-skill-chip="metabot-weather"/);
});

test('bot page chat skill Add and Remove controls update selected chips', () => {
  let addHandler = null;
  let removeHandler = null;
  const addButton = field();
  addButton.addEventListener = (_event, handler) => {
    addHandler = handler;
  };
  const removeButton = field();
  removeButton.getAttribute = (name) => (name === 'data-skill' ? 'metabot-weather' : null);
  removeButton.addEventListener = (_event, handler) => {
    removeHandler = handler;
  };
  const skillSelect = field('metabot-post-buzz');
  let renderCount = 0;
  const context = {
    document: {
      querySelector: (selector) => {
        if (selector === '[data-act="add-chat-skill"]') return addButton;
        if (selector === '[data-field="chatSkillSelect"]') return skillSelect;
        return null;
      },
      querySelectorAll: (selector) => (selector === '[data-act="remove-chat-skill"]' ? [removeButton] : []),
      addEventListener: () => {},
    },
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.renderInfoTab = () => {
    renderCount += 1;
  };
  context.state.selectedSlug = 'alice-bot';
  context.state.profiles = [{
    slug: 'alice-bot',
    name: 'Alice',
    role: 'Role',
    soul: 'Soul',
    goal: 'Goal',
    allowChatSkills: ['metabot-weather'],
  }];
  context.state.chatAllowedSkillsBySlug = {
    'alice-bot': ['metabot-weather'],
  };

  context.wireChatSkillControls();
  addHandler.call(addButton);
  assert.deepEqual(context.state.chatAllowedSkillsBySlug['alice-bot'], [
    'metabot-weather',
    'metabot-post-buzz',
  ]);

  removeHandler.call(removeButton);
  assert.deepEqual(context.state.chatAllowedSkillsBySlug['alice-bot'], ['metabot-post-buzz']);
  assert.equal(renderCount, 2);
});

test('bot page saveInfo sends normalized allowChatSkills when the selected chips change', async () => {
  const fields = {
    '[data-save-status]': field(),
    '[data-act="save-info"]': field(),
    '[data-field="name"]': field('Alice'),
    '[data-field="role"]': field('Role'),
    '[data-field="soul"]': field('Soul'),
    '[data-field="goal"]': field('Goal'),
    '[data-field="primaryProvider"]': field('codex'),
    '[data-field="fallbackProvider"]': field(''),
  };
  let requestBody = null;
  const context = {
    document: {
      querySelector: (selector) => fields[selector] ?? null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    fetch: (_url, options) => {
      requestBody = JSON.parse(options.body);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: {
            profile: {
              slug: 'alice-bot',
              name: 'Alice',
              role: 'Role',
              soul: 'Soul',
              goal: 'Goal',
              primaryProvider: 'codex',
              fallbackProvider: null,
              allowChatSkills: ['metabot-weather', 'metabot-post-buzz'],
            },
            chainWrites: [],
          },
        }),
      });
    },
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.renderMetabotList = () => {};
  context.renderDetailHeader = () => {};
  context.renderInfoTab = () => {};
  context.renderStats = () => {};
  context.showChainSuccessModal = () => {};
  context.loadStats = () => Promise.resolve();
  context.state.selectedSlug = 'alice-bot';
  context.state.originalProfile = {
    slug: 'alice-bot',
    name: 'Alice',
    role: 'Role',
    soul: 'Soul',
    goal: 'Goal',
    primaryProvider: 'codex',
    fallbackProvider: null,
    allowChatSkills: ['metabot-weather'],
  };
  context.state.chatAllowedSkillsBySlug = {
    'alice-bot': ['metabot-weather', 'metabot-post-buzz'],
  };

  await context.saveInfo();

  assert.deepEqual(requestBody, {
    allowChatSkills: ['metabot-weather', 'metabot-post-buzz'],
  });
});

test('bot page create flow still does not include allowChatSkills in the new Bot request', async () => {
  const fields = {
    '[data-field="new-name"]': field('Fanny'),
    '[data-add-status]': field(),
    '[data-act="confirm-add"]': field(),
  };
  let requestBody = null;
  const context = {
    document: {
      querySelector: (selector) => fields[selector] ?? null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    fetch: (_url, options) => {
      requestBody = JSON.parse(options.body);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: {
            profile: { slug: 'fanny', name: 'Fanny' },
            chainWrites: [],
          },
        }),
      });
    },
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.closeAddModal = () => {};
  context.loadProfiles = () => Promise.resolve();
  context.showChainSuccessModal = () => {};

  await context.createMetabot();

  assert.deepEqual(requestBody, { name: 'Fanny', creationSource: 'ui' });
});
```

- [ ] **Step 2: Run UI tests to verify they fail**

Run:

```bash
npm run build
node --test tests/ui/botPageScript.test.mjs
```

Expected: tests fail because chat skill UI state and functions do not exist.

- [ ] **Step 3: Add UI state and helpers**

Modify the `state` object in `src/ui/pages/bot/app.ts` to include:

```js
chatSkillOptionsBySlug:{},
chatSkillOptionsStatusBySlug:{},
chatAllowedSkillsBySlug:{},
```

Inside the raw script, add helpers after `providerIconMarkup()`:

```js
function normalizeChatSkillList(value){
  var source=Array.isArray(value)?value:[];
  var seen={};
  var result=[];
  source.forEach(function(item){
    var skill=String(item==null?'':item).trim();
    if(!skill||seen[skill])return;
    seen[skill]=true;
    result.push(skill);
  });
  return result;
}
function sameChatSkillList(left,right){
  left=normalizeChatSkillList(left);right=normalizeChatSkillList(right);
  return left.length===right.length&&left.every(function(value,index){return value===right[index]});
}
function selectedChatSkills(profile){
  if(!profile)return[];
  if(state.chatAllowedSkillsBySlug[profile.slug])return normalizeChatSkillList(state.chatAllowedSkillsBySlug[profile.slug]);
  return normalizeChatSkillList(profile.allowChatSkills);
}
function ensureSelectedChatSkills(profile){
  if(!profile)return[];
  if(!state.chatAllowedSkillsBySlug[profile.slug]){
    state.chatAllowedSkillsBySlug[profile.slug]=normalizeChatSkillList(profile.allowChatSkills);
  }
  return state.chatAllowedSkillsBySlug[profile.slug];
}
```

Add a loader:

```js
function loadChatSkillOptions(slug){
  slug=String(slug||'').trim();
  if(!slug)return Promise.resolve([]);
  if(state.chatSkillOptionsStatusBySlug[slug]==='loaded')return Promise.resolve(state.chatSkillOptionsBySlug[slug]||[]);
  state.chatSkillOptionsStatusBySlug[slug]='loading';
  return api('/api/services/skills?from='+encodeURIComponent(slug)).then(function(r){
    var skills=((r.data&&r.data.skills)||[]).map(function(skill){
      return {
        skillName:String(skill.skillName||'').trim(),
        title:skill.title||skill.skillName||'',
        description:skill.description||'',
      };
    }).filter(function(skill){return skill.skillName});
    state.chatSkillOptionsBySlug[slug]=skills;
    state.chatSkillOptionsStatusBySlug[slug]='loaded';
    if(slug===state.selectedSlug&&state.selectedTab==='info')renderInfoTab();
    return skills;
  }).catch(function(error){
    state.chatSkillOptionsStatusBySlug[slug]='error';
    state.chatSkillOptionsBySlug[slug]=[];
    state.chatSkillOptionsErrorBySlug=state.chatSkillOptionsErrorBySlug||{};
    state.chatSkillOptionsErrorBySlug[slug]=error.message;
    if(slug===state.selectedSlug&&state.selectedTab==='info')renderInfoTab();
    return [];
  });
}
```

- [ ] **Step 4: Render chat skill controls in the Info tab**

Add markup helper:

```js
function chatAllowedSkillsMarkup(profile){
  var selected=ensureSelectedChatSkills(profile);
  var options=state.chatSkillOptionsBySlug[profile.slug]||[];
  var status=state.chatSkillOptionsStatusBySlug[profile.slug]||'idle';
  var selectedSet={};selected.forEach(function(skill){selectedSet[skill]=true});
  var available=options.filter(function(skill){return !selectedSet[skill.skillName]});
  var selectOptions=available.map(function(skill){
    var label=skill.title&&skill.title!==skill.skillName?skill.skillName+' - '+skill.title:skill.skillName;
    return '<option value="'+esc(skill.skillName)+'">'+esc(label)+'</option>';
  }).join('');
  var chips=selected.length?selected.map(function(skill){
    return '<span class="skill-chip" data-chat-skill-chip="'+esc(skill)+'"><code>'+esc(skill)+'</code><button type="button" class="icon-btn" data-act="remove-chat-skill" data-skill="'+esc(skill)+'" aria-label="Remove '+esc(skill)+'">x</button></span>';
  }).join(''):'<div class="muted">No chat skills are allowed for private chat.</div>';
  var statusText=status==='loading'?'Loading executable skills...':status==='error'?'Unable to load executable skills.':'';
  return '<div class="field field-full chat-skills-field">'+
    '<label for="bot-chat-skill">Chat Allowed Skills</label>'+
    '<div class="chat-skill-picker">'+
      '<select id="bot-chat-skill" data-field="chatSkillSelect" '+(!available.length?'disabled':'')+'>'+selectOptions+'</select>'+
      '<button type="button" class="btn btn-sm" data-act="add-chat-skill" '+(!available.length?'disabled':'')+'>Add</button>'+
    '</div>'+
    '<div class="chat-skill-chips" data-chat-skill-chips>'+chips+'</div>'+
    (statusText?'<div class="save-status '+(status==='error'?'error':'saving')+'">'+esc(statusText)+'</div>':'')+
  '</div>';
}
```

Insert `chatAllowedSkillsMarkup(profile)` in `renderInfoTab()` after the fallback provider picker inside `.info-form-grid`.

After `wireProviderPickers();`, add:

```js
wireChatSkillControls();
if(!state.chatSkillOptionsStatusBySlug[profile.slug]){
  loadChatSkillOptions(profile.slug);
}
```

Add control wiring:

```js
function wireChatSkillControls(){
  var add=q('[data-act="add-chat-skill"]');
  if(add)add.addEventListener('click',function(){
    var profile=selectedProfile();var select=q('[data-field="chatSkillSelect"]');
    if(!profile||!select||!select.value)return;
    var selected=ensureSelectedChatSkills(profile);
    if(selected.indexOf(select.value)<0)selected.push(select.value);
    state.chatAllowedSkillsBySlug[profile.slug]=normalizeChatSkillList(selected);
    renderInfoTab();
  });
  qq('[data-act="remove-chat-skill"]').forEach(function(el){
    el.addEventListener('click',function(){
      var profile=selectedProfile();if(!profile)return;
      var remove=this.getAttribute('data-skill')||'';
      state.chatAllowedSkillsBySlug[profile.slug]=selectedChatSkills(profile).filter(function(skill){return skill!==remove});
      renderInfoTab();
    });
  });
}
```

- [ ] **Step 5: Include allowChatSkills in save payload**

In `saveInfo()`, after provider payload handling and before avatar handling, add:

```js
var nextChatSkills=selectedChatSkills(profile);
if(!sameChatSkillList(nextChatSkills,profile.allowChatSkills||[])){
  payload.allowChatSkills=nextChatSkills;
}
```

When a save succeeds, replace the local selected copy with the server result:

```js
state.chatAllowedSkillsBySlug[updated.slug]=normalizeChatSkillList(updated.allowChatSkills);
```

In `loadProfiles()`, after assigning `state.profiles`, seed or preserve per-profile selections:

```js
state.profiles.forEach(function(profile){
  if(!state.chatAllowedSkillsBySlug[profile.slug]){
    state.chatAllowedSkillsBySlug[profile.slug]=normalizeChatSkillList(profile.allowChatSkills);
  }
});
```

- [ ] **Step 6: Add compact Bot UI styles**

Modify `src/ui/pages/bot/index.html` near the existing `.info-form-grid` and provider picker styles:

```css
.chat-skills-field {
  gap: 10px;
}

.chat-skill-picker {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
}

.chat-skill-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 28px;
}

.skill-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 5px 6px 5px 9px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface2);
}

.skill-chip code {
  overflow-wrap: anywhere;
  font-size: 12px;
}
```

- [ ] **Step 7: Run focused verification**

Run:

```bash
npm run build
node --test tests/ui/botPageScript.test.mjs
```

Expected: all listed commands pass.

- [ ] **Step 8: Commit and post diary**

Run:

```bash
git add src/ui/pages/bot/app.ts src/ui/pages/bot/index.html tests/ui/botPageScript.test.mjs
git commit -m "feat: add bot chat skill controls"
```

Then use `metabot-post-buzz` to publish a diary covering the Bot detail UI, unchanged create modal behavior, and verification commands.

## Task 5: Private Chat Executor Enforcement

**Files:**
- Create: `src/core/chat/privateChatAllowedSkills.ts`
- Create: `tests/chat/privateChatAllowedSkills.test.mjs`
- Modify: `src/core/chat/hostLlmChatReplyRunner.ts`
- Modify: `src/cli/runtime.ts`
- Modify: `tests/chat/hostLlmChatReplyRunner.test.mjs`
- Modify: `tests/cli/autoReplyProfileDispatcher.test.mjs`
- Modify: `tests/cli/runtime.test.mjs`

- [ ] **Step 1: Write failing host runner tests**

Append to `tests/chat/hostLlmChatReplyRunner.test.mjs`:

```js
test('host LLM chat runner injects only resolved allowed chat skills', async () => {
  const runtime = {
    id: 'llm-runtime-1',
    provider: 'codex',
    displayName: 'Codex',
    binaryPath: '/bin/codex',
    authState: 'authenticated',
    health: 'healthy',
    capabilities: ['streaming'],
    lastSeenAt: '2026-06-03T00:00:00.000Z',
    createdAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-03T00:00:00.000Z',
  };
  const executorCalls = [];
  const runner = createHostLlmChatReplyRunner({
    runtimeResolver: createFakeRuntimeResolver(runtime),
    llmExecutor: {
      async execute(request) {
        executorCalls.push(request);
        return 'llm-session-allowed-skills';
      },
      async getSession(sessionId) {
        return {
          sessionId,
          status: 'completed',
          result: {
            status: 'completed',
            output: 'Weather checked. It is sunny.',
            durationMs: 8,
          },
        };
      },
    },
    metaBotSlug: 'alice',
    pollIntervalMs: 1,
    allowedChatSkillsResolver: async () => ({
      skills: ['metabot-weather'],
      skillSourcePaths: {
        'metabot-weather': '/tmp/metabot-weather',
      },
      skippedSkills: [],
      warning: null,
    }),
  });

  const result = await runner(makeInput());

  assert.deepEqual(result, { state: 'reply', content: 'Weather checked. It is sunny.' });
  assert.deepEqual(executorCalls[0].skills, ['metabot-weather']);
  assert.deepEqual(executorCalls[0].skillSourcePaths, {
    'metabot-weather': '/tmp/metabot-weather',
  });
  assert.match(executorCalls[0].prompt, /only skills available for this private chat turn/i);
  assert.match(executorCalls[0].prompt, /metabot-weather/);
});

test('host LLM chat runner does not inject skills when resolver returns none', async () => {
  const runtime = {
    id: 'llm-runtime-1',
    provider: 'codex',
    displayName: 'Codex',
    binaryPath: '/bin/codex',
    authState: 'authenticated',
    health: 'healthy',
    capabilities: ['streaming'],
    lastSeenAt: '2026-06-03T00:00:00.000Z',
    createdAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-03T00:00:00.000Z',
  };
  const executorCalls = [];
  const runner = createHostLlmChatReplyRunner({
    runtimeResolver: createFakeRuntimeResolver(runtime),
    llmExecutor: {
      async execute(request) {
        executorCalls.push(request);
        return 'llm-session-no-skills';
      },
      async getSession(sessionId) {
        return {
          sessionId,
          status: 'completed',
          result: {
            status: 'completed',
            output: 'Plain reply.',
            durationMs: 8,
          },
        };
      },
    },
    metaBotSlug: 'alice',
    pollIntervalMs: 1,
    allowedChatSkillsResolver: async () => ({
      skills: [],
      skillSourcePaths: {},
      skippedSkills: ['metabot-missing'],
      warning: 'Configured chat skills are not currently available: metabot-missing',
    }),
  });

  await runner(makeInput());

  assert.equal(Object.prototype.hasOwnProperty.call(executorCalls[0], 'skills'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(executorCalls[0], 'skillSourcePaths'), false);
  assert.doesNotMatch(executorCalls[0].prompt, /metabot-missing/);
});
```

- [ ] **Step 2: Write failing private chat resolver tests**

Create `tests/chat/privateChatAllowedSkills.test.mjs`:

```js
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createLlmBindingStore } = require('../../dist/core/llm/llmBindingStore.js');
const { createLlmRuntimeStore } = require('../../dist/core/llm/llmRuntimeStore.js');
const {
  createMetabotProfile,
  updateMetabotProfile,
} = require('../../dist/core/bot/metabotProfileManager.js');
const { createPrivateChatAllowedSkillsResolver } = require('../../dist/core/chat/privateChatAllowedSkills.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');

function runtime(id, provider, health = 'healthy') {
  const now = '2026-06-03T00:00:00.000Z';
  return {
    id,
    provider,
    displayName: `${provider} runtime`,
    binaryPath: `/bin/${provider}`,
    version: '1.0.0',
    authState: 'authenticated',
    health,
    capabilities: ['tool-use'],
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

async function createContext() {
  const systemHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oac-private-chat-allowed-skills-'));
  const created = await createMetabotProfile(systemHomeDir, {
    name: 'Allowed Skills Bot',
  });
  const profile = await updateMetabotProfile(systemHomeDir, created.slug, {
    allowChatSkills: ['metabot-weather', 'metabot-missing'],
  });
  const paths = resolveMetabotPaths(profile.homeDir);
  await createLlmRuntimeStore(paths).write({
    version: 1,
    runtimes: [
      runtime('runtime-codex', 'codex'),
    ],
  });
  await createLlmBindingStore(paths).write({
    version: 1,
    bindings: [
      {
        id: 'binding-codex-primary',
        metaBotSlug: profile.slug,
        llmRuntimeId: 'runtime-codex',
        role: 'primary',
        priority: 0,
        enabled: true,
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z',
      },
    ],
  });
  const skillRoot = path.join(systemHomeDir, '.codex', 'skills', 'metabot-weather');
  await fs.mkdir(skillRoot, { recursive: true });
  await fs.writeFile(path.join(skillRoot, 'SKILL.md'), '# metabot-weather\n', 'utf8');
  return { systemHomeDir, profile, paths };
}

test('private chat allowed skills resolver returns exact executable skills and source paths', async (t) => {
  const context = await createContext();
  t.after(async () => {
    await fs.rm(context.systemHomeDir, { recursive: true, force: true });
  });
  const resolver = createPrivateChatAllowedSkillsResolver({
    paths: context.paths,
    metaBotSlug: context.profile.slug,
    runtimeStore: createLlmRuntimeStore(context.paths),
    bindingStore: createLlmBindingStore(context.paths),
    env: {},
  });

  const result = await resolver();

  assert.deepEqual(result.skills, ['metabot-weather']);
  assert.ok(result.skillSourcePaths['metabot-weather'].endsWith(path.join('.codex', 'skills', 'metabot-weather')));
  assert.deepEqual(result.skippedSkills, ['metabot-missing']);
});

test('private chat allowed skills resolver returns empty scope for profiles with no allowChatSkills', async (t) => {
  const systemHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oac-private-chat-no-skills-'));
  t.after(async () => {
    await fs.rm(systemHomeDir, { recursive: true, force: true });
  });
  const profile = await createMetabotProfile(systemHomeDir, { name: 'No Skills Bot' });
  const paths = resolveMetabotPaths(profile.homeDir);
  const resolver = createPrivateChatAllowedSkillsResolver({
    paths,
    metaBotSlug: profile.slug,
    runtimeStore: createLlmRuntimeStore(paths),
    bindingStore: createLlmBindingStore(paths),
    env: {},
  });

  const result = await resolver();

  assert.deepEqual(result.skills, []);
  assert.deepEqual(result.skillSourcePaths, {});
  assert.deepEqual(result.skippedSkills, []);
});
```

- [ ] **Step 3: Write failing CLI runtime wiring tests**

In `tests/cli/autoReplyProfileDispatcher.test.mjs`, update imports:

```js
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
```

Add requires near the existing `require('../../dist/...')` declarations:

```js
const { createLlmBindingStore } = require('../../dist/core/llm/llmBindingStore.js');
const { createLlmRuntimeStore } = require('../../dist/core/llm/llmRuntimeStore.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
```

Append:

```js
function chatRunnerInput(content = 'Can you check the weather?') {
  return {
    conversation: {
      conversationId: 'pc-beta-peer',
      peerGlobalMetaId: 'idq1peer00000000000000000000000000000',
      peerName: 'Peer Bot',
      topic: null,
      strategyId: null,
      state: 'active',
      turnCount: 1,
      lastDirection: 'inbound',
      createdAt: 1_777_000_000_000,
      updatedAt: 1_777_000_000_001,
    },
    recentMessages: [],
    persona: { role: '', soul: '', goal: '' },
    strategy: null,
    inboundMessage: {
      conversationId: 'pc-beta-peer',
      messageId: 'inbound-1',
      direction: 'inbound',
      senderGlobalMetaId: 'idq1peer00000000000000000000000000000',
      content,
      messagePinId: 'incoming-pin-1',
      extensions: null,
      timestamp: 1_777_000_000_001,
    },
  };
}

function healthyRuntime(id = 'runtime-codex') {
  const now = '2026-06-03T00:00:00.000Z';
  return {
    id,
    provider: 'codex',
    displayName: 'Codex',
    binaryPath: '/bin/codex',
    version: '1.0.0',
    authState: 'authenticated',
    health: 'healthy',
    capabilities: ['tool-use'],
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

async function configureAllowedChatSkillProfile(systemHomeDir, profileHomeDir, slug) {
  const paths = resolveMetabotPaths(profileHomeDir);
  await mkdir(path.dirname(paths.chatSkillPolicyPath), { recursive: true });
  await writeFile(paths.chatSkillPolicyPath, JSON.stringify({
    allowChatSkills: ['metabot-weather'],
    updatedAt: '2026-06-03T00:00:00.000Z',
  }, null, 2) + '\n', 'utf8');
  await createLlmRuntimeStore(paths).write({
    version: 1,
    runtimes: [healthyRuntime()],
  });
  await createLlmBindingStore(paths).write({
    version: 1,
    bindings: [{
      id: 'binding-codex-primary',
      metaBotSlug: slug,
      llmRuntimeId: 'runtime-codex',
      role: 'primary',
      priority: 0,
      enabled: true,
      createdAt: '2026-06-03T00:00:00.000Z',
      updatedAt: '2026-06-03T00:00:00.000Z',
    }],
  });
  const skillRoot = path.join(systemHomeDir, '.codex', 'skills', 'metabot-weather');
  await mkdir(skillRoot, { recursive: true });
  await writeFile(path.join(skillRoot, 'SKILL.md'), '# metabot-weather\n', 'utf8');
}

test('auto-reply dispatcher default runner wires allowed chat skills for non-active profiles', async (t) => {
  const systemHomeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-auto-reply-dispatcher-skills-'));
  const betaHomeDir = await createRegisteredProfile(t, systemHomeDir, {
    slug: 'beta-bot',
    name: 'Beta Bot',
    globalMetaId: 'idq1beta00000000000000000000000000000',
  });
  await configureAllowedChatSkillProfile(systemHomeDir, betaHomeDir, 'beta-bot');
  const executorCalls = [];

  const dispatcher = createPrivateChatAutoReplyProfileDispatcher({
    autoReplyConfig: {
      enabled: true,
      acceptPolicy: 'accept_all',
      defaultStrategyId: null,
    },
    resolvePeerChatPublicKey: async () => 'peer-chat-key',
    llmExecutor: {
      execute: async (request) => {
        executorCalls.push(request);
        return 'session-with-skills';
      },
      getSession: async (sessionId) => ({
        sessionId,
        status: 'completed',
        result: {
          status: 'completed',
          output: 'Weather result.',
          durationMs: 1,
        },
      }),
    },
    createSignerForHome: () => ({
      getIdentity: async () => ({ globalMetaId: 'idq1beta00000000000000000000000000000', mvcAddress: 'mvc-beta' }),
      getPrivateChatIdentity: async () => ({ globalMetaId: 'idq1beta00000000000000000000000000000', privateKeyHex: 'private-key', chatPublicKey: 'chat-public-key' }),
      writePin: async () => { throw new Error('reply sending is not part of this wiring test'); },
    }),
    createOrchestrator: (deps) => ({
      handleInboundMessage: async () => {
        await deps.replyRunner(chatRunnerInput());
      },
    }),
  });

  await dispatcher.handleInboundMessage({
    name: 'Beta Bot',
    slug: 'beta-bot',
    aliases: ['beta-bot'],
    homeDir: betaHomeDir,
    globalMetaId: 'idq1beta00000000000000000000000000000',
    mvcAddress: 'mvc-beta',
    createdAt: 1_777_000_000_000,
    updatedAt: 1_777_000_000_000,
  }, {
    fromGlobalMetaId: 'idq1peer00000000000000000000000000000',
    content: 'hello beta',
    messagePinId: 'incoming-pin-1',
    fromChatPublicKey: 'peer-chat-key',
    timestamp: 1_777_000_000_001,
    rawMessage: null,
  });

  assert.deepEqual(executorCalls[0].skills, ['metabot-weather']);
  assert.ok(executorCalls[0].skillSourcePaths['metabot-weather'].endsWith(path.join('.codex', 'skills', 'metabot-weather')));
});
```

In `tests/cli/runtime.test.mjs`, update the runtime import to include the new factory:

```js
const {
  createPrivateChatReplyRunnerForProfile,
  getDefaultDaemonPort,
  refreshA2ASimplemsgListenerForIdentityProfileRegistration,
} = require('../../dist/cli/runtime.js');
```

Add requires:

```js
const {
  createMetabotProfile,
  updateMetabotProfile,
} = require('../../dist/core/bot/metabotProfileManager.js');
const { createLlmBindingStore } = require('../../dist/core/llm/llmBindingStore.js');
const { createLlmRuntimeStore } = require('../../dist/core/llm/llmRuntimeStore.js');
const { createLlmRuntimeResolver } = require('../../dist/core/llm/llmRuntimeResolver.js');
```

Append:

```js
function chatRunnerInput(content = 'Use the weather skill') {
  return {
    conversation: {
      conversationId: 'pc-active-peer',
      peerGlobalMetaId: 'idq1peer00000000000000000000000000000',
      peerName: 'Peer Bot',
      topic: null,
      strategyId: null,
      state: 'active',
      turnCount: 1,
      lastDirection: 'inbound',
      createdAt: 1_777_000_000_000,
      updatedAt: 1_777_000_000_001,
    },
    recentMessages: [],
    persona: { role: '', soul: '', goal: '' },
    strategy: null,
    inboundMessage: {
      conversationId: 'pc-active-peer',
      messageId: 'inbound-1',
      direction: 'inbound',
      senderGlobalMetaId: 'idq1peer00000000000000000000000000000',
      content,
      messagePinId: 'incoming-pin-1',
      extensions: null,
      timestamp: 1_777_000_000_001,
    },
  };
}

test('createPrivateChatReplyRunnerForProfile wires allowed chat skills for the active profile path', async (t) => {
  const systemHome = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-runtime-active-chat-skills-'));
  t.after(async () => {
    await rm(systemHome, { recursive: true, force: true });
  });
  const created = await createMetabotProfile(systemHome, { name: 'Active Skills Bot' });
  const profile = await updateMetabotProfile(systemHome, created.slug, {
    allowChatSkills: ['metabot-weather'],
  });
  const paths = resolveMetabotPaths(profile.homeDir);
  await createLlmRuntimeStore(paths).write({
    version: 1,
    runtimes: [{
      id: 'runtime-codex',
      provider: 'codex',
      displayName: 'Codex',
      binaryPath: '/bin/codex',
      version: '1.0.0',
      authState: 'authenticated',
      health: 'healthy',
      capabilities: ['tool-use'],
      lastSeenAt: '2026-06-03T00:00:00.000Z',
      createdAt: '2026-06-03T00:00:00.000Z',
      updatedAt: '2026-06-03T00:00:00.000Z',
    }],
  });
  await createLlmBindingStore(paths).write({
    version: 1,
    bindings: [{
      id: 'binding-codex-primary',
      metaBotSlug: profile.slug,
      llmRuntimeId: 'runtime-codex',
      role: 'primary',
      priority: 0,
      enabled: true,
      createdAt: '2026-06-03T00:00:00.000Z',
      updatedAt: '2026-06-03T00:00:00.000Z',
    }],
  });
  const skillRoot = path.join(systemHome, '.codex', 'skills', 'metabot-weather');
  await mkdir(skillRoot, { recursive: true });
  await writeFile(path.join(skillRoot, 'SKILL.md'), '# metabot-weather\n', 'utf8');
  const runtimeStore = createLlmRuntimeStore(paths);
  const bindingStore = createLlmBindingStore(paths);
  const executorCalls = [];
  const runner = createPrivateChatReplyRunnerForProfile({
    paths,
    metaBotSlug: profile.slug,
    runtimeResolver: createLlmRuntimeResolver({
      runtimeStore,
      bindingStore,
      getPreferredRuntimeId: async () => null,
    }),
    runtimeStore,
    bindingStore,
    llmExecutor: {
      execute: async (request) => {
        executorCalls.push(request);
        return 'active-session-with-skills';
      },
      getSession: async (sessionId) => ({
        sessionId,
        status: 'completed',
        result: {
          status: 'completed',
          output: 'Weather result.',
          durationMs: 1,
        },
      }),
    },
    env: {},
  });

  await runner(chatRunnerInput());

  assert.deepEqual(executorCalls[0].skills, ['metabot-weather']);
  assert.ok(executorCalls[0].skillSourcePaths['metabot-weather'].endsWith(path.join('.codex', 'skills', 'metabot-weather')));
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run:

```bash
npm run build
node --test tests/chat/hostLlmChatReplyRunner.test.mjs
node --test tests/chat/privateChatAllowedSkills.test.mjs
node --test tests/cli/autoReplyProfileDispatcher.test.mjs
node --test tests/cli/runtime.test.mjs --test-name-pattern "createPrivateChatReplyRunnerForProfile"
```

Expected: tests fail because resolver types and runner wiring do not exist.

- [ ] **Step 5: Add private chat allowed-skill resolver module**

Create `src/core/chat/privateChatAllowedSkills.ts`:

```ts
import type { LlmBindingStore } from '../llm/llmBindingStore';
import type { LlmRuntimeStore } from '../llm/llmRuntimeStore';
import type { MetabotPaths } from '../state/paths';
import { getMetabotProfile } from '../bot/metabotProfileManager';
import { resolveAllowChatSkillsForRuntime } from '../services/chatSkillPolicy';

export interface PrivateChatAllowedSkillScope {
  skills: string[];
  skillSourcePaths: Record<string, string>;
  skippedSkills: string[];
  warning: string | null;
}

export type PrivateChatAllowedSkillsResolver = () => Promise<PrivateChatAllowedSkillScope>;

export function emptyPrivateChatAllowedSkillScope(): PrivateChatAllowedSkillScope {
  return {
    skills: [],
    skillSourcePaths: {},
    skippedSkills: [],
    warning: null,
  };
}

export function createPrivateChatAllowedSkillsResolver(input: {
  paths: MetabotPaths;
  metaBotSlug: string;
  runtimeStore: LlmRuntimeStore;
  bindingStore: LlmBindingStore;
  env?: NodeJS.ProcessEnv;
  logWarning?: (scope: string, message: string) => void;
}): PrivateChatAllowedSkillsResolver {
  return async () => {
    const profile = await getMetabotProfile(input.paths.systemHomeDir, input.metaBotSlug);
    const allowChatSkills = profile?.allowChatSkills ?? [];
    if (allowChatSkills.length === 0) {
      return emptyPrivateChatAllowedSkillScope();
    }
    const result = await resolveAllowChatSkillsForRuntime({
      metaBotSlug: input.metaBotSlug,
      allowChatSkills,
      runtimeStore: input.runtimeStore,
      bindingStore: input.bindingStore,
      systemHomeDir: input.paths.systemHomeDir,
      projectRoot: input.paths.profileRoot,
      env: input.env,
    });
    if (result.warning) {
      input.logWarning?.('[private chat allowed skills]', result.warning);
    }
    return {
      skills: result.skills.map((skill) => skill.skillName),
      skillSourcePaths: result.skillSourcePaths,
      skippedSkills: result.skippedSkills,
      warning: result.warning ?? null,
    };
  };
}
```

- [ ] **Step 6: Update host LLM chat runner**

Modify `src/core/chat/hostLlmChatReplyRunner.ts`.

Import the scope type:

```ts
import {
  emptyPrivateChatAllowedSkillScope,
  type PrivateChatAllowedSkillScope,
  type PrivateChatAllowedSkillsResolver,
} from './privateChatAllowedSkills';
```

Change `buildChatPrompt` signature:

```ts
function buildChatPrompt(
  input: ChatReplyRunnerInput,
  allowedSkillScope: PrivateChatAllowedSkillScope = emptyPrivateChatAllowedSkillScope(),
): string {
```

Before the Format Rules section, add:

```ts
if (allowedSkillScope.skills.length > 0) {
  sections.push([
    '## Available Private Chat Skills',
    'These are the only skills available for this private chat turn.',
    'Use them only when they help answer or complete the sender request.',
    ...allowedSkillScope.skills.map((skillName) => `- ${skillName}`),
  ].join('\n'));
}
```

Add `allowedSkillScope` to `tryExecute()`:

```ts
  allowedSkillScope: PrivateChatAllowedSkillScope,
```

When calling `llmExecutor.execute()`, include skills only when non-empty:

```ts
const skillRequest = allowedSkillScope.skills.length > 0
  ? {
    skills: allowedSkillScope.skills,
    skillSourcePaths: allowedSkillScope.skillSourcePaths,
  }
  : {};

const sessionId = await llmExecutor.execute({
  runtimeId: resolved.runtime.id,
  runtime: resolved.runtime,
  prompt,
  timeout: timeoutMs,
  metaBotSlug,
  ...skillRequest,
});
```

Extend `createHostLlmChatReplyRunner()` options:

```ts
  allowedChatSkillsResolver?: PrivateChatAllowedSkillsResolver;
  logWarning?: (scope: string, message: string) => void;
```

Before building the prompt:

```ts
let allowedSkillScope = emptyPrivateChatAllowedSkillScope();
if (options?.allowedChatSkillsResolver) {
  try {
    allowedSkillScope = await options.allowedChatSkillsResolver();
  } catch (error) {
    options.logWarning?.(
      '[private chat allowed skills]',
      error instanceof Error ? error.message : String(error),
    );
  }
}
const prompt = buildChatPrompt(input, allowedSkillScope);
```

Pass `allowedSkillScope` into every `tryExecute()` call.

- [ ] **Step 7: Wire CLI runtime active and multi-profile dispatch**

Modify `src/cli/runtime.ts`.

Import:

```ts
import { createPrivateChatAllowedSkillsResolver } from '../core/chat/privateChatAllowedSkills';
```

Add this exported factory near `createPrivateChatAutoReplyProfileDispatcher()`:

```ts
export function createPrivateChatReplyRunnerForProfile(input: {
  paths: MetabotPaths;
  metaBotSlug: string;
  runtimeResolver: ReturnType<typeof createLlmRuntimeResolver>;
  runtimeStore: ReturnType<typeof createLlmRuntimeStore>;
  bindingStore: ReturnType<typeof createLlmBindingStore>;
  llmExecutor: Pick<LlmExecutor, 'execute' | 'getSession'>;
  env?: NodeJS.ProcessEnv;
  logWarning?: (scope: string, message: string) => void;
}): ChatReplyRunner {
  return createHostLlmChatReplyRunner({
    runtimeResolver: input.runtimeResolver,
    llmExecutor: input.llmExecutor,
    metaBotSlug: input.metaBotSlug,
    allowedChatSkillsResolver: createPrivateChatAllowedSkillsResolver({
      paths: input.paths,
      metaBotSlug: input.metaBotSlug,
      runtimeStore: input.runtimeStore,
      bindingStore: input.bindingStore,
      env: input.env ?? process.env,
      logWarning: input.logWarning,
    }),
    logWarning: input.logWarning,
  });
}
```

In `createPrivateChatAutoReplyProfileDispatcher()`, replace the default `createHostLlmChatReplyRunner()` call with:

```ts
createPrivateChatReplyRunnerForProfile({
  paths: profilePaths,
  metaBotSlug,
  runtimeResolver: profileRuntimeResolver,
  runtimeStore: profileRuntimeStoreForLlm,
  bindingStore: profileBindingStore,
  llmExecutor: input.llmExecutor,
  env: process.env,
  logWarning: (scope, message) => console.warn(scope, message),
})
```

In the active profile private chat orchestrator, replace the direct `createHostLlmChatReplyRunner()` call with:

```ts
createPrivateChatReplyRunnerForProfile({
  paths,
  metaBotSlug,
  runtimeResolver: llmResolver,
  runtimeStore: llmRuntimeStore,
  bindingStore: llmBindingStore,
  llmExecutor,
  env: process.env,
  logWarning: (scope, message) => console.warn(scope, message),
})
```

Use the existing variable names in `runtime.ts`; if the active stores have different local names, use the already-created LLM runtime and binding stores from the same scope as `llmResolver`.

- [ ] **Step 8: Run focused verification**

Run:

```bash
npm run build
node --test tests/services/chatSkillPolicy.test.mjs
node --test tests/chat/privateChatAllowedSkills.test.mjs
node --test tests/chat/hostLlmChatReplyRunner.test.mjs
node --test tests/chat/privateChatAutoReply.test.mjs
node --test tests/chat/privateChatAutoReplyBackfill.test.mjs
node --test tests/cli/autoReplyProfileDispatcher.test.mjs
node --test tests/cli/runtime.test.mjs --test-name-pattern "createPrivateChatReplyRunnerForProfile"
```

Expected: all listed commands pass.

- [ ] **Step 9: Commit and post diary**

Run:

```bash
git add src/core/chat/privateChatAllowedSkills.ts tests/chat/privateChatAllowedSkills.test.mjs src/core/chat/hostLlmChatReplyRunner.ts src/cli/runtime.ts tests/chat/hostLlmChatReplyRunner.test.mjs tests/cli/autoReplyProfileDispatcher.test.mjs tests/cli/runtime.test.mjs
git commit -m "feat: enforce chat allowed skills in private replies"
```

Then use `metabot-post-buzz` to publish a diary covering executor-level enforcement, active and multi-profile wiring, and verification commands.

## Task 6: Integration Verification and Final Review

**Files:**
- Modify only if focused verification reveals a real defect in files touched by Tasks 1-5.

- [ ] **Step 1: Run the feature verification set**

Run:

```bash
npm run build
node --test tests/services/chatSkillPolicy.test.mjs
node --test tests/services/servicePublishValidation.test.mjs
node --test tests/bot/metabotProfileManager.test.mjs
node --test tests/daemon/defaultBotHandlers.test.mjs
node --test tests/ui/botPageScript.test.mjs
node --test tests/chat/privateChatAllowedSkills.test.mjs
node --test tests/chat/hostLlmChatReplyRunner.test.mjs
node --test tests/chat/privateChatAutoReply.test.mjs
node --test tests/chat/privateChatAutoReplyBackfill.test.mjs
node --test tests/cli/autoReplyProfileDispatcher.test.mjs
node --test tests/cli/runtime.test.mjs --test-name-pattern "createPrivateChatReplyRunnerForProfile"
```

Expected: all listed commands pass.

- [ ] **Step 2: Inspect final git scope**

Run:

```bash
git status --short --branch
git log --oneline --decorate -6
```

Expected:

- The branch is the feature branch.
- The branch contains one commit per completed implementation task.
- Unrelated `.codex_tmp/` remains untracked and untouched.
- No unexpected files are staged.

- [ ] **Step 3: Dispatch final subagent reviews**

Use subagent-driven development review gates:

- Dispatch a spec compliance reviewer with the design spec path, this plan path, and the commit range from the feature branch base to `HEAD`.
- Dispatch a code quality reviewer only after spec compliance passes.
- Use model `gpt-5.5` for both review subagents.

Review prompts must explicitly check:

- `/ui/bot` detail page has the skill picker.
- New Bot modal does not include skill selection or `allowChatSkills`.
- Skill options come from the Skill Service catalog endpoint.
- Save-time validation fails for unsafe or unavailable skills.
- `/info/bio` includes `allowChatSkills`.
- Empty allow-list does not inject any skills.
- Non-empty allow-list never falls back to all installed skills.
- Private chat execution passes exact `skills` and `skillSourcePaths`.
- Active and multi-profile private chat paths are wired.

- [ ] **Step 4: Fix review findings, if any**

If a reviewer finds Critical or Important issues, make the smallest targeted fix in the relevant task files, rerun the smallest failing verification command, then commit:

```bash
git add <fixed-files>
git commit -m "fix: address chat allowed skills review"
```

Then use `metabot-post-buzz` to publish a diary covering the review finding and fix.

- [ ] **Step 5: Report implementation status**

Prepare a concise status for the user:

- Final branch name.
- Commit list.
- Verification commands and pass/fail result.
- Review result.
- Any residual risk or intentionally deferred CLI convenience commands.
