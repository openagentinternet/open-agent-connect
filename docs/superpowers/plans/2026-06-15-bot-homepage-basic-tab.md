# Bot Homepage Basic Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `/ui/bot` Basic tab Homepage editing so users can save `/info/homepage` as either a `metafile://` resource or a `metaapp://` resource.

**Architecture:** Add a small core homepage model and local state file, thread it through profile update and MVC profile sync, add a Bot-scoped upload endpoint for browser file bytes, then replace the Basic tab placeholder with the selected two-entry Homepage panel. File upload writes `/file` immediately; `/info/homepage` is written only by `Save Public Identity`.

**Tech Stack:** TypeScript CommonJS source, strict `tsc`, Node test runner, static local UI script generated from `src/ui/pages/bot/app.ts`, daemon JSON routes.

---

## File Structure

- Modify `src/core/state/paths.ts`
  - Add `homepageStatePath` under `.runtime/state/homepage.json`.
- Create `src/core/bot/metabotHomepage.ts`
  - Normalize, compare, read, write, and serialize homepage JSON.
- Modify `src/core/bot/metabotProfileManager.ts`
  - Add `homepage` to `MetabotProfileFull` and `UpdateMetabotInfoInput`.
  - Read/write local homepage state.
  - Sync `/info/homepage` as JSON on MVC.
- Modify `src/core/files/uploadFile.ts`
  - Add buffer-based upload helper for browser-provided file bytes.
- Modify `src/daemon/routes/types.ts`
  - Add `handlers.bot.uploadHomepageFile`.
- Modify `src/daemon/routes/bot.ts`
  - Add `POST /api/bot/profiles/:slug/homepage/upload`.
- Modify `src/daemon/defaultHandlers.ts`
  - Normalize homepage profile updates.
  - Include homepage in change detection and chain profile projection.
  - Implement default homepage upload handler.
- Modify `src/ui/pages/bot/app.ts`
  - Replace placeholder Homepage row with dedicated panel and draft behavior.
- Modify `src/ui/pages/bot/index.html`
  - Add restrained styles for the Homepage panel.
- Modify `src/ui/i18n.ts` and `tests/ui/i18n.test.mjs`
  - Add English and Chinese strings for the new controls and statuses.
- Modify tests:
  - `tests/bot/metabotProfileManager.test.mjs`
  - `tests/daemon/defaultBotHandlers.test.mjs`
  - `tests/daemon/httpServer.test.mjs`
  - `tests/ui/botPageScript.test.mjs`

---

## Task 1: Core Homepage Model And Profile Sync

**Files:**
- Create: `src/core/bot/metabotHomepage.ts`
- Modify: `src/core/state/paths.ts`
- Modify: `src/core/bot/metabotProfileManager.ts`
- Test: `tests/bot/metabotProfileManager.test.mjs`

- [ ] **Step 1: Write failing profile-manager tests**

Append these tests to `tests/bot/metabotProfileManager.test.mjs` near the existing `updateMetabotProfile` and `syncMetabotInfoToChain` coverage:

```js
test('updateMetabotProfile persists homepage JSON under runtime state', async (t) => {
  const homeDir = await createProfileHome('metabot-homepage-profile-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const created = await createMetabotProfile(systemHomeDir, {
    name: 'Homepage Bot',
    bio: 'Original bio.',
  });

  const homepage = {
    uri: 'metaapp://metaapp-pin-123',
    renderer: 'metaapp',
    contentType: 'application/vnd.metaapp',
  };
  const updated = await updateMetabotProfile(systemHomeDir, created.slug, { homepage });
  const loaded = await getMetabotProfile(systemHomeDir, created.slug);
  const paths = resolveMetabotPaths(created.homeDir);
  const persisted = JSON.parse(await readFile(paths.homepageStatePath, 'utf8'));

  assert.deepEqual(updated.homepage, homepage);
  assert.deepEqual(loaded.homepage, homepage);
  assert.deepEqual(persisted, homepage);
});

test('syncMetabotInfoToChain writes homepage JSON to /info/homepage on MVC', async () => {
  const calls = [];
  const signer = {
    getIdentity: async () => ({}),
    getPrivateChatIdentity: async () => ({}),
    writePin: async (input) => {
      calls.push(input);
      return {
        txids: [`tx-${calls.length}`],
        pinId: `pin-${calls.length}`,
        totalCost: 1,
        network: input.network,
        operation: input.operation,
        path: input.path,
        contentType: input.contentType,
        encoding: input.encoding,
        globalMetaId: 'gid',
        mvcAddress: 'addr',
      };
    },
  };
  const homepage = {
    uri: 'metafile://file-pin-123',
    renderer: 'auto',
    contentType: 'image/png',
  };

  const results = await syncMetabotInfoToChain(signer, {
    name: 'Alice',
    slug: 'alice',
    aliases: [],
    homeDir: '/tmp/alice',
    globalMetaId: 'gid',
    mvcAddress: 'addr',
    createdAt: 1,
    updatedAt: 2,
    bio: 'Public bio',
    role: 'Role',
    soul: 'Soul',
    goal: 'Goal',
    primaryProvider: 'codex',
    fallbackProvider: null,
    allowChatSkills: [],
    homepage,
  }, ['homepage'], { delayMs: 0 });

  assert.equal(results.length, 1);
  assert.deepEqual(calls.map((call) => call.path), ['/info/homepage']);
  assert.equal(calls[0].network, 'mvc');
  assert.equal(calls[0].contentType, 'application/json');
  assert.equal(calls[0].encoding, 'utf-8');
  assert.deepEqual(JSON.parse(calls[0].payload), homepage);
});
```

Add `readFile` to the existing `node:fs/promises` import in that test file:

```js
import { access, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```bash
npm run build && node --test tests/bot/metabotProfileManager.test.mjs
```

Expected: build or test fails because `homepageStatePath` and homepage profile fields do not exist.

- [ ] **Step 3: Add the homepage state path**

Modify `src/core/state/paths.ts`.

Add to `MetabotPaths`:

```ts
  homepageStatePath: string;
```

Add to `buildMetabotPaths()` return object immediately after `chatSkillPolicyPath`:

```ts
    homepageStatePath: path.join(input.stateRoot, 'homepage.json'),
```

No extra constructor argument is needed because `buildMetabotPaths()` already receives `stateRoot`.

- [ ] **Step 4: Create `metabotHomepage.ts`**

Create `src/core/bot/metabotHomepage.ts`:

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';

export type MetabotHomepageRenderer = 'auto' | 'metaapp';

export interface MetabotHomepage {
  uri: string;
  renderer: MetabotHomepageRenderer;
  contentType: string;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeRenderer(value: unknown, uri: string): MetabotHomepageRenderer {
  const renderer = normalizeText(value).toLowerCase();
  if (renderer === 'metaapp') return 'metaapp';
  if (renderer === 'auto') return 'auto';
  return uri.toLowerCase().startsWith('metaapp://') ? 'metaapp' : 'auto';
}

function defaultContentType(uri: string, renderer: MetabotHomepageRenderer): string {
  if (renderer === 'metaapp' || uri.toLowerCase().startsWith('metaapp://')) {
    return 'application/vnd.metaapp';
  }
  return 'application/octet-stream';
}

function validateHomepageUri(uri: string): void {
  if (!uri) {
    throw new Error('Homepage uri is required.');
  }
  if (!/^metafile:\/\/\S+$/iu.test(uri) && !/^metaapp:\/\/\S+$/iu.test(uri)) {
    throw new Error('Homepage uri must start with metafile:// or metaapp:// and must not contain whitespace.');
  }
}

export function normalizeMetabotHomepage(value: unknown): MetabotHomepage | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Homepage must be an object with uri, renderer, and contentType.');
  }
  const record = value as Record<string, unknown>;
  const uri = normalizeText(record.uri);
  validateHomepageUri(uri);
  const renderer = normalizeRenderer(record.renderer, uri);
  const contentType = normalizeText(record.contentType) || defaultContentType(uri, renderer);
  return { uri, renderer, contentType };
}

export function sameMetabotHomepage(left: MetabotHomepage | undefined, right: MetabotHomepage | undefined): boolean {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return left.uri === right.uri
    && left.renderer === right.renderer
    && left.contentType === right.contentType;
}

export async function readMetabotHomepage(filePath: string): Promise<MetabotHomepage | undefined> {
  let raw = '';
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    return normalizeMetabotHomepage(JSON.parse(trimmed));
  } catch {
    return undefined;
  }
}

export async function writeMetabotHomepage(filePath: string, homepage: MetabotHomepage): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(homepage, null, 2)}\n`, 'utf8');
}

export function serializeMetabotHomepagePayload(homepage: MetabotHomepage): string {
  return JSON.stringify(homepage);
}
```

- [ ] **Step 5: Thread homepage through profile manager**

Modify `src/core/bot/metabotProfileManager.ts`.

Add imports:

```ts
import {
  normalizeMetabotHomepage,
  readMetabotHomepage,
  sameMetabotHomepage,
  serializeMetabotHomepagePayload,
  writeMetabotHomepage,
  type MetabotHomepage,
} from './metabotHomepage';
```

Change `PROFILE_INFO_FIELDS` to include homepage:

```ts
const PROFILE_INFO_FIELDS = new Set(['bio', 'role', 'soul', 'goal', 'primaryProvider', 'fallbackProvider', 'allowChatSkills', 'homepage']);
```

Add to `MetabotProfileFull`:

```ts
  homepage?: MetabotHomepage;
```

Add to `UpdateMetabotInfoInput`:

```ts
  homepage?: MetabotHomepage;
```

In `buildMetabotProfileFull()`, read homepage with the existing parallel profile reads:

```ts
  const [bio, role, soul, goal, avatarDataUrl, providerBindings, allowChatSkills, homepage] = await Promise.all([
    readTextFile(paths.bioMdPath),
    readTextFile(paths.roleMdPath),
    readTextFile(paths.soulMdPath),
    readTextFile(paths.goalMdPath),
    readTextFile(resolveAvatarPath(profile.homeDir)),
    readProfileProviderBindings(profile),
    readChatSkillPolicy(paths.chatSkillPolicyPath),
    readMetabotHomepage(paths.homepageStatePath),
  ]);
```

Add to the returned profile object:

```ts
    ...(homepage ? { homepage } : {}),
```

In `updateMetabotProfile()`, normalize and persist homepage:

```ts
  const homepage = input.homepage === undefined
    ? undefined
    : normalizeMetabotHomepage(input.homepage);
```

Place this near the other normalized update values. Then write it before provider bindings:

```ts
  if (homepage !== undefined) {
    await writeMetabotHomepage(paths.homepageStatePath, homepage);
  }
```

In `syncMetabotInfoToChain()`, add a homepage write inside the `PROFILE_INFO_FIELDS` block after the LLM write:

```ts
    if (changed.has('homepage') && profile.homepage) {
      await writeProfileInfo({
        path: '/info/homepage',
        contentType: 'application/json',
        payload: serializeMetabotHomepagePayload(profile.homepage),
      });
    }
```

Export `sameMetabotHomepage` from `metabotProfileManager.ts` only if `defaultHandlers.ts` needs to import it from this module. Prefer importing it directly from `./metabotHomepage`.

- [ ] **Step 6: Run the focused test and confirm pass**

Run:

```bash
npm run build && node --test tests/bot/metabotProfileManager.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

Run:

```bash
git add src/core/state/paths.ts src/core/bot/metabotHomepage.ts src/core/bot/metabotProfileManager.ts tests/bot/metabotProfileManager.test.mjs
git commit -m "feat: add bot homepage profile metadata"
```

---

## Task 2: Default Bot Profile Update Handler

**Files:**
- Modify: `src/daemon/defaultHandlers.ts`
- Test: `tests/daemon/defaultBotHandlers.test.mjs`

- [ ] **Step 1: Write failing default-handler tests**

Append these tests near the existing `default bot updateProfile` tests in `tests/daemon/defaultBotHandlers.test.mjs`:

```js
test('default bot updateProfile writes homepage chain data before local state', async (t) => {
  const homeDir = await createProfileHome('metabot-default-homepage-update-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const profile = await createMetabotProfile(systemHomeDir, {
    name: 'Homepage Save Bot',
    bio: 'Original bio.',
  });
  await upsertIdentityProfile({
    systemHomeDir,
    name: profile.name,
    homeDir: profile.homeDir,
    globalMetaId: 'gm-homepage-save-bot',
    mvcAddress: 'addr-homepage-save-bot',
  });

  const homepage = {
    uri: 'metaapp://metaapp-pin-123',
    renderer: 'metaapp',
    contentType: 'application/vnd.metaapp',
  };
  const writeCalls = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: profile.homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    signer: makeSigner(async (input) => {
      writeCalls.push(input);
      if (input.path === '/info/homepage') {
        const beforeLocalSave = await getMetabotProfile(systemHomeDir, profile.slug);
        assert.equal(beforeLocalSave.homepage, undefined);
      }
      return {
        txids: [`homepage-save-tx-${writeCalls.length}`],
        pinId: `homepage-save-pin-${writeCalls.length}`,
        totalCost: 1,
        network: 'mvc',
        operation: input.operation,
        path: input.path,
        contentType: input.contentType,
        encoding: input.encoding ?? 'utf-8',
        globalMetaId: 'gm-homepage-save-bot',
        mvcAddress: 'addr-homepage-save-bot',
      };
    }),
  });

  const result = await handlers.bot.updateProfile({
    slug: profile.slug,
    homepage,
  });
  const updated = await getMetabotProfile(systemHomeDir, profile.slug);

  assert.equal(result.ok, true);
  assert.deepEqual(writeCalls.map((call) => call.path), ['/info/homepage']);
  assert.equal(writeCalls[0].contentType, 'application/json');
  assert.deepEqual(JSON.parse(writeCalls[0].payload), homepage);
  assert.deepEqual(result.data.profile.homepage, homepage);
  assert.deepEqual(updated.homepage, homepage);
});

test('default bot updateProfile rejects invalid homepage input without calling signer', async (t) => {
  const homeDir = await createProfileHome('metabot-default-homepage-invalid-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const profile = await createMetabotProfile(systemHomeDir, {
    name: 'Invalid Homepage Bot',
  });
  await upsertIdentityProfile({
    systemHomeDir,
    name: profile.name,
    homeDir: profile.homeDir,
    globalMetaId: 'gm-invalid-homepage-bot',
    mvcAddress: 'addr-invalid-homepage-bot',
  });
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: profile.homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    signer: makeSigner(async () => {
      throw new Error('signer should not be called for invalid homepage input');
    }),
  });

  const result = await handlers.bot.updateProfile({
    slug: profile.slug,
    homepage: {
      uri: 'https://example.com/not-supported',
      renderer: 'auto',
      contentType: 'text/html',
    },
  });
  const afterFailure = await getMetabotProfile(systemHomeDir, profile.slug);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_metabot_profile_update');
  assert.match(result.message, /metafile:\/\/ or metaapp:\/\//i);
  assert.equal(afterFailure.homepage, undefined);
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```bash
npm run build && node --test tests/daemon/defaultBotHandlers.test.mjs
```

Expected: FAIL because default handler does not parse or compare `homepage`.

- [ ] **Step 3: Normalize homepage in default handlers**

Modify `src/daemon/defaultHandlers.ts`.

Add imports near the existing profile manager imports:

```ts
import {
  normalizeMetabotHomepage,
  sameMetabotHomepage,
} from '../core/bot/metabotHomepage';
```

In `buildMetabotUpdateInput()`, add:

```ts
  if (hasOwnField(input, 'homepage')) {
    update.homepage = normalizeMetabotHomepage(input.homepage);
  }
```

In `calculateMetabotChangedFields()`, add:

```ts
  if (
    update.homepage !== undefined
    && !sameMetabotHomepage(update.homepage, current.homepage)
  ) {
    changedFields.push('homepage');
  }
```

In `buildMetabotChainProfile()`, add:

```ts
    ...(update.homepage !== undefined ? { homepage: update.homepage } : {}),
```

- [ ] **Step 4: Run the focused test and confirm pass**

Run:

```bash
npm run build && node --test tests/daemon/defaultBotHandlers.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add src/daemon/defaultHandlers.ts tests/daemon/defaultBotHandlers.test.mjs
git commit -m "feat: sync bot homepage profile updates"
```

---

## Task 3: Homepage File Upload Endpoint

**Files:**
- Modify: `src/core/files/uploadFile.ts`
- Modify: `src/daemon/routes/types.ts`
- Modify: `src/daemon/routes/bot.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Test: `tests/daemon/httpServer.test.mjs`
- Test: `tests/daemon/defaultBotHandlers.test.mjs`

- [ ] **Step 1: Write failing HTTP route test**

In `tests/daemon/httpServer.test.mjs`, update the test server helper calls object to track homepage upload calls:

```js
botHomepageUpload: [],
```

Add this handler under `bot` in the same helper:

```js
uploadHomepageFile: async (input) => {
  calls.botHomepageUpload.push(input);
  return commandSuccess({
    pinId: 'homepage-file-pin-1',
    metafileUri: 'metafile://homepage-file-pin-1.png',
    contentType: input.contentType,
    network: 'mvc',
    txids: ['tx-homepage-file-1'],
    bytes: 7,
  });
},
```

Append this route test near the other `/api/bot/profiles/:slug` tests:

```js
test('POST /api/bot/profiles/:slug/homepage/upload forwards selected file bytes', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const request = {
    fileName: 'cover.png',
    contentType: 'image/png',
    base64: Buffer.from('pngdata').toString('base64'),
  };
  const response = await fetch(`${server.baseUrl}/api/bot/profiles/alice-bot/homepage/upload`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(server.calls.botHomepageUpload, [{ slug: 'alice-bot', ...request }]);
  assert.equal(payload.data.pinId, 'homepage-file-pin-1');
  assert.equal(payload.data.metafileUri, 'metafile://homepage-file-pin-1.png');
});
```

- [ ] **Step 2: Write failing default upload handler test**

Append this test to `tests/daemon/defaultBotHandlers.test.mjs` near file upload coverage:

```js
test('default bot uploadHomepageFile writes selected browser file bytes through profile signer', async (t) => {
  const homeDir = await createProfileHome('metabot-default-homepage-upload-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const profile = await createMetabotProfile(systemHomeDir, {
    name: 'Homepage Upload Bot',
  });
  await upsertIdentityProfile({
    systemHomeDir,
    name: profile.name,
    homeDir: profile.homeDir,
    globalMetaId: 'gm-homepage-upload-bot',
    mvcAddress: 'addr-homepage-upload-bot',
  });

  const writeCalls = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: profile.homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    signer: makeSigner(async (input) => {
      writeCalls.push(input);
      return {
        txids: ['homepage-upload-tx-1'],
        pinId: 'homepage-upload-pin-1',
        totalCost: 1,
        network: input.network,
        operation: input.operation,
        path: input.path,
        contentType: input.contentType,
        encoding: input.encoding,
        globalMetaId: 'gm-homepage-upload-bot',
        mvcAddress: 'addr-homepage-upload-bot',
      };
    }),
  });

  const result = await handlers.bot.uploadHomepageFile({
    slug: profile.slug,
    fileName: 'cover.png',
    contentType: 'image/png',
    base64: Buffer.from('pngdata').toString('base64'),
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.pinId, 'homepage-upload-pin-1');
  assert.equal(result.data.metafileUri, 'metafile://homepage-upload-pin-1.png');
  assert.equal(result.data.bytes, 7);
  assert.deepEqual(writeCalls.map((call) => call.path), ['/file']);
  assert.equal(writeCalls[0].payload, Buffer.from('pngdata').toString('base64'));
  assert.equal(writeCalls[0].contentType, 'image/png');
  assert.equal(writeCalls[0].encoding, 'base64');
});
```

- [ ] **Step 3: Run focused tests and confirm failure**

Run:

```bash
npm run build && node --test tests/daemon/httpServer.test.mjs tests/daemon/defaultBotHandlers.test.mjs
```

Expected: FAIL because `uploadHomepageFile` route and handler do not exist.

- [ ] **Step 4: Add buffer upload helper**

Modify `src/core/files/uploadFile.ts`.

Add this interface after `UploadLocalFileToChainResult`:

```ts
export interface UploadFileBufferToChainResult extends UploadLocalFileToChainResult {}
```

Add this helper before `uploadLocalFileToChain()`:

```ts
export async function uploadFileBufferToChain(input: {
  fileName: string;
  data: Buffer;
  contentType?: string;
  network?: string;
  signer: Signer;
}): Promise<UploadFileBufferToChainResult> {
  const fileName = path.basename(normalizeText(input.fileName) || 'upload.bin');
  const extension = path.extname(fileName).toLowerCase();
  const contentType = normalizeText(input.contentType) || inferUploadContentType(fileName);
  const network = normalizeText(input.network) || 'mvc';
  if (network.toLowerCase() === 'doge') {
    throw new Error('DOGE is not supported for file upload. Use mvc, btc, or opcat.');
  }
  if (!input.data.length) {
    throw new Error('File upload requires non-empty file data.');
  }

  const chainWrite = await input.signer.writePin({
    path: '/file',
    payload: input.data.toString('base64'),
    contentType,
    encoding: 'base64',
    network,
  });

  return {
    pinId: chainWrite.pinId,
    txids: chainWrite.txids,
    totalCost: chainWrite.totalCost,
    network: chainWrite.network,
    filePath: fileName,
    fileName,
    contentType,
    bytes: input.data.byteLength,
    extension,
    metafileUri: `metafile://${chainWrite.pinId}${extension}`,
    globalMetaId: chainWrite.globalMetaId,
  };
}
```

Leave `uploadLocalFileToChain()` unchanged except that it may delegate to the new helper after reading the buffer if desired.

- [ ] **Step 5: Add route type and route**

Modify `src/daemon/routes/types.ts` inside `bot?: { ... }`:

```ts
    uploadHomepageFile?: (input: { slug: string } & Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
```

Modify `src/daemon/routes/bot.ts` before the generic `profileMatch` `GET/PUT/DELETE` block:

```ts
  const homepageUploadMatch = url.pathname.match(/^\/api\/bot\/profiles\/([^/]+)\/homepage\/upload$/);
  if (homepageUploadMatch && req.method === 'POST') {
    const slug = normalizeSlug(homepageUploadMatch[1]);
    const body = await context.readJsonBody();
    const result = handlers.bot?.uploadHomepageFile
      ? await handlers.bot.uploadHomepageFile({ ...body, slug })
      : commandFailed('not_implemented', 'MetaBot homepage upload handler not configured.');
    const status = result.ok ? 200 : result.code === 'profile_not_found' ? 404 : 400;
    context.sendJson(status, result);
    return true;
  }
```

- [ ] **Step 6: Implement default homepage upload handler**

Modify `src/daemon/defaultHandlers.ts`.

Add to the file upload import:

```ts
import { uploadFileBufferToChain, uploadLocalFileToChain } from '../core/files/uploadFile';
```

If `uploadLocalFileToChain` is already imported alone, replace that import rather than adding a duplicate.

Add this helper near other normalization helpers:

```ts
function decodeRequiredBase64(value: unknown): Buffer {
  const base64 = normalizeText(value);
  if (!base64) {
    throw new Error('Homepage upload requires base64 file data.');
  }
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length || buffer.toString('base64').replace(/=+$/u, '') !== base64.replace(/=+$/u, '')) {
    throw new Error('Homepage upload base64 file data is invalid.');
  }
  return buffer;
}
```

Add this method inside the `bot` handler object near `updateProfile`:

```ts
      uploadHomepageFile: async (body) => {
        const slug = normalizeText(body.slug);
        const current = await getMetabotProfile(normalizedSystemHomeDir, slug);
        if (!current) {
          return commandFailed('profile_not_found', `MetaBot profile not found: ${slug || '<missing>'}`);
        }
        if (!current.globalMetaId) {
          return commandFailed(
            'chain_identity_missing',
            'This MetaBot has no chained identity yet, so homepage files cannot be uploaded safely.'
          );
        }

        try {
          const network = await resolveFileUploadNetworkForHome(body.network, current.homeDir);
          const data = decodeRequiredBase64(body.base64);
          const profileSigner = createSignerForProfileHome(current.homeDir);
          const result = await uploadFileBufferToChain({
            fileName: normalizeText(body.fileName) || 'homepage-upload.bin',
            contentType: typeof body.contentType === 'string' ? body.contentType : undefined,
            network,
            data,
            signer: profileSigner,
          });
          return commandSuccess(result);
        } catch (error) {
          return commandFailed(
            'homepage_upload_failed',
            error instanceof Error ? error.message : String(error)
          );
        }
      },
```

- [ ] **Step 7: Run focused tests and confirm pass**

Run:

```bash
npm run build && node --test tests/daemon/httpServer.test.mjs tests/daemon/defaultBotHandlers.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

Run:

```bash
git add src/core/files/uploadFile.ts src/daemon/routes/types.ts src/daemon/routes/bot.ts src/daemon/defaultHandlers.ts tests/daemon/httpServer.test.mjs tests/daemon/defaultBotHandlers.test.mjs
git commit -m "feat: add bot homepage file upload route"
```

---

## Task 4: Basic Tab Homepage UI

**Files:**
- Modify: `src/ui/pages/bot/app.ts`
- Modify: `src/ui/pages/bot/index.html`
- Modify: `src/ui/i18n.ts`
- Test: `tests/ui/botPageScript.test.mjs`
- Test: `tests/ui/i18n.test.mjs`

- [ ] **Step 1: Write failing UI render and save tests**

In `tests/ui/botPageScript.test.mjs`, replace the existing test named `bot page Basic tab groups provider controls in one row and separates Homepage copy from Upload` with:

```js
test('bot page Basic tab renders dedicated Homepage panel with Metafile and MetaApp controls', () => {
  const root = { innerHTML: '' };
  const context = createBotScriptContext({
    elements: {
      '[data-info-content]': root,
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice-bot';
  context.state.profiles = [{
    slug: 'alice-bot',
    name: 'Alice',
    bio: 'Builds wallet automation.',
    primaryProvider: 'codex',
    fallbackProvider: 'openclaw',
    homepage: {
      uri: 'metaapp://metaapp-pin-123',
      renderer: 'metaapp',
      contentType: 'application/vnd.metaapp',
    },
  }];
  context.state.runtimes = [
    { id: 'runtime-codex', provider: 'codex', displayName: 'Codex', health: 'healthy' },
    { id: 'runtime-openclaw', provider: 'openclaw', displayName: 'OpenClaw', health: 'healthy' },
  ];

  context.renderPublicIdentityTab();

  assert.match(root.innerHTML, /<div class="provider-row">[\s\S]*data-field="primaryProvider"[\s\S]*data-field="fallbackProvider"[\s\S]*<\/div>/);
  assert.match(root.innerHTML, /data-homepage-panel/);
  assert.match(root.innerHTML, /data-act="upload-homepage"/);
  assert.match(root.innerHTML, /data-homepage-file-input/);
  assert.match(root.innerHTML, /data-field="homepage-metaapp-pin"/);
  assert.match(root.innerHTML, /data-act="set-homepage-metaapp"/);
  assert.match(root.innerHTML, /metaapp:\/\/metaapp-pin-123/);
  assert.doesNotMatch(root.innerHTML, /Homepage package upload will be available later/);
});
```

Remove the old placeholder modal test named `bot page homepage upload opens a default renderer placeholder modal`, and add:

```js
test('bot page MetaApp homepage input normalizes bare pin IDs into save payload', async () => {
  const fields = {
    '[data-save-status]': field(),
    '[data-act="save-public-identity"]': field(),
    '[data-field="name"]': field('Alice'),
    '[data-field="bio"]': field('Original public bio.'),
    '[data-field="homepage-metaapp-pin"]': field(' metaapp-pin-123 '),
  };
  let requestBody = null;
  const context = createBotScriptContext({
    elements: fields,
    fetch: (_url, options) => {
      requestBody = JSON.parse(options.body);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: {
            profile: {
              slug: 'alice',
              name: 'Alice',
              bio: 'Original public bio.',
              homepage: {
                uri: 'metaapp://metaapp-pin-123',
                renderer: 'metaapp',
                contentType: 'application/vnd.metaapp',
              },
            },
            chainWrites: [],
          },
        }),
      });
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice';
  context.state.profiles = [{
    slug: 'alice',
    name: 'Alice',
    bio: 'Original public bio.',
  }];
  context.state.originalProfile = context.state.profiles[0];
  context.renderMetabotList = () => {};
  context.renderDetailHeader = () => {};
  context.renderPublicIdentityTab = () => {};
  context.showChainSuccessModal = () => {};

  context.setHomepageMetaAppDraft();
  await context.savePublicIdentity();

  assert.deepEqual(requestBody, {
    homepage: {
      uri: 'metaapp://metaapp-pin-123',
      renderer: 'metaapp',
      contentType: 'application/vnd.metaapp',
    },
  });
});

test('bot page homepage upload success stores Metafile draft and save payload', async () => {
  const fields = {
    '[data-save-status]': field(),
    '[data-homepage-status]': field(),
    '[data-act="upload-homepage"]': field(),
    '[data-act="save-public-identity"]': field(),
    '[data-field="name"]': field('Alice'),
    '[data-field="bio"]': field('Original public bio.'),
  };
  let uploadRequest = null;
  let saveRequest = null;
  const context = createBotScriptContext({
    elements: fields,
    fetch: (url, options) => {
      const body = JSON.parse(options.body);
      if (url === '/api/bot/profiles/alice/homepage/upload') {
        uploadRequest = body;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            data: {
              pinId: 'file-pin-123',
              metafileUri: 'metafile://file-pin-123.png',
              contentType: 'image/png',
              txids: ['tx-file-1'],
              bytes: 7,
            },
          }),
        });
      }
      saveRequest = body;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: {
            profile: {
              slug: 'alice',
              name: 'Alice',
              bio: 'Original public bio.',
              homepage: {
                uri: 'metafile://file-pin-123',
                renderer: 'auto',
                contentType: 'image/png',
              },
            },
            chainWrites: [],
          },
        }),
      });
    },
    globals: {
      FileReader: class {
        readAsDataURL() {
          this.result = `data:image/png;base64,${Buffer.from('pngdata').toString('base64')}`;
          this.onload();
        }
      },
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice';
  context.state.profiles = [{
    slug: 'alice',
    name: 'Alice',
    bio: 'Original public bio.',
  }];
  context.state.originalProfile = context.state.profiles[0];
  context.renderMetabotList = () => {};
  context.renderDetailHeader = () => {};
  context.renderPublicIdentityTab = () => {};
  context.showChainSuccessModal = () => {};

  await context.handleHomepageUploadFile({ name: 'cover.png', type: 'image/png' });
  await context.savePublicIdentity();

  assert.deepEqual(uploadRequest, {
    fileName: 'cover.png',
    contentType: 'image/png',
    base64: Buffer.from('pngdata').toString('base64'),
  });
  assert.deepEqual(saveRequest, {
    homepage: {
      uri: 'metafile://file-pin-123',
      renderer: 'auto',
      contentType: 'image/png',
    },
  });
});
```

- [ ] **Step 2: Write failing i18n tests**

In `tests/ui/i18n.test.mjs`, add assertions near the existing Homepage assertions:

```js
  assert.equal(translate('en', 'bot.homepageMetafile'), 'Metafile');
  assert.equal(translate('zh-CN', 'bot.homepageMetafile'), 'MetaFile');
  assert.equal(translate('en', 'bot.homepageMetaApp'), 'MetaApp');
  assert.equal(translate('zh-CN', 'bot.homepageMetaApp'), 'MetaApp');
  assert.equal(translate('en', 'bot.homepageMetaAppHelp'), 'Copy the pin ID from your MetaApp publish result or MetaApp details page.');
  assert.equal(translate('zh-CN', 'bot.homepageMetaAppHelp'), '从 MetaApp 发布结果或详情页复制 pin ID。');
  assert.equal(translate('en', 'bot.homepageReadyToSave'), 'Homepage ready to save.');
  assert.equal(translate('zh-CN', 'bot.homepageReadyToSave'), '主页已准备保存。');
```

- [ ] **Step 3: Run focused UI tests and confirm failure**

Run:

```bash
npm run build && node --test tests/ui/botPageScript.test.mjs tests/ui/i18n.test.mjs
```

Expected: FAIL because the new UI functions and i18n keys do not exist.

- [ ] **Step 4: Add i18n strings**

Modify `src/ui/i18n.ts`.

Add English entries near `bot.homepage`:

```ts
    'bot.homepageSource': 'Custom Bot page source',
    'bot.homepageDefault': 'Default',
    'bot.homepageMetafile': 'Metafile',
    'bot.homepageMetaApp': 'MetaApp',
    'bot.homepageMetafileNote': 'Upload a local file and save it as metafile://<pinId>.',
    'bot.homepageMetaAppNote': 'Paste a MetaApp pin ID and save it as metaapp://<pinId>.',
    'bot.homepageMetaAppHelp': 'Copy the pin ID from your MetaApp publish result or MetaApp details page.',
    'bot.homepagePinPlaceholder': 'MetaApp pin ID',
    'bot.homepageSetMetaApp': 'Set',
    'bot.homepageFinalUri': 'Final URI',
    'bot.homepageDefaultActive': 'Default Bot Page renderer is active.',
    'bot.homepageUploading': 'Uploading homepage file...',
    'bot.homepageReadyToSave': 'Homepage ready to save.',
    'bot.homepageInvalidMetaAppPin': 'Enter a MetaApp pin ID without spaces.',
```

Add Chinese entries near `bot.homepage`:

```ts
    'bot.homepageSource': '自定义 Bot 主页来源',
    'bot.homepageDefault': '默认',
    'bot.homepageMetafile': 'MetaFile',
    'bot.homepageMetaApp': 'MetaApp',
    'bot.homepageMetafileNote': '上传本地文件，并保存为 metafile://<pinId>。',
    'bot.homepageMetaAppNote': '粘贴 MetaApp pin ID，并保存为 metaapp://<pinId>。',
    'bot.homepageMetaAppHelp': '从 MetaApp 发布结果或详情页复制 pin ID。',
    'bot.homepagePinPlaceholder': 'MetaApp pin ID',
    'bot.homepageSetMetaApp': '设置',
    'bot.homepageFinalUri': '最终 URI',
    'bot.homepageDefaultActive': '当前使用默认 Bot Page 渲染器。',
    'bot.homepageUploading': '正在上传主页文件...',
    'bot.homepageReadyToSave': '主页已准备保存。',
    'bot.homepageInvalidMetaAppPin': '请输入不含空格的 MetaApp pin ID。',
```

- [ ] **Step 5: Add Homepage panel styles**

Modify `src/ui/pages/bot/index.html`.

Replace the old `.homepage-row` and `.homepage-renderer-label` block with:

```css
      .homepage-panel {
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        padding: 14px;
        background: var(--panel-soft);
      }
      .homepage-panel-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
      }
      .homepage-panel-title {
        font-weight: 700;
      }
      .homepage-panel-subtitle,
      .homepage-source-note,
      .homepage-final-uri {
        color: var(--muted);
        font-size: 12px;
        line-height: 1.45;
      }
      .homepage-source-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 12px;
      }
      .homepage-source-card {
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        background: var(--card);
        padding: 12px;
        min-width: 0;
      }
      .homepage-source-title {
        display: flex;
        align-items: center;
        gap: 6px;
        font-weight: 650;
        margin-bottom: 6px;
      }
      .homepage-metaapp-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 10px;
      }
      .homepage-metaapp-row input {
        min-width: 0;
      }
      .homepage-help {
        width: 18px;
        height: 18px;
        border: 1px solid var(--border);
        border-radius: 50%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--muted);
        font-size: 12px;
        cursor: help;
      }
      .homepage-status-pill {
        border: 1px solid var(--border);
        border-radius: 999px;
        padding: 4px 9px;
        color: var(--muted);
        font-size: 11px;
        line-height: 1;
      }
      .homepage-final-uri {
        margin-top: 10px;
        overflow-wrap: anywhere;
        word-break: break-all;
      }
```

In the mobile media block where `.provider-row` becomes one column, add:

```css
        .homepage-source-grid {
          grid-template-columns: 1fr;
        }
        .homepage-metaapp-row {
          align-items: stretch;
          flex-direction: column;
        }
```

- [ ] **Step 6: Add homepage helpers to `app.ts`**

Modify `src/ui/pages/bot/app.ts`.

Add state fields in the initial `state` object:

```js
_pendingHomepage:undefined,_homepageUploadWorking:false,
```

Add these helper functions after `selectedProfile()`:

```js
function normalizeHomepage(value){
  if(!value||typeof value!=='object')return null;
  var uri=String(value.uri||'').trim();
  if(!uri)return null;
  var renderer=String(value.renderer||'').trim()||(/^metaapp:\/\//i.test(uri)?'metaapp':'auto');
  var contentType=String(value.contentType||'').trim()||(renderer==='metaapp'?'application/vnd.metaapp':'application/octet-stream');
  return {uri:uri,renderer:renderer,contentType:contentType};
}
function sameHomepage(left,right){
  left=normalizeHomepage(left);right=normalizeHomepage(right);
  if(!left&&!right)return true;
  if(!left||!right)return false;
  return left.uri===right.uri&&left.renderer===right.renderer&&left.contentType===right.contentType;
}
function homepageDraft(profile){
  if(state._pendingHomepage!==undefined)return state._pendingHomepage;
  return normalizeHomepage(profile&&profile.homepage);
}
function homepageKind(homepage){
  homepage=normalizeHomepage(homepage);
  if(!homepage)return uiText('bot.homepageDefault','Default');
  if(/^metaapp:\/\//i.test(homepage.uri))return uiText('bot.homepageMetaApp','MetaApp');
  return uiText('bot.homepageMetafile','Metafile');
}
function normalizeMetaAppHomepageInput(value){
  var pin=String(value==null?'':value).trim();
  if(/^metaapp:\/\//i.test(pin))pin=pin.slice('metaapp://'.length).trim();
  if(!pin||/\s/u.test(pin))throw new Error(uiText('bot.homepageInvalidMetaAppPin','Enter a MetaApp pin ID without spaces.'));
  return {uri:'metaapp://'+pin,renderer:'metaapp',contentType:'application/vnd.metaapp'};
}
function dataUrlBase64(value){
  var text=String(value||'');
  var marker=';base64,';
  var index=text.indexOf(marker);
  return index>=0?text.slice(index+marker.length):'';
}
function readFileAsDataUrl(file){
  return new Promise(function(resolve,reject){
    var reader=new FileReader();
    reader.onload=function(){resolve(String(reader.result||''))};
    reader.onerror=function(){reject(new Error(uiText('bot.uploadFailed','Upload failed')))};
    reader.readAsDataURL(file);
  });
}
```

Add Homepage panel markup function near `providerPickerMarkup()`:

```js
function homepagePanelMarkup(profile){
  var homepage=homepageDraft(profile);
  var finalUri=homepage&&homepage.uri;
  var status=homepageKind(homepage);
  return '<div class="field field-full"><label>'+esc(uiText('bot.homepage','Homepage'))+'</label>'+
    '<div class="homepage-panel" data-homepage-panel>'+
      '<div class="homepage-panel-head"><div><div class="homepage-panel-title">'+esc(uiText('bot.homepage','Homepage'))+'</div><div class="homepage-panel-subtitle">'+esc(uiText('bot.homepageSource','Custom Bot page source'))+'</div></div><span class="homepage-status-pill">'+esc(status)+'</span></div>'+
      '<div class="homepage-source-grid">'+
        '<div class="homepage-source-card"><div class="homepage-source-title">'+esc(uiText('bot.homepageMetafile','Metafile'))+'</div><div class="homepage-source-note">'+esc(uiText('bot.homepageMetafileNote','Upload a local file and save it as metafile://<pinId>.'))+'</div><div class="homepage-metaapp-row"><button type="button" class="btn btn-sm" data-act="upload-homepage"'+(state._homepageUploadWorking?' disabled':'')+'>'+esc(uiText('bot.upload','Upload'))+'</button><input type="file" data-homepage-file-input hidden /></div></div>'+
        '<div class="homepage-source-card"><div class="homepage-source-title">'+esc(uiText('bot.homepageMetaApp','MetaApp'))+'<span class="homepage-help" title="'+esc(uiText('bot.homepageMetaAppHelp','Copy the pin ID from your MetaApp publish result or MetaApp details page.'))+'">?</span></div><div class="homepage-source-note">'+esc(uiText('bot.homepageMetaAppNote','Paste a MetaApp pin ID and save it as metaapp://<pinId>.'))+'</div><div class="homepage-metaapp-row"><input data-field="homepage-metaapp-pin" placeholder="'+esc(uiText('bot.homepagePinPlaceholder','MetaApp pin ID'))+'" /><button type="button" class="btn btn-sm" data-act="set-homepage-metaapp">'+esc(uiText('bot.homepageSetMetaApp','Set'))+'</button></div></div>'+
      '</div>'+
      '<div class="homepage-final-uri">'+esc(finalUri?uiText('bot.homepageFinalUri','Final URI')+': '+finalUri:uiText('bot.homepageDefaultActive','Default Bot Page renderer is active.'))+'</div>'+
      '<div class="save-status" data-homepage-status></div>'+
    '</div></div>';
}
```

- [ ] **Step 7: Wire Homepage UI events**

Modify `renderPublicIdentityTab()` in `src/ui/pages/bot/app.ts`.

Replace the old Homepage row string:

```js
      '<div class="field field-full"><label>'+esc(uiText('bot.homepage','Homepage'))+'</label><div class="homepage-row"><button type="button" class="btn btn-sm" data-act="upload-homepage">'+esc(uiText('bot.upload','Upload'))+'</button><span class="homepage-renderer-label">'+esc(uiText('bot.defaultRenderer','Default Bot Page renderer'))+'</span></div></div>'+
```

with:

```js
      homepagePanelMarkup(profile)+
```

Replace the old homepage placeholder listener:

```js
  var homepage=q('[data-act="upload-homepage"]');if(homepage)homepage.addEventListener('click',openHomepageUploadPlaceholder);
```

with:

```js
  wireHomepageControls();
```

Add these functions near `handleAvatarUpload()`:

```js
function renderHomepageDraftStatus(message,tone){
  var status=q('[data-homepage-status]');
  if(status){status.textContent=message||'';status.className='save-status '+(tone||'')}
}
function rerenderPublicIdentityForHomepage(){
  renderPublicIdentityTab({preserveDraft:true});
}
function setHomepageMetaAppDraft(){
  var input=q('[data-field="homepage-metaapp-pin"]');
  try{
    state._pendingHomepage=normalizeMetaAppHomepageInput(input&&input.value);
    rerenderPublicIdentityForHomepage();
    renderHomepageDraftStatus(uiText('bot.homepageReadyToSave','Homepage ready to save.'),'success');
  }catch(error){
    renderHomepageDraftStatus(error.message,'error');
  }
}
function handleHomepageUploadFile(file){
  var profile=selectedProfile();if(!profile||!profile.slug||!file)return Promise.resolve();
  state._homepageUploadWorking=true;
  renderHomepageDraftStatus(uiText('bot.homepageUploading','Uploading homepage file...'),'saving');
  return readFileAsDataUrl(file).then(function(dataUrl){
    var base64=dataUrlBase64(dataUrl);
    return api('/api/bot/profiles/'+encodeURIComponent(profile.slug)+'/homepage/upload',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        fileName:file.name||'homepage-upload',
        contentType:file.type||'application/octet-stream',
        base64:base64,
      }),
    });
  }).then(function(r){
    var data=r.data||{};
    if(!data.pinId)throw new Error(uiText('bot.uploadFailed','Upload failed'));
    state._pendingHomepage={
      uri:'metafile://'+data.pinId,
      renderer:'auto',
      contentType:data.contentType||file.type||'application/octet-stream',
    };
    rerenderPublicIdentityForHomepage();
    renderHomepageDraftStatus(uiText('bot.homepageReadyToSave','Homepage ready to save.'),'success');
  }).catch(function(error){
    renderHomepageDraftStatus(error.message||String(error),'error');
  }).finally(function(){
    state._homepageUploadWorking=false;
    var upload=q('[data-act="upload-homepage"]');if(upload)upload.disabled=false;
  });
}
function wireHomepageControls(){
  var input=q('[data-homepage-file-input]');
  var upload=q('[data-act="upload-homepage"]');
  if(upload&&input)upload.addEventListener('click',function(){input.click()});
  if(input)input.addEventListener('change',function(){var file=this.files&&this.files[0];if(file)handleHomepageUploadFile(file)});
  var set=q('[data-act="set-homepage-metaapp"]');if(set)set.addEventListener('click',setHomepageMetaAppDraft);
}
```

Remove `openHomepageUploadPlaceholder()` because no code should call it after these changes.

- [ ] **Step 8: Include homepage in save payload**

Modify `savePublicIdentity()` in `src/ui/pages/bot/app.ts`.

After avatar/provider change detection, add:

```js
  if(state._pendingHomepage!==undefined&&!sameHomepage(state._pendingHomepage,profile.homepage))payload.homepage=state._pendingHomepage;
```

On successful save, reset homepage draft with the avatar draft:

```js
    state._pendingHomepage=undefined;
```

In `selectMetabot(slug)`, clear the homepage draft next to the avatar draft:

```js
  state._pendingAvatar=undefined;
  state._pendingHomepage=undefined;
```

- [ ] **Step 9: Run focused UI tests and confirm pass**

Run:

```bash
npm run build && node --test tests/ui/botPageScript.test.mjs tests/ui/i18n.test.mjs
```

Expected: PASS.

- [ ] **Step 10: Commit Task 4**

Run:

```bash
git add src/ui/pages/bot/app.ts src/ui/pages/bot/index.html src/ui/i18n.ts tests/ui/botPageScript.test.mjs tests/ui/i18n.test.mjs
git commit -m "feat: add bot homepage basic tab ui"
```

---

## Task 5: Final Verification And Browser Check

**Files:**
- No planned source edits unless verification exposes a defect.

- [ ] **Step 1: Run final focused verification**

Run:

```bash
npm run build && node --test \
  tests/bot/metabotProfileManager.test.mjs \
  tests/daemon/defaultBotHandlers.test.mjs \
  tests/daemon/httpServer.test.mjs \
  tests/ui/botPageScript.test.mjs \
  tests/ui/i18n.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Inspect git state**

Run:

```bash
git status --short
git log --oneline -5
```

Expected: no unstaged source edits; recent commits match completed tasks.

- [ ] **Step 3: Browser smoke the Basic tab layout**

Run:

```bash
npm run build
node dist/cli/main.js ui open --page bot
```

Expected: the second command returns a successful JSON result with `data.localUiUrl` ending in `/ui/bot`. Open that `data.localUiUrl` in the in-app browser and inspect the Basic tab.

Expected visible signals:

- Public Identity Basic tab shows a bordered Homepage panel.
- Panel has `Metafile` and `MetaApp` sections.
- The old placeholder modal copy is not visible.
- MetaApp input and `Set` button fit without text overlap at desktop width.

- [ ] **Step 4: Fix any verification defect in the smallest relevant task area**

If Step 1 or Step 3 fails, make only the fix needed for that failure, re-run the failing command, then re-run Step 1. Commit the fix with one of:

```bash
git commit -m "fix: correct bot homepage profile sync"
git commit -m "fix: correct bot homepage upload route"
git commit -m "fix: correct bot homepage basic tab ui"
```

- [ ] **Step 5: Prepare chain development diary for user approval**

Project policy asks for a development diary buzz for each modification commit. Because buzz posting writes on-chain, prepare the JSON payload and ask the user for explicit approval before calling `metabot buzz post`.

Use this payload shape:

```json
{
  "content": "Development diary: implemented Bot Homepage Basic tab support in OAC. Added /info/homepage JSON profile metadata, MVC profile sync, Bot-scoped homepage file upload, and Basic tab UI for Metafile and MetaApp homepage sources. Verified with focused build and Node tests.",
  "attachments": []
}
```

Do not post it until the user approves the exact payload.
