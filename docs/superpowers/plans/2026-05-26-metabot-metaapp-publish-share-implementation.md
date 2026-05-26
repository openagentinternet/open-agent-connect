# MetaBot MetaApp Publish/Share Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a CLI-first MetaApp publish/share/update flow plus a local `/ui/metaapps` gallery so OAC users can package browser-runnable work, write it to MetaWeb, and share a pinId or MetaWeb URL.

**Architecture:** Add a focused `src/core/metaapp/` domain module for project inspection, manifest normalization, archive creation, local cache state, and publish/share orchestration. Wire it through the existing `metabot` CLI, daemon route, default handler, help, and built-in UI patterns so chain writes reuse existing signer, `/file`, `/protocols/metaapp`, `/protocols/simplebuzz`, and `/protocols/paycomment` behavior instead of introducing a new product surface.

**Tech Stack:** TypeScript, Node.js 20-24 built-ins, existing `MetabotCommandResult` envelopes, existing daemon HTTP routing, profile runtime state under `.runtime/state/`, Node test runner (`node --test`), `npm run build`.

---

## File Structure Map

### Create

- `src/core/metaapp/types.ts` - shared MetaApp command, manifest, preview, cache, and result types.
- `src/core/metaapp/pinId.ts` - narrow pinId normalization and validation helpers for CLI selectors.
- `src/core/metaapp/projectInspector.ts` - read project directories and derive browser-runnable publish plans.
- `src/core/metaapp/manifest.ts` - merge auto-detected draft data with user manifest files and validate protocol payload fields.
- `src/core/metaapp/zipArchive.ts` - create a small store-only ZIP archive with Node built-ins for deployable artifact folders.
- `src/core/metaapp/localCache.ts` - profile-scoped `.runtime/state/metaapps/local-cache.json` and `indexer-cache.json` state store.
- `src/core/metaapp/indexerClient.ts` - fetch and normalize official MetaWeb MetaApp indexer records and version history.
- `src/core/metaapp/previewSessions.ts` - in-memory daemon preview session registry plus safe asset resolution.
- `src/core/metaapp/share.ts` - pure builders for MetaWeb URLs, share bundles, simplebuzz requests, and paycomment requests.
- `src/core/metaapp/publish.ts` - orchestration for preview, publish, update, share announcement, and comment workflows.
- `src/cli/commands/metaapp.ts` - CLI parser for `preview`, `publish`, `update`, `share`, `view`, and `comment`.
- `src/daemon/routes/metaapp.ts` - daemon API endpoints used by CLI runtime defaults and the local gallery.
- `src/ui/pages/metaapps/app.ts` - built-in gallery page definition and client script.
- `src/ui/pages/metaapps/index.html` - page template and scoped CSS matching the existing `/ui` design system.
- `tests/metaapp/projectInspector.test.mjs` - pure detection, manifest, pinId, and archive tests.
- `tests/metaapp/localCache.test.mjs` - local cache normalization and merge tests.
- `tests/metaapp/indexerClient.test.mjs` - official indexer response normalization and fallback tests.
- `tests/metaapp/previewSessions.test.mjs` - preview session path safety and asset lookup tests.
- `tests/metaapp/publish.test.mjs` - orchestration tests for publish/update/share/comment.
- `tests/cli/metaapp.test.mjs` - CLI parsing and dependency dispatch tests.
- `tests/daemon/metaappRoutes.test.mjs` - daemon route forwarding tests if the main HTTP server test would become too large.
- `SKILLs/metabot-metaapp-publish/SKILL.md` - thin host-neutral skill that tells coding agents to use the new CLI.

### Modify

- `src/cli/main.ts` - dispatch the `metaapp` command group.
- `src/cli/commandHelp.ts` - add root command entry and help specs for all `metaapp` commands.
- `src/cli/types.ts` - add `metaapp` dependency contract and allow `ui.open` selectors needed by `metaapp view`.
- `src/cli/runtime.ts` - add default `metaapp` dependency methods that call daemon endpoints; extend local UI URL query support.
- `src/daemon/httpServer.ts` - register `handleMetaAppRoutes`.
- `src/daemon/routes/types.ts` - add `metaapp` daemon handlers and extend `MetabotUiPageName` with `metaapps`.
- `src/daemon/routes/ui.ts` - add the `metaapps` page builder and navigation item.
- `src/daemon/defaultHandlers.ts` - implement real daemon handlers with actor resolution, signer reuse, file upload, chain write, buzz, comment, cache update, and gallery list support.
- `src/cli/commands/ui.ts` - accept `metaapps` in `metabot ui open --page`.
- `scripts/build-metabot-skillpacks.mjs` - include the new shared skill in generated packs.
- `tests/cli/help.test.mjs` - cover text and JSON help for the new command family.
- `tests/cli/runtime.test.mjs` - add focused default-runtime tests for `metaapp view` URL/query behavior only if dependency-level CLI tests do not cover it.
- `tests/daemon/httpServer.test.mjs` - cover `/ui/metaapps` and route registration, unless split into `tests/daemon/metaappRoutes.test.mjs`.
- `tests/skillpacks/buildSkillpacks.test.mjs` - include the new skill and CLI command pattern.
- `README.md` - add a short command discovery note, not a full product guide.

### Do Not Change

- `docs/metaid_protocols/02-content-app.md` - keep the existing protocol as the compatibility source; this feature consumes it.
- `src/daemon/routes/uiMetaApps.ts` - keep serving the bundled Buzz/Chat MetaApps; the new gallery is a separate built-in page named `metaapps`.
- `src/core/files/uploadFile.ts`, `src/core/buzz/postBuzz.ts`, and `src/core/chain/writePin.ts` - reuse these contracts instead of reshaping existing write behavior.
- Any legacy `.metabot/hot` layout - all new state lives under `~/.metabot/profiles/<slug>/.runtime/state/metaapps/`.

---

### Task 1: Add CLI Surface And Help Skeleton

**Files:**
- Create: `src/cli/commands/metaapp.ts`
- Modify: `src/cli/main.ts`
- Modify: `src/cli/commandHelp.ts`
- Modify: `src/cli/types.ts`
- Test: `tests/cli/help.test.mjs`
- Test: `tests/cli/metaapp.test.mjs`

- [ ] **Step 1: Write failing help tests**

Add tests for:
- `metabot --help` lists `metaapp`
- `metabot metaapp --help` lists `preview`, `publish`, `update`, `share`, `view`, and `comment`
- each leaf command has text help
- `metabot metaapp publish --help --json` returns `commandPath: ["metaapp", "publish"]`
- every leaf command supports `--help --json`
- publish/update help includes `--from`, `--chain <mvc|btc|opcat>`, and `--confirm`
- share/comment help includes write-chain behavior matching `buzz` and `chain`

Run: `npm run build && node --test tests/cli/help.test.mjs`
Expected: FAIL because `metaapp` help specs do not exist.

- [ ] **Step 2: Write failing CLI dispatch tests**

In `tests/cli/metaapp.test.mjs`, use injected dependencies and assert:

```js
const exitCode = await runCli([
  'metaapp',
  'publish',
  '--project-dir',
  projectDir,
  '--from',
  'alice',
  '--chain',
  'opcat',
  '--confirm',
], {
  dependencies: {
    metaapp: {
      publish: async (input) => {
        calls.push(input);
        return commandSuccess({ pinId: 'metaapp-pin-1i0' });
      },
    },
  },
});
assert.equal(exitCode, 0);
assert.deepEqual(calls[0], {
  projectDir,
  from: 'alice',
  network: 'opcat',
  confirm: true,
});
```

Also cover:
- missing `--project-dir` for `preview`, `publish`, and `update`
- missing `--target-pin-id` for `update`
- `share --pin-id` without `--announce` ignores `--chain`
- `share --announce --chain doge` propagates `network: "doge"`
- `view --pin-id` and `--first-pin-id` together fails with `invalid_flag`
- `view --mine --pin-id` fails with `invalid_flag`
- `view --mine --first-pin-id` fails with `invalid_flag`
- `comment --pin-id --comment --from --chain btc` propagates expected input

Run: `npm run build && node --test tests/cli/metaapp.test.mjs`
Expected: FAIL because the CLI command does not exist.

- [ ] **Step 3: Add dependency contract**

Extend `src/cli/types.ts`:

```ts
metaapp?: {
  preview?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
  publish?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
  update?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
  share?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
  view?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
  comment?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
};
```

Do not add real runtime behavior yet.

- [ ] **Step 4: Implement `src/cli/commands/metaapp.ts` parser**

Follow existing command files:
- use `commandMissingFlag`, `commandUnknownSubcommand`, `readFlagValue`, `readFromFlag`, `readChainWriteFlag`, `readFileUploadChainFlag`, and `hasFlag`
- map file-upload-backed publish/update `--chain` through `readFileUploadChainFlag`
- map share/comment write `--chain` through `readChainWriteFlag`
- do not require `--from`; pass it when present
- return `not_implemented` if the dependency method is missing

The command input names should be:
- `projectDir`
- `manifestFile`
- `targetPinId`
- `pinId`
- `firstPinId`
- `from`
- `network`
- `confirm`
- `announce`
- `open`
- `mine`
- `comment`

- [ ] **Step 5: Wire command dispatch and help specs**

Modify `src/cli/main.ts`:

```ts
import { runMetaAppCommand } from './commands/metaapp';
```

Add the `case 'metaapp'` branch beside the other command groups.

Modify `src/cli/commandHelp.ts`:
- add `{ name: 'metaapp', summary: 'Preview, publish, update, share, view, and comment on MetaApps.' }`
- add one group spec and six leaf specs
- include `HELP_JSON_FLAG` in each relevant optional flag list
- keep examples explicit about `--from`, for example:

```bash
metabot metaapp publish --project-dir ./dist-site --from alice --chain mvc --confirm
metabot metaapp update --target-pin-id <pinid> --project-dir ./dist-site --from alice --confirm
metabot metaapp share --pin-id <pinid>
metabot metaapp share --pin-id <pinid> --announce --from alice
metabot metaapp view --mine --from alice
metabot metaapp comment --pin-id <pinid> --comment "Great demo" --from alice
```

- [ ] **Step 6: Re-run focused tests**

Run: `npm run build && node --test tests/cli/help.test.mjs tests/cli/metaapp.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/cli/main.ts src/cli/commandHelp.ts src/cli/types.ts src/cli/commands/metaapp.ts tests/cli/help.test.mjs tests/cli/metaapp.test.mjs
git commit -m "feat: add metaapp CLI surface"
```

---

### Task 2: Add Project Inspection, Manifest, PinId, And Archive Core

**Files:**
- Create: `src/core/metaapp/types.ts`
- Create: `src/core/metaapp/pinId.ts`
- Create: `src/core/metaapp/projectInspector.ts`
- Create: `src/core/metaapp/manifest.ts`
- Create: `src/core/metaapp/zipArchive.ts`
- Test: `tests/metaapp/projectInspector.test.mjs`

- [ ] **Step 1: Write failing core tests**

Cover:
- static directory with `index.html` becomes `projectType: "static"` and `artifactDir` equals the project root
- package project with `package.json` and existing `dist/index.html` becomes `projectType: "npm"` and `artifactDir` equals `dist`
- package project with `scripts.build` but no known output dir returns `manualAction.code === "metaapp_build_output_missing"`
- `.metaapp.json` or `--manifest-file` overrides title, appName, intro, version, tags, icon, coverImg, and indexFile
- unsupported project returns `manualAction.code === "metaapp_project_unrecognized"`
- pinId helper accepts `64-hex + i0` and rejects blank or path-like values
- ZIP archive includes nested files with relative names and no absolute paths

Run: `npm run build && node --test tests/metaapp/projectInspector.test.mjs`
Expected: FAIL because modules do not exist.

- [ ] **Step 2: Define shared types**

In `src/core/metaapp/types.ts`, define the stable contracts:

```ts
export type MetaAppProjectType = 'static' | 'npm' | 'manual';

export interface MetaAppManifestInput {
  title?: string;
  appName?: string;
  prompt?: string;
  icon?: string;
  coverImg?: string;
  introImgs?: string[];
  intro?: string;
  runtime?: string;
  version?: string;
  contentType?: string;
  content?: string;
  indexFile?: string;
  code?: string;
  contentHash?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
  disabled?: boolean;
  codeType?: string;
  artifactDir?: string;
  sourceArchive?: boolean;
}

export interface MetaAppPreviewPlan {
  projectDir: string;
  projectType: MetaAppProjectType;
  artifactDir: string | null;
  indexFile: string;
  buildCommand: string | null;
  packageManager: string | null;
  manifest: MetaAppManifestInput;
  manualAction?: {
    code: string;
    message: string;
  };
}
```

Keep types minimal and extend only when tests require a field.

- [ ] **Step 3: Implement project inspection**

`inspectMetaAppProject(input)` should:
- resolve project and manifest paths against the CLI cwd passed by the caller
- detect `package.json`
- detect package manager from lockfile names: `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`, `bun.lockb`, `bun.lock`
- read `scripts.build` as a build command but not execute it in this task
- choose the first existing output directory with an `index.html`: `dist`, `build`, `out`, `public`
- fall back to project root when it contains `index.html`
- return manual action instead of throwing for unsupported project shapes

- [ ] **Step 4: Implement manifest normalization**

`buildMetaAppManifestDraft(plan)` should:
- default `runtime` to `browser`
- default `version` to `1.0.0`
- default `contentType` to `application/zip`
- default `codeType` to `application/zip`
- default `indexFile` to detected entry
- leave `code` and `content` empty until publish fills the uploaded artifact URI
- put OAC context under `metadata.oac`, including project type, projectDir, artifactDir, buildCommand, and packageManager

Manifest override should:
- accept only JSON object files
- validate string/string-array/boolean/object fields
- keep unknown fields under `metadata.user` only if the manifest explicitly provides them there

- [ ] **Step 5: Implement store-only ZIP archive helper**

Use Node built-ins only. Create:

```ts
export async function writeMetaAppZipArchive(input: {
  sourceDir: string;
  outFile: string;
  exclude?: string[];
}): Promise<{ filePath: string; bytes: number; sha256: string; entries: string[] }>;
```

Requirements:
- recurse files in stable lexical order
- skip `.git`, `node_modules`, `.DS_Store`, and existing `.runtime` folders
- reject absolute entry names and `..` entries
- write a valid ZIP local header plus central directory using store mode
- compute CRC32 inside the helper; do not add a runtime dependency for this task

- [ ] **Step 6: Re-run focused tests**

Run: `npm run build && node --test tests/metaapp/projectInspector.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/metaapp/types.ts src/core/metaapp/pinId.ts src/core/metaapp/projectInspector.ts src/core/metaapp/manifest.ts src/core/metaapp/zipArchive.ts tests/metaapp/projectInspector.test.mjs
git commit -m "feat: add metaapp project preview core"
```

---

### Task 3: Add Local MetaApp Cache And Indexer Client

**Files:**
- Create: `src/core/metaapp/localCache.ts`
- Create: `src/core/metaapp/indexerClient.ts`
- Modify: `src/core/metaapp/types.ts`
- Test: `tests/metaapp/localCache.test.mjs`
- Test: `tests/metaapp/indexerClient.test.mjs`

- [ ] **Step 1: Write failing cache tests**

Cover:
- store path resolves to `.runtime/state/metaapps/local-cache.json`
- indexer cache path resolves to `.runtime/state/metaapps/indexer-cache.json`
- missing files read as empty versioned states
- malformed records are dropped without crashing
- local records are upserted by `pinId`
- `modify` update records keep `firstPinId` from the target when supplied
- merge returns indexer records first, then local optimistic records not yet indexed
- no merged third file is written

Run: `npm run build && node --test tests/metaapp/localCache.test.mjs`
Expected: FAIL because the store does not exist.

- [ ] **Step 2: Write failing indexer client tests**

Cover:
- list fetch reads from `${baseUrl}/api/v1/metaapps`
- pin fetch reads from `${baseUrl}/api/v1/metaapps/<pinId>`
- history fetch reads from `${baseUrl}/api/v1/metaapps/first/<firstPinId>/history`
- creator fetch reads from `${baseUrl}/api/v1/metaapps/creator/<globalMetaId>`
- normalizer maps official records into `MetaAppGalleryRecord`
- malformed or failed indexer responses return a typed failure result instead of throwing through the UI list path
- `METABOT_METAAPP_INDEXER_BASE_URL` can override the default `https://metaweb.world`

Run: `npm run build && node --test tests/metaapp/indexerClient.test.mjs`
Expected: FAIL because the client does not exist.

- [ ] **Step 3: Add cache and indexer types**

Add to `src/core/metaapp/types.ts`:

```ts
export interface MetaAppGalleryRecord {
  pinId: string;
  firstPinId: string;
  operation: 'create' | 'modify';
  title: string;
  appName: string;
  version: string;
  runtime: string;
  indexFile: string;
  code: string;
  content: string;
  contentType: string;
  codeType: string;
  tags: string[];
  ownerGlobalMetaId: string;
  ownerAddress: string;
  network: string;
  metawebUrl: string;
  localUiUrl?: string;
  updatedAt: number;
  source: 'local' | 'indexer';
  raw?: Record<string, unknown>;
}
```

Also add:

```ts
export interface MetaAppIndexerClient {
  list(input?: { creatorGlobalMetaId?: string; limit?: number }): Promise<MetaAppGalleryRecord[]>;
  getByPinId(pinId: string): Promise<MetaAppGalleryRecord | null>;
  getHistory(firstPinId: string): Promise<MetaAppGalleryRecord[]>;
}
```

- [ ] **Step 4: Implement cache store**

`createMetaAppLocalCacheStore(pathsOrHomeDir)` should expose:

```ts
{
  localCachePath: string;
  indexerCachePath: string;
  readLocal(): Promise<MetaAppCacheState>;
  writeLocal(state: MetaAppCacheState): Promise<MetaAppCacheState>;
  upsertLocal(record: MetaAppGalleryRecord): Promise<MetaAppCacheState>;
  readIndexer(): Promise<MetaAppCacheState>;
  writeIndexer(state: MetaAppCacheState): Promise<MetaAppCacheState>;
  listMerged(): Promise<MetaAppGalleryRecord[]>;
}
```

Use `resolveMetabotPaths` and `paths.stateRoot`; write JSON with trailing newline; create directories recursively.

- [ ] **Step 5: Verify current official indexer routes**

Before implementing the client, verify current route paths in the local MetaWeb service repository, especially:

```bash
rg -n "api/v1/metaapps|/creator/|/first/.*/history|download" /Users/tusm/Documents/MetaID_Projects/metaweb/meta-app-service
```

Expected: confirm the current list, pin detail, creator list, version history, and download route shapes. If route names differ from this plan, update this task and the tests before writing the client.

- [ ] **Step 6: Implement official indexer client**

`createMetaAppIndexerClient(input)` should:
- default `baseUrl` to `https://metaweb.world`
- strip trailing slashes before appending `/api/v1/...`
- accept injected `fetch` and `now` for tests
- normalize common MetaWeb fields: pinId, firstPinId, title, appName, version, runtime, indexFile, code, content, contentType, codeType, tags, owner/globalMetaId, network, updatedAt, disabled/status, run/download URLs when present
- keep unknown official fields under `raw`
- fail closed with a typed error object that daemon handlers can convert into `indexerRefreshError`

Do not let official indexer failures prevent local optimistic records from rendering.

- [ ] **Step 7: Re-run focused tests**

Run: `npm run build && node --test tests/metaapp/localCache.test.mjs tests/metaapp/indexerClient.test.mjs`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/core/metaapp/types.ts src/core/metaapp/localCache.ts src/core/metaapp/indexerClient.ts tests/metaapp/localCache.test.mjs tests/metaapp/indexerClient.test.mjs
git commit -m "feat: add metaapp cache and indexer client"
```

---

### Task 4: Add Publish, Update, Share, And Comment Orchestration

**Files:**
- Create: `src/core/metaapp/previewSessions.ts`
- Create: `src/core/metaapp/share.ts`
- Create: `src/core/metaapp/publish.ts`
- Modify: `src/core/metaapp/types.ts`
- Test: `tests/metaapp/previewSessions.test.mjs`
- Test: `tests/metaapp/publish.test.mjs`

- [ ] **Step 1: Write failing preview session tests**

Cover:
- `createMetaAppPreviewSession` returns a stable opaque `previewId`
- preview session asset resolution serves files only from the selected artifact directory
- path traversal attempts such as `../secret.txt` fail with `invalid_preview_asset_path`
- blank asset paths resolve to the detected `indexFile`
- MIME type inference covers html, css, js, json, svg, png, jpg, webp, and a binary fallback

Run: `npm run build && node --test tests/metaapp/previewSessions.test.mjs`
Expected: FAIL because preview session support does not exist.

- [ ] **Step 2: Write failing orchestration tests**

Use fake dependencies for upload/write/post:
- `previewMetaAppProject` returns a preview plus `localPreviewUrl` without uploading
- `previewMetaAppProject` uses the preview session dependency to expose the detected artifact directory through the daemon
- `previewMetaAppProject` with `open: true` sets `localUiUrl` to the same preview URL for host consumers
- `publishMetaApp` without `confirm` returns `commandAwaitingConfirmation` and no upload/write calls
- `publishMetaApp` with `confirm` uploads the ZIP first, then writes `/protocols/metaapp` with `operation: "create"`
- create payload puts uploaded deployable artifact URI in `code`
- create payload keeps `content` empty unless compatibility mirror is requested
- `updateMetaApp` writes `operation: "modify"` and `path: "@<targetPinId>"`
- `updateMetaApp` uses a previous MetaApp reader when available and inherits prior title, appName, intro, icon, coverImg, tags, runtime, and indexFile before applying local manifest overrides
- `updateMetaApp` continues with a warning when previous-version lookup fails, because the spec says inherit when possible
- publish/update call local cache upsert after successful write
- file upload failure returns `metaapp_upload_failed` and skips chain write
- chain write failure returns `metaapp_publish_failed` and preserves upload evidence in `data`
- `shareMetaApp` returns pinId and `https://metaweb.world/metaapp/<pinId>` without writing
- `announceMetaAppShare` builds simplebuzz with `quotePin`
- `commentMetaApp` writes `/protocols/paycomment` with `{ content, contentType, commentTo }`

Run: `npm run build && node --test tests/metaapp/publish.test.mjs`
Expected: FAIL because orchestration modules do not exist.

- [ ] **Step 3: Implement preview session helpers**

`src/core/metaapp/previewSessions.ts` should export a small registry factory for daemon handlers:

```ts
export function createMetaAppPreviewSessionRegistry(input?: {
  now?: () => number;
  ttlMs?: number;
}): {
  create(input: { artifactDir: string; indexFile: string }): MetaAppPreviewSession;
  resolveAsset(input: { previewId: string; assetPath?: string }): Promise<MetaAppPreviewAsset>;
  pruneExpired(): void;
};
```

Keep this registry in daemon memory. It is local preview state, not persistent profile state.

- [ ] **Step 4: Implement pure share/comment builders**

`src/core/metaapp/share.ts` should export:

```ts
export function buildMetaAppShareBundle(pinId: string): {
  pinId: string;
  metawebUrl: string;
  suggestedBuzz: string;
};

export function buildMetaAppBuzzRequest(input: {
  pinId: string;
  message?: string;
}): {
  content: string;
  contentType: 'text/plain;utf-8';
  quotePin: string;
};

export function buildMetaAppCommentWrite(input: {
  pinId: string;
  comment: string;
}): {
  operation: 'create';
  path: '/protocols/paycomment';
  contentType: 'application/json';
  payload: string;
};
```

Keep URL construction in one helper so CLI, UI, and cache use the same canonical URL.

- [ ] **Step 5: Implement preview and publish/update orchestration**

`src/core/metaapp/publish.ts` should accept injected dependencies:

```ts
export interface MetaAppPublishDependencies {
  uploadFile(input: { filePath: string; contentType?: string; network?: string }): Promise<UploadLikeResult>;
  writeChain(input: Record<string, unknown>): Promise<ChainLikeResult>;
  upsertLocal(record: MetaAppGalleryRecord): Promise<unknown>;
  createPreviewSession?(input: { artifactDir: string; indexFile: string }): { previewId: string; localPreviewUrl: string };
  readExistingMetaApp?(pinId: string): Promise<MetaAppGalleryRecord | null>;
  now?: () => number;
  makeTempDir?: () => Promise<string>;
}
```

The preview flow:
1. inspect project and merge manifest
2. if manual action exists, return `commandManualActionRequired` with the draft
3. create a local preview session when `artifactDir` is available
4. return `localPreviewUrl`, `previewId`, the detected plan, and the draft manifest
5. when `open` is true, also set top-level `localUiUrl` to `localPreviewUrl`

The publish flow:
1. inspect project and merge manifest
2. if manual action exists, return `commandManualActionRequired`
3. if `confirm` is false, return `commandAwaitingConfirmation(preview)`
4. write deployable ZIP from `artifactDir`
5. upload ZIP as `application/zip`
6. fill `manifest.code = uploaded.metafileUri`
7. fill `manifest.contentHash = archive.sha256`
8. write JSON payload to `/protocols/metaapp`
9. upsert local cache record
10. return pinId, firstPinId, metawebUrl, localUiUrl, archive, upload, and chain write summary

For update, use the same flow with:
- `operation: "modify"`
- `path: "@<targetPinId>"`
- `firstPinId` equal to the target unless the chain/indexer returns a better value later
- best-effort previous-version inheritance through `readExistingMetaApp(targetPinId)` before applying local manifest overrides

- [ ] **Step 6: Implement comment and announcement orchestration**

Use injected chain and buzz dependencies; do not duplicate `postBuzzToChain` internals in core tests.

Failure behavior:
- share without announcement always succeeds after pin validation
- share with announcement returns share bundle plus `announcement` on success
- share with failed announcement returns failed result with `data.share` populated
- comment returns `commentPinId`, `commentTo`, `network`, and `txids`

- [ ] **Step 7: Re-run focused tests**

Run: `npm run build && node --test tests/metaapp/previewSessions.test.mjs tests/metaapp/publish.test.mjs`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/core/metaapp/types.ts src/core/metaapp/previewSessions.ts src/core/metaapp/share.ts src/core/metaapp/publish.ts tests/metaapp/previewSessions.test.mjs tests/metaapp/publish.test.mjs
git commit -m "feat: add metaapp publish orchestration"
```

---

### Task 5: Wire Daemon And Default Runtime Behavior

**Files:**
- Create: `src/daemon/routes/metaapp.ts`
- Modify: `src/daemon/httpServer.ts`
- Modify: `src/daemon/routes/types.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `src/cli/runtime.ts`
- Modify: `src/cli/types.ts`
- Test: `tests/daemon/metaappRoutes.test.mjs`
- Test: `tests/cli/runtime.test.mjs`

- [ ] **Step 1: Write failing daemon route tests**

Cover:
- `POST /api/metaapp/preview` forwards body to `handlers.metaapp.preview`
- `GET /api/metaapp/preview-assets/<previewId>/index.html` forwards to `handlers.metaapp.previewAsset`
- `POST /api/metaapp/publish` forwards body to `handlers.metaapp.publish`
- `POST /api/metaapp/update` forwards body to `handlers.metaapp.update`
- `POST /api/metaapp/share` forwards body to `handlers.metaapp.share`
- `POST /api/metaapp/comment` forwards body to `handlers.metaapp.comment`
- `GET /api/metaapps?from=alice&mine=true` forwards query to `handlers.metaapp.list`
- `GET /api/metaapps?refresh=true` lets the handler refresh from the official indexer
- non-GET/non-POST methods return method-not-allowed

Run: `npm run build && node --test tests/daemon/metaappRoutes.test.mjs`
Expected: FAIL because the route does not exist.

- [ ] **Step 2: Add daemon route and handler types**

Extend `MetabotDaemonHttpHandlers` with:

```ts
metaapp?: {
  preview?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
  publish?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
  update?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
  share?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
  comment?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
  list?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
  previewAsset?: (input: { previewId: string; assetPath?: string }) => Awaitable<{ body: Buffer | string; contentType: string } | MetabotCommandResult<unknown>>;
};
```

Register `handleMetaAppRoutes` before `handleUiRoutes` in `src/daemon/httpServer.ts`.

- [ ] **Step 3: Add default CLI runtime calls**

In `src/cli/runtime.ts`, add `metaapp` defaults:
- `preview` -> `POST /api/metaapp/preview`
- `publish` -> `POST /api/metaapp/publish`
- `update` -> `POST /api/metaapp/update`
- `share` -> `POST /api/metaapp/share`
- `comment` -> `POST /api/metaapp/comment`
- `view` -> `ui.open({ page: 'metaapps', ...selectors })`

Extend `mergeCliDependencies` to merge `metaapp`.

Extend the `ui.open` default query builder to pass `pinId`, `firstPinId`, and `mine` when present.

- [ ] **Step 4: Implement real daemon handlers**

In `src/daemon/defaultHandlers.ts`:
- reuse `resolveActorWriteContext(rawInput.from)` for write-capable commands
- check `runtimeStateStore.readState().identity` before writes with messages consistent with file/buzz handlers
- keep one `createMetaAppPreviewSessionRegistry()` instance inside `createDefaultMetabotDaemonHandlers`
- make preview create a session and return `localPreviewUrl` under `/api/metaapp/preview-assets/<previewId>/<indexFile>`
- use `resolveFileUploadNetworkForHome` for publish/update
- use `resolveWriteNetworkForHome` for share announcement and comment
- use `uploadLocalFileToChain` for deployable ZIP upload
- use `actor.signer.writePin` for `/protocols/metaapp` and `/protocols/paycomment`
- use `postBuzzToChain` for share announcements
- use `createMetaAppLocalCacheStore(actor.homeDir)` for local optimistic cache writes and list
- use `createMetaAppIndexerClient` for list refreshes and previous-version lookup
- when list receives `refresh=true`, fetch official indexer records, write `indexer-cache.json`, and then return merged rows
- when indexer refresh fails, return merged local/cache rows with `indexerRefreshError` in `data`, not a hard UI failure
- when update receives `targetPinId`, fetch previous metadata from indexer first, then cache, then continue without inheritance if both fail
- build local gallery URL with `buildDaemonLocalUiUrl(input.getDaemonRecord(), '/ui/metaapps', { pinId }) ?? '/ui/metaapps'`

Return existing-style failure codes:
- `metaapp_preview_failed`
- `metaapp_upload_failed`
- `metaapp_publish_failed`
- `metaapp_update_failed`
- `metaapp_share_failed`
- `metaapp_comment_failed`

- [ ] **Step 5: Add focused runtime tests**

In `tests/cli/runtime.test.mjs`, add only low-cost default dependency checks:
- `metabot metaapp view --pin-id pin-1i0` returns `localUiUrl` containing `/ui/metaapps?pinId=pin-1i0`
- `metabot metaapp view --mine --from alice` returns `localUiUrl` containing `/ui/metaapps?from=alice&mine=true`

Use existing runtime helpers and fake daemon mode where possible.

- [ ] **Step 6: Re-run focused tests**

Run: `npm run build && node --test tests/daemon/metaappRoutes.test.mjs tests/cli/runtime.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/daemon/routes/metaapp.ts src/daemon/httpServer.ts src/daemon/routes/types.ts src/daemon/defaultHandlers.ts src/cli/runtime.ts src/cli/types.ts tests/daemon/metaappRoutes.test.mjs tests/cli/runtime.test.mjs
git commit -m "feat: wire metaapp daemon runtime"
```

---

### Task 6: Add Local MetaApp Gallery UI

**Files:**
- Create: `src/ui/pages/metaapps/app.ts`
- Create: `src/ui/pages/metaapps/index.html`
- Modify: `src/daemon/routes/types.ts`
- Modify: `src/daemon/routes/ui.ts`
- Modify: `src/cli/commands/ui.ts`
- Test: `tests/daemon/httpServer.test.mjs`
- Test: `tests/cli/metaapp.test.mjs`

- [ ] **Step 1: Write failing UI route tests**

Add tests for:
- `GET /ui/metaapps` renders the built-in gallery
- HTML includes `/ui/shared.css`
- HTML includes `data-metaapps-shell`, `data-metaapps-list`, and `data-metaapps-refresh`
- HTML fetches `/api/metaapps`
- refresh button fetches `/api/metaapps?refresh=true`
- navigation includes `href="/ui/metaapps"`
- page does not include `/api/wallet` or direct chain write endpoints

Run: `npm run build && node --test tests/daemon/httpServer.test.mjs`
Expected: FAIL because `metaapps` is not a built-in page.

- [ ] **Step 2: Add `metaapps` page name and route registration**

Modify:
- `MetabotUiPageName` union to include `'metaapps'`
- `PAGE_BUILDERS` to map `metaapps` to `buildMetaAppsPageDefinition`
- `NAV_ITEMS` to include `{ page: 'metaapps', label: 'MetaApps' }`
- `SUPPORTED_UI_PAGES` in `src/cli/commands/ui.ts` to include `metaapps`

- [ ] **Step 3: Build page definition**

`buildMetaAppsPageDefinition()` should return:
- `page: 'metaapps'`
- concise title/description
- `contentHtml` with toolbar, filters, list, and detail panel
- script that fetches `/api/metaapps` with current query params
- script that fetches `/api/metaapps?refresh=true` when the refresh control is pressed, so the official MetaWeb indexer remains the primary source when reachable
- visible non-blocking refresh error state when cached/local rows are shown after an indexer failure
- actions for open, run, download, copy pinId, share, and comment
- version history and latest-version labels when the list response includes official indexer history fields

Keep the UI dense and operational:
- no hero marketing layout
- no nested cards
- no one-hue palette
- use existing `var(--surface)`, `var(--border)`, `var(--accent)`, `var(--mono)`, and shared layout classes

- [ ] **Step 4: Build page template**

`src/ui/pages/metaapps/index.html` should follow the Loom/Bot page pattern:
- use `<!doctype html>`
- set `<html lang="en">`
- link `/ui/shared.css`
- use placeholders `__PAGE_TITLE__`, `__PAGE_NAV__`, `__PAGE_CONTENT__`, and `__PAGE_SCRIPT__`
- keep all page-specific CSS scoped with `.metaapps-*`

- [ ] **Step 5: Add CLI view integration test**

In `tests/cli/metaapp.test.mjs`, assert:
- `metabot metaapp view --pin-id abc...i0` dispatches to `metaapp.view`
- default runtime test from Task 5 proves it maps to `/ui/metaapps`
- `metabot ui open --page metaapps` succeeds with injected `ui.open`

- [ ] **Step 6: Re-run focused tests**

Run: `npm run build && node --test tests/daemon/httpServer.test.mjs tests/cli/metaapp.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ui/pages/metaapps/app.ts src/ui/pages/metaapps/index.html src/daemon/routes/types.ts src/daemon/routes/ui.ts src/cli/commands/ui.ts tests/daemon/httpServer.test.mjs tests/cli/metaapp.test.mjs
git commit -m "feat: add local metaapps gallery"
```

---

### Task 7: Add Shared Skill Wrapper And Skillpack Coverage

**Files:**
- Create: `SKILLs/metabot-metaapp-publish/SKILL.md`
- Modify: `scripts/build-metabot-skillpacks.mjs`
- Modify: `tests/skillpacks/buildSkillpacks.test.mjs`
- Modify: generated skillpack files under `skillpacks/` after running the build script

- [ ] **Step 1: Write failing skillpack tests**

Update `EXPECTED_METABOT_SKILLS` with `metabot-metaapp-publish`.

Add assertions that generated shared skill content includes:
- `metaapp preview`
- `metaapp publish --from <bot-slug>`
- `metaapp update --target-pin-id`
- `metaapp share --pin-id`
- `metaapp view`
- `metaapp comment`
- warning that publish/update require explicit confirmation through `--confirm`

Run: `npm run build && node --test tests/skillpacks/buildSkillpacks.test.mjs`
Expected: FAIL because the skill is missing.

- [ ] **Step 2: Author host-neutral skill**

Create `SKILLs/metabot-metaapp-publish/SKILL.md` with English frontmatter:

```yaml
---
name: metabot-metaapp-publish
description: Use when an agent needs to preview, publish, update, share, view, or comment on a browser-runnable MetaApp through Open Agent Connect; prefer the metabot metaapp CLI and reuse existing MetaApp/simplebuzz/paycomment protocols.
---
```

The body should:
- treat Bot, bot, and MetaBot wording as equivalent
- route browser apps/games/sites to `metabot metaapp preview`
- use `metabot metaapp publish --from <bot-slug> --project-dir <path> --confirm`
- use `metabot metaapp update --target-pin-id <pinid> --from <bot-slug> --project-dir <path> --confirm`
- use `metabot metaapp share --pin-id <pinid>` for read-only sharing
- use `metabot metaapp share --pin-id <pinid> --announce --from <bot-slug>` for simplebuzz announcement
- use `metabot metaapp view` to open the local gallery
- use `metabot metaapp comment --pin-id <pinid> --comment <text> --from <bot-slug>` for comments
- avoid inventing deployment URLs; surface returned `pinId`, `metawebUrl`, and `localUiUrl`

- [ ] **Step 3: Add skill to builder and command pattern**

Modify `METABOT_SKILLS` in `scripts/build-metabot-skillpacks.mjs`.

Modify `BARE_METABOT_COMMAND_PATTERN` in `tests/skillpacks/buildSkillpacks.test.mjs` so `metaapp` is recognized as a valid CLI group.

- [ ] **Step 4: Build skillpacks**

Run: `npm run build:skillpacks`
Expected: PASS and regenerated shared/host skillpack files include the new skill.

- [ ] **Step 5: Re-run focused tests**

Run: `npm run build && node --test tests/skillpacks/buildSkillpacks.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add SKILLs/metabot-metaapp-publish/SKILL.md scripts/build-metabot-skillpacks.mjs tests/skillpacks/buildSkillpacks.test.mjs skillpacks
git commit -m "feat: add metaapp publish skill"
```

---

### Task 8: Final Integration Verification And README Note

**Files:**
- Modify: `README.md`
- Optional modify: any tests touched by preceding integration fixes

- [ ] **Step 1: Add a short README discovery note**

Add a compact section near existing CLI capability descriptions:

```markdown
### MetaApp publishing

Use `metabot metaapp preview`, `publish`, `update`, `share`, `view`, and `comment` to package browser-runnable sites, apps, and games as MetaApps, write them to MetaWeb, and open the local `/ui/metaapps` gallery.
```

Keep it short; detailed protocol behavior already lives in the spec and CLI help.

- [ ] **Step 2: Run focused CLI, core, daemon, and skillpack tests**

Run:

```bash
npm run build
node --test tests/metaapp/projectInspector.test.mjs tests/metaapp/localCache.test.mjs tests/metaapp/publish.test.mjs
node --test tests/metaapp/indexerClient.test.mjs tests/metaapp/previewSessions.test.mjs
node --test tests/cli/help.test.mjs tests/cli/metaapp.test.mjs
node --test tests/daemon/metaappRoutes.test.mjs tests/daemon/httpServer.test.mjs
node --test tests/skillpacks/buildSkillpacks.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Run a local fake-chain smoke**

Create a temporary static site and run:

```bash
METABOT_TEST_FAKE_CHAIN_WRITE=1 metabot metaapp preview --project-dir /tmp/oac-metaapp-smoke
METABOT_TEST_FAKE_CHAIN_WRITE=1 metabot metaapp publish --project-dir /tmp/oac-metaapp-smoke --confirm
METABOT_TEST_FAKE_CHAIN_WRITE=1 metabot metaapp share --pin-id /protocols/metaapp-pin-1
METABOT_TEST_FAKE_CHAIN_WRITE=1 metabot metaapp view --pin-id /protocols/metaapp-pin-1
```

Expected:
- preview returns `ok: true` or `awaiting_confirmation` style preview data
- publish returns a fake pinId and localUiUrl
- share returns metawebUrl without posting unless `--announce` is present
- view returns `/ui/metaapps?...`

If the fake pin shape from `createTestChainWriteSigner` is not accepted by the stricter pin validator, use a valid test pin and keep this smoke read-only for share/view.

- [ ] **Step 4: Commit README or final integration fixes**

```bash
git add README.md
git commit -m "docs: mention metaapp publishing commands"
```

If no README or integration changes were necessary, do not create an empty commit.

---

## Acceptance Checklist

- [ ] `metabot metaapp --help` and all leaf command help paths work in text and JSON modes.
- [ ] `metabot metaapp preview --project-dir <path>` returns a local preview URL and never writes chain data.
- [ ] `publish` and `update` return preview/confirmation state without `--confirm`.
- [ ] `publish --confirm` writes `/protocols/metaapp` with `operation=create`.
- [ ] `update --confirm` writes `/protocols/metaapp` with `operation=modify` and `path=@<targetPinId>`.
- [ ] `update` inherits previous version metadata when the official indexer or cache can resolve it.
- [ ] deployable runtime artifact URI is in `code`, not a non-deployable source archive.
- [ ] share without `--announce` is read-only and ignores `--chain`.
- [ ] share with `--announce` uses simplebuzz and quotes the MetaApp pin.
- [ ] comment uses `/protocols/paycomment` and `commentTo`.
- [ ] local state lives under `.runtime/state/metaapps/`.
- [ ] `/ui/metaapps` renders with the existing UI system, appears in navigation, and can refresh from the official MetaWeb indexer.
- [ ] `metabot ui open --page metaapps` works.
- [ ] shared skillpacks include `metabot-metaapp-publish`.
- [ ] Focused tests and `npm run build` pass before the final branch handoff.
