# Daemon Profile Routing and Startup Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make daemon-backed CLI behavior deterministic across profiles so `--from <bot>` commands target the selected profile daemon, active-home drift no longer causes wrong-profile startup timeouts, and daemon startup failures return actionable diagnostics instead of a bare timeout string.

**Architecture:** Keep the existing per-profile daemon model. Refactor CLI daemon resolution so each daemon-backed request can carry an explicit target home derived from `--from`, while commands without `--from` keep the current active-home behavior. Add startup diagnostics around the selected profile home, preferred port, `daemon.json`, and `daemon.lock` state instead of introducing a global daemon registry or an OS-level supervisor.

**Tech Stack:** TypeScript strict CommonJS, Node.js `node:test`, existing CLI runtime helpers in `src/cli/runtime.ts`, runtime state in `.runtime/daemon.json`, and daemon lock handling in `src/daemon/index.ts`.

---

## Scope and non-goals

- Keep the current per-profile daemon topology. One profile does not borrow another profile's daemon.
- Fix CLI routing for daemon-backed commands that already accept `--from`.
- Improve startup error reporting and preflight visibility for daemon bootstrap.
- Do **not** add launchd/systemd auto-start in this round.
- Do **not** change daemon HTTP routes or Browser host ownership in this round.

## File map

- Modify: `src/cli/runtime.ts`
  - Add target-profile daemon resolution helpers.
  - Route daemon-backed `--from` commands through the selected profile home instead of the current active home.
  - Use the same target-home logic for local UI URL builders.
  - Replace the opaque timeout error with richer startup diagnostics.
- Create: `src/cli/daemonStartupDiagnostics.ts`
  - Read `daemon.json` / `daemon.lock` state for a target profile home.
  - Format a deterministic timeout message with the selected home, port, and lock/record context.
- Modify: `tests/cli/runtime.test.mjs`
  - Add regressions for `--from` daemon routing across two indexed profiles.
  - Add a regression that `metaapp view --from <bot>` returns the selected profile daemon URL.
- Create: `tests/cli/daemonStartupDiagnostics.test.mjs`
  - Lock the diagnostics formatter and snapshot reader behavior.
- Modify: `tests/cli/serviceRuntimeRoutes.test.mjs`
  - Keep request shapes stable after the CLI request helpers gain target-home routing options.

---

### Task 1: Add failing regressions for profile-scoped daemon routing

**Files:**
- Modify: `tests/cli/runtime.test.mjs`
- Test: `tests/cli/runtime.test.mjs`

- [ ] **Step 1: Add a helper that writes a matching daemon record and records requests for one profile home**

```js
async function startProfileRecordingDaemon(homeDir, env, routeData = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      if (url.pathname === '/api/daemon/status') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(commandSuccess({ state: 'online' })));
        return;
      }

      requests.push({
        method: req.method ?? 'GET',
        pathname: url.pathname,
        search: url.search,
        body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null,
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(commandSuccess(routeData[url.pathname] ?? { ok: true })));
    });
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP daemon address');
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const store = createRuntimeStateStore(homeDir);
  await store.writeDaemon({
    ownerId: `daemon-${path.basename(homeDir)}`,
    pid: process.pid,
    host: '127.0.0.1',
    port: address.port,
    baseUrl,
    startedAt: Date.now(),
    configHash: buildDaemonConfigHash(env),
  });

  return {
    baseUrl,
    requests,
    async close() {
      await store.clearDaemon();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
```

- [ ] **Step 2: Add a failing test that proves `buzz post --from bob` must use Bob's daemon even when Alice is the explicit/active home**

```js
test('buzz post --from bob targets bob daemon instead of the current alice home daemon', async (t) => {
  const systemHome = await mkdtemp(path.join(os.tmpdir(), 'metabot-cross-profile-daemon-'));
  const aliceHome = await createProfileHome(systemHome, 'alice');
  const bobHome = await createProfileHome(systemHome, 'bob');

  const env = {
    HOME: systemHome,
    METABOT_HOME: aliceHome,
    METABOT_TEST_FAKE_CHAIN_WRITE: '1',
    METABOT_TEST_FAKE_SUBSIDY: '1',
    METABOT_CHAIN_API_BASE_URL: 'http://127.0.0.1:9',
  };

  const aliceDaemon = await startProfileRecordingDaemon(aliceHome, env);
  const bobDaemon = await startProfileRecordingDaemon(bobHome, env, {
    '/api/buzz/post': { pinId: 'bob-pin', ok: true },
  });
  t.after(async () => {
    await aliceDaemon.close();
    await bobDaemon.close();
    await cleanupProfileHome(systemHome);
  });

  const requestFile = path.join(aliceHome, 'buzz.json');
  await writeFile(requestFile, JSON.stringify({ content: 'hello from bob' }), 'utf8');

  const result = await runCommandWithEnv(aliceHome, ['buzz', 'post', '--from', 'bob', '--request-file', requestFile], env);

  assert.equal(result.exitCode, 0);
  assert.deepEqual(aliceDaemon.requests.filter((entry) => entry.pathname === '/api/buzz/post'), []);
  assert.equal(bobDaemon.requests.at(-1)?.pathname, '/api/buzz/post');
  assert.equal(bobDaemon.requests.at(-1)?.body?.from, 'bob');
});
```

- [ ] **Step 3: Add a failing test that proves `metaapp view --from bob` must return Bob's daemon URL**

```js
test('metaapp view --from bob returns bob daemon localUiUrl instead of alice baseUrl', async (t) => {
  const systemHome = await mkdtemp(path.join(os.tmpdir(), 'metabot-metaapp-view-daemon-'));
  const aliceHome = await createProfileHome(systemHome, 'alice');
  const bobHome = await createProfileHome(systemHome, 'bob');

  const env = {
    HOME: systemHome,
    METABOT_HOME: aliceHome,
    METABOT_TEST_FAKE_CHAIN_WRITE: '1',
    METABOT_TEST_FAKE_SUBSIDY: '1',
    METABOT_CHAIN_API_BASE_URL: 'http://127.0.0.1:9',
  };

  const aliceDaemon = await startProfileRecordingDaemon(aliceHome, env);
  const bobDaemon = await startProfileRecordingDaemon(bobHome, env);
  t.after(async () => {
    await aliceDaemon.close();
    await bobDaemon.close();
    await cleanupProfileHome(systemHome);
  });

  const opened = await runCommandWithEnv(aliceHome, ['metaapp', 'view', '--from', 'bob', '--mine'], env);

  assert.equal(opened.exitCode, 0);
  assert.equal(opened.payload.data.localUiUrl, `${bobDaemon.baseUrl}/ui/apps?from=bob&mine=true`);
});
```

- [ ] **Step 4: Run the new runtime regressions and verify they fail for the current active-home-only behavior**

Run:

```bash
npm run build
node --test tests/cli/runtime.test.mjs --test-name-pattern "targets bob daemon|returns bob daemon localUiUrl"
```

Expected:
- `buzz post --from bob` still tries Alice's daemon path or Alice startup path.
- `metaapp view --from bob` still returns Alice's `localUiUrl`.

---

### Task 2: Route daemon-backed `--from` commands through the selected profile home

**Files:**
- Modify: `src/cli/runtime.ts`
- Modify: `tests/cli/runtime.test.mjs`
- Modify: `tests/cli/serviceRuntimeRoutes.test.mjs`

- [ ] **Step 1: Add target-home daemon helpers in `src/cli/runtime.ts` without changing daemon HTTP routes**

```ts
interface DaemonRouteOptions {
  allowUnindexedExplicitHome?: boolean;
  targetHomeDir?: string;
}

async function ensureDaemonBaseUrlForHome(
  context: CliRuntimeContext,
  homeDir: string,
  options: DaemonRouteOptions = {},
): Promise<string> {
  return ensureDaemonBaseUrl(context, {
    ...options,
    targetHomeDir: path.resolve(homeDir),
  });
}

async function resolveDaemonTargetHome(
  context: CliRuntimeContext,
  from?: string,
  options: { allowUnindexedExplicitHome?: boolean } = {},
): Promise<string | MetabotCommandResult<never>> {
  if (!normalizeEnvText(from)) {
    return normalizeHomeDir(context.env, context.cwd, options);
  }
  const actor = await resolveActorHomeDir(context, from);
  return 'homeDir' in actor ? actor.homeDir : actor;
}
```

- [ ] **Step 2: Change the shared request/open helpers so they can use a selected target home**

```ts
async function requestJson<T>(
  context: CliRuntimeContext,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  routePath: string,
  body?: Record<string, unknown>,
  options: DaemonRouteOptions = {},
): Promise<MetabotCommandResult<T>> {
  const baseUrl = options.targetHomeDir
    ? await ensureDaemonBaseUrlForHome(context, options.targetHomeDir, options)
    : await ensureDaemonBaseUrl(context, options);
  const response = await fetch(`${baseUrl}${routePath}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return response.json() as Promise<MetabotCommandResult<T>>;
}

async function openLocalUiPage(input: {
  page: string;
  from?: string;
  traceId?: string;
  sessionId?: string;
  serviceId?: string;
  pinId?: string;
  firstPinId?: string;
  mine?: boolean;
}): Promise<MetabotCommandResult<unknown>> {
  const targetHome = await resolveDaemonTargetHome(context, input.from);
  if (typeof targetHome !== 'string') {
    return targetHome;
  }
  const baseUrl = await ensureDaemonBaseUrlForHome(context, targetHome);
  // existing query-string construction stays the same
}
```

- [ ] **Step 3: Audit every daemon-backed CLI dependency that already carries `from` and pass the selected target home**

Use the same helper pattern for representative call sites in `src/cli/runtime.ts`:

```ts
buzz: {
  post: async (input) => {
    const targetHome = await resolveDaemonTargetHome(context, input.from);
    if (typeof targetHome !== 'string') return targetHome;
    return requestJson(context, 'POST', '/api/buzz/post', input, { targetHomeDir: targetHome });
  },
},
metaapp: {
  list: async (input) => {
    const targetHome = await resolveDaemonTargetHome(context, input.from);
    if (typeof targetHome !== 'string') return targetHome;
    return requestJson(context, 'GET', `/api/metaapp/list${suffix}`, undefined, { targetHomeDir: targetHome });
  },
  view: async (input) => openLocalUiPage({ ...input, page: 'apps' }),
},
```

Apply the same target-home wiring anywhere the CLI both:
- forwards a `from` field to a daemon route, or
- builds a `localUiUrl` for a page that already accepts `from`.

Keep the current active-home behavior for commands that do not have `from`.

- [ ] **Step 4: Re-run the new regressions plus the canonical route-shape test**

Run:

```bash
npm run build
node --test tests/cli/serviceRuntimeRoutes.test.mjs tests/cli/runtime.test.mjs --test-name-pattern "daemon routes|targets bob daemon|returns bob daemon localUiUrl"
```

Expected:
- Both new cross-profile tests pass.
- Existing canonical route assertions still pass unchanged.

---

### Task 3: Replace the opaque startup timeout with actionable daemon diagnostics

**Files:**
- Create: `src/cli/daemonStartupDiagnostics.ts`
- Modify: `src/cli/runtime.ts`
- Create: `tests/cli/daemonStartupDiagnostics.test.mjs`

- [ ] **Step 1: Add a pure diagnostics module that can snapshot `daemon.json` and `daemon.lock` state for one profile home**

```ts
export interface DaemonStartupSnapshot {
  homeDir: string;
  preferredPort: number;
  daemonStatePath: string;
  lockPath: string;
  daemonRecord: RuntimeDaemonRecord | null;
  lockInfo: { ownerId?: string; pid?: number; acquiredAt?: number } | null;
  lockOwnerAlive: boolean | null;
}

export async function readDaemonStartupSnapshot(input: {
  homeDir: string;
  preferredPort: number;
}): Promise<DaemonStartupSnapshot> {
  const paths = resolveMetabotPaths(input.homeDir);
  const daemonRecord = await createRuntimeStateStore(paths).readDaemon();
  const lockInfo = await readLockInfo(paths.daemonLockPath);
  const lockOwnerAlive = typeof lockInfo?.pid === 'number' ? isProcessAlive(lockInfo.pid) : null;
  return {
    homeDir: path.resolve(input.homeDir),
    preferredPort: input.preferredPort,
    daemonStatePath: paths.daemonStatePath,
    lockPath: paths.daemonLockPath,
    daemonRecord,
    lockInfo,
    lockOwnerAlive,
  };
}
```

- [ ] **Step 2: Add a formatter test that locks the user-facing timeout message shape**

```js
test('formatDaemonStartupTimeoutMessage includes home, preferred port, daemon record, and lock hints', async () => {
  const message = formatDaemonStartupTimeoutMessage({
    homeDir: '/tmp/system/.metabot/profiles/ai-alice',
    preferredPort: 32390,
    daemonStatePath: '/tmp/system/.metabot/profiles/ai-alice/.runtime/daemon.json',
    lockPath: '/tmp/system/.metabot/profiles/ai-alice/.runtime/locks/daemon.lock',
    daemonRecord: {
      ownerId: 'metabot-daemon-a',
      pid: 12345,
      host: '127.0.0.1',
      port: 32390,
      baseUrl: 'http://127.0.0.1:32390',
      startedAt: 1,
      configHash: 'abc',
    },
    lockInfo: {
      ownerId: 'metabot-daemon-a',
      pid: 12345,
      acquiredAt: 2,
    },
    lockOwnerAlive: false,
  });

  assert.match(message, /ai-alice/);
  assert.match(message, /32390/);
  assert.match(message, /daemon\.json/i);
  assert.match(message, /daemon\.lock/i);
  assert.match(message, /lock owner alive: false/i);
});
```

- [ ] **Step 3: Wire the diagnostics snapshot into `startDetachedDaemon()` before throwing**

```ts
const preferredPort = parseDaemonPort(context.env[DAEMON_PREFERRED_PORT_ENV])
  ?? staleRecord?.port
  ?? getDefaultDaemonPort(homeDir);

// existing spawn + wait loop

const snapshot = await readDaemonStartupSnapshot({
  homeDir,
  preferredPort,
});
throw new Error(formatDaemonStartupTimeoutMessage(snapshot));
```

The final timeout must answer these questions in one message:
- which profile home it was trying to start,
- which port it preferred,
- whether `daemon.json` exists and what it points to,
- whether `daemon.lock` exists and whether the recorded pid is still alive.

- [ ] **Step 4: Run the diagnostics unit tests and the existing runtime daemon-start coverage**

Run:

```bash
npm run build
node --test tests/cli/daemonStartupDiagnostics.test.mjs tests/cli/runtime.test.mjs --test-name-pattern "daemon config restarts|fresh daemon starts|startup timeout"
```

Expected:
- The new diagnostics tests pass.
- Existing daemon-start tests still pass.

---

### Task 4: Verify the full narrow bundle, regenerate checked-in runtime artifacts, and commit once

**Files:**
- Modify: `src/cli/runtime.ts`
- Create: `src/cli/daemonStartupDiagnostics.ts`
- Modify: `tests/cli/runtime.test.mjs`
- Create: `tests/cli/daemonStartupDiagnostics.test.mjs`
- Modify: `tests/cli/serviceRuntimeRoutes.test.mjs`

- [ ] **Step 1: Run the targeted verification bundle in the same order every time**

Run:

```bash
npm run build
node --test tests/cli/daemonStartupDiagnostics.test.mjs tests/cli/serviceRuntimeRoutes.test.mjs tests/cli/runtime.test.mjs
npm run build:skillpacks
git diff --check
```

Expected:
- Build succeeds.
- Targeted CLI/runtime tests pass with `tests/cli/runtime.test.mjs` last.
- Skillpack regeneration succeeds.
- `git diff --check` reports no whitespace or conflict-marker issues.

- [ ] **Step 2: Sanity-check the implementation against the user-visible acceptance criteria**

Verify these behaviors explicitly:

```text
1. Active home = alice, command = buzz post --from bob
   Result: uses bob daemon, does not try to talk to alice daemon first.

2. Active home = alice, command = metaapp view --from bob --mine
   Result: localUiUrl baseUrl comes from bob daemon.

3. A daemon startup timeout mentions the selected profile home, preferred port,
   daemon.json path, daemon.lock path, and lock pid liveness.
```

- [ ] **Step 3: Commit the feature as one verified change set**

Run:

```bash
git add src/cli/runtime.ts src/cli/daemonStartupDiagnostics.ts tests/cli/runtime.test.mjs tests/cli/daemonStartupDiagnostics.test.mjs tests/cli/serviceRuntimeRoutes.test.mjs skillpacks
git commit -m "fix: route daemon-backed from commands by profile"
```

After the commit, post the required development diary via the `metabot-post-buzz` skill with the `eric` Bot slug, using the verified commit as the diary scope.

---

## Acceptance checklist

- `--from <bot>` daemon-backed commands no longer depend on the current active-home daemon.
- `metaapp view --from <bot>` returns a `localUiUrl` rooted at the selected profile daemon.
- Commands without `--from` keep current active-home behavior.
- A daemon startup timeout is no longer just `Timed out while starting the local MetaBot daemon.` and instead includes target-home diagnostics.
- No global supervisor or cross-profile daemon sharing is introduced in this round.
