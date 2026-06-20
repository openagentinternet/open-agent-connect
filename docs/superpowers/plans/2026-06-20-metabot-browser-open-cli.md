# MetaBot Browser Open CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `metabot browser open [--uri <resource-uri>]` as the canonical CLI launcher for the built-in Browser shell, returning `/browser`-based local URLs without adding `ui open --page browser` compatibility.

**Architecture:** Add a dedicated top-level CLI command and dependency boundary for Browser opening, parallel to but separate from `ui.open`. Reuse existing daemon base URL resolution and Browser `uri` query semantics so the new command only assembles `/browser` URLs and does not change Browser runtime routes or `/api/browser/*`.

**Tech Stack:** TypeScript strict CommonJS CLI code, existing `MetabotCommandResult` JSON envelope, Node test runner against built artifacts (`npm run build && node --test ...`).

---

## File Structure

- `src/cli/commands/browser.ts` (new): parse `metabot browser open [--uri ...]`, reject invalid invocations, and delegate to the Browser CLI dependency.
- `src/cli/main.ts`: register the new top-level `browser` command.
- `src/cli/types.ts`: define the Browser dependency shape (`browser.open({ uri? })`).
- `src/cli/runtime.ts`: implement the default Browser URL builder and merge injected Browser dependencies.
- `src/cli/commandHelp.ts`: document `metabot browser` and `metabot browser open`.
- `tests/cli/doctor.test.mjs`: cover parser/dispatch behavior with an injected Browser dependency.
- `tests/cli/runtime.test.mjs`: cover default `/browser` URL construction with the real runtime dependency path.
- `tests/cli/help.test.mjs`: cover top-level help visibility and `browser open` help content.

### Task 1: Add the Browser CLI command and default URL builder

**Files:**
- Create: `src/cli/commands/browser.ts`
- Modify: `src/cli/main.ts`
- Modify: `src/cli/types.ts`
- Modify: `src/cli/runtime.ts`
- Modify: `tests/cli/doctor.test.mjs`
- Modify: `tests/cli/runtime.test.mjs`

- [ ] **Step 1: Write the failing parser, dispatch, and runtime tests**

Update `tests/cli/doctor.test.mjs` so the harness can inject a Browser dependency and assert the new command surface directly:

```js
function createHarness(options = {}) {
  const homeDir = options.homeDir ?? '/tmp/metabot-cli-doctor-test-home';
  const stdout = [];
  const stderr = [];
  const calls = {
    browser: [],
    daemon: [],
    doctor: [],
    identity: [],
    identityWho: [],
    identityList: [],
    identityAssign: [],
    trace: [],
    ui: [],
  };

  return {
    calls,
    stdout,
    stderr,
    context: {
      env: {
        ...process.env,
        HOME: homeDir,
        ...options.env,
      },
      cwd: homeDir,
      stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
      stderr: { write: (chunk) => { stderr.push(String(chunk)); return true; } },
      dependencies: {
        browser: {
          open: async (input) => {
            calls.browser.push(input);
            return commandSuccess({
              localUiUrl: (() => {
                const query = new URLSearchParams();
                if (input.uri) query.set('uri', input.uri);
                const suffix = query.size ? `?${query.toString()}` : '';
                return `/browser${suffix}`;
              })(),
            });
          },
        },
        daemon: {
          start: async () => {
            calls.daemon.push({ command: 'start' });
            return commandSuccess({
              host: '127.0.0.1',
              port: 4827,
              baseUrl: 'http://127.0.0.1:4827',
            });
          },
        },
        doctor: {
          run: async () => {
            calls.doctor.push({ command: 'doctor' });
            return commandSuccess({
              checks: [
                { code: 'daemon_reachable', ok: true },
                { code: 'identity_loaded', ok: false },
              ],
            });
          },
        },
        identity: {
          create: async (input) => {
            calls.identity.push(input);
            return commandSuccess({
              name: input.name,
              globalMetaId: 'gm-alice',
            });
          },
          who: async () => {
            calls.identityWho.push({ command: 'who' });
            return commandSuccess({
              activeHomeDir: '/tmp/home-a',
              identity: {
                name: 'Alice',
                globalMetaId: 'gm-alice',
              },
            });
          },
          list: async () => {
            calls.identityList.push({ command: 'list' });
            return commandSuccess({
              activeHomeDir: '/tmp/home-a',
              profiles: [
                {
                  name: 'Alice',
                  homeDir: '/tmp/home-a',
                  globalMetaId: 'gm-alice',
                },
              ],
            });
          },
          assign: async (input) => {
            calls.identityAssign.push(input);
            return commandSuccess({
              activeHomeDir: '/tmp/home-b',
              assignedProfile: {
                name: input.name,
                homeDir: '/tmp/home-b',
                globalMetaId: 'gm-bob',
              },
            });
          },
        },
        trace: {
          get: async (input) => {
            calls.trace.push(input);
            return commandSuccess({
              traceId: input.traceId,
              status: 'completed',
            });
          },
        },
        ui: {
          open: async (input) => {
            calls.ui.push(input);
            return commandSuccess({
              page: input.page,
              localUiUrl: (() => {
                const query = new URLSearchParams();
                if (input.from) query.set('from', input.from);
                if (input.traceId) query.set('traceId', input.traceId);
                const suffix = query.size ? `?${query.toString()}` : '';
                return `/ui/${input.page}${suffix}`;
              })(),
            });
          },
        },
      },
    },
  };
}

test('runCli dispatches `metabot browser open` and returns the local Browser URL', async () => {
  const harness = createHarness();
  const exitCode = await runCli(['browser', 'open'], harness.context);

  assert.equal(exitCode, 0);
  assert.deepEqual(harness.calls.browser, [{}]);
  assert.deepEqual(parseLastJson(harness.stdout), {
    ok: true,
    state: 'success',
    data: {
      localUiUrl: '/browser',
    },
  });
});

test('runCli dispatches `metabot browser open --uri` and returns the encoded Browser URL', async () => {
  const harness = createHarness();
  const exitCode = await runCli(['browser', 'open', '--uri', 'metaid://idq1alice'], harness.context);

  assert.equal(exitCode, 0);
  assert.deepEqual(harness.calls.browser, [{ uri: 'metaid://idq1alice' }]);
  assert.deepEqual(parseLastJson(harness.stdout), {
    ok: true,
    state: 'success',
    data: {
      localUiUrl: '/browser?uri=metaid%3A%2F%2Fidq1alice',
    },
  });
});

test('runCli rejects invalid `metabot browser` invocations before opening', async () => {
  const unknownHarness = createHarness();
  const unknownExitCode = await runCli(['browser', 'unknown'], unknownHarness.context);
  assert.equal(unknownExitCode, 1);
  assert.deepEqual(unknownHarness.calls.browser, []);
  assert.deepEqual(parseLastJson(unknownHarness.stdout), {
    ok: false,
    state: 'failed',
    code: 'unknown_command',
    message: 'Unknown command: browser unknown',
  });

  const missingValueHarness = createHarness();
  const missingValueExitCode = await runCli(['browser', 'open', '--uri'], missingValueHarness.context);
  assert.equal(missingValueExitCode, 1);
  assert.deepEqual(missingValueHarness.calls.browser, []);
  assert.deepEqual(parseLastJson(missingValueHarness.stdout), {
    ok: false,
    state: 'failed',
    code: 'invalid_flag',
    message: 'Missing value for --uri.',
  });
});
```

Update `tests/cli/runtime.test.mjs` with the real runtime-path assertions:

```js
test('browser open returns a local Browser shell url', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  const opened = await runCommand(homeDir, ['browser', 'open']);

  assert.equal(opened.exitCode, 0);
  assert.equal(opened.payload.ok, true);
  assert.match(opened.payload.data.localUiUrl, /\/browser$/);
});

test('browser open with uri returns an encoded Browser shell url', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  const opened = await runCommand(homeDir, ['browser', 'open', '--uri', 'metaid://idq1alice']);

  assert.equal(opened.exitCode, 0);
  assert.equal(opened.payload.ok, true);
  assert.match(opened.payload.data.localUiUrl, /\/browser\?uri=metaid%3A%2F%2Fidq1alice$/);
});
```

- [ ] **Step 2: Run the targeted tests to verify they fail for the right reason**

Run:

```bash
npm run build && node --test tests/cli/doctor.test.mjs tests/cli/runtime.test.mjs
```

Expected: FAIL. At least the new Browser tests should fail with `Unknown command: browser` before any Browser dependency handler is called.

- [ ] **Step 3: Write the minimal Browser command and runtime implementation**

Create `src/cli/commands/browser.ts`:

```ts
import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { commandUnknownSubcommand } from './helpers';
import type { CliRuntimeContext } from '../types';

export async function runBrowserCommand(
  args: string[],
  context: CliRuntimeContext,
): Promise<MetabotCommandResult<unknown>> {
  if (args[0] !== 'open') {
    return commandUnknownSubcommand(`browser ${args.join(' ')}`.trim());
  }

  const uriIndex = args.indexOf('--uri');
  let uri: string | undefined;
  if (uriIndex !== -1) {
    const rawValue = args[uriIndex + 1];
    if (typeof rawValue !== 'string' || rawValue.startsWith('--')) {
      return commandFailed('invalid_flag', 'Missing value for --uri.');
    }
    const trimmed = rawValue.trim();
    if (!trimmed) {
      return commandFailed('invalid_flag', 'Missing value for --uri.');
    }
    uri = trimmed;
  }

  const handler = context.dependencies.browser?.open;
  if (!handler) {
    return commandFailed('not_implemented', 'Browser open handler is not configured.');
  }
  return handler(uri ? { uri } : {});
}
```

Update `src/cli/main.ts`:

```ts
import { runBrowserCommand } from './commands/browser';

// inside the main switch:
        case 'browser':
          result = await runBrowserCommand(rest, context);
          break;
```

Update `src/cli/types.ts` by inserting the Browser dependency immediately before the existing `config` block:

```ts
  browser?: {
    open?: (input: { uri?: string }) => Awaitable<MetabotCommandResult<unknown>>;
  };
  config?: {
    get?: (input: { from?: string; key: string }) => Awaitable<MetabotCommandResult<unknown>>;
    set?: (input: { from?: string; key: string; value: boolean | string }) => Awaitable<MetabotCommandResult<unknown>>;
  };
```

Update `src/cli/runtime.ts` in three exact places so Browser stays separate from `ui.open`:

```ts
async function openLocalBrowser(input: {
  uri?: string;
}): Promise<MetabotCommandResult<unknown>> {
  const baseUrl = await ensureDaemonBaseUrl(context);
  const query = new URLSearchParams();
  if (input.uri) query.set('uri', input.uri);
  const suffix = query.size ? `?${query.toString()}` : '';
  return commandSuccess({
    localUiUrl: `${baseUrl}/browser${suffix}`,
  });
}
```

Insert that helper immediately before `openLocalUiPage(...)`, then insert the Browser dependency immediately before the existing `config` dependency inside `return { ... }`:

```ts
  return {
    browser: {
      open: async (input) => openLocalBrowser(input),
    },
    config: {
      get: async (input) => {
        if (!isSupportedConfigKey(input.key)) {
          return commandFailed(
            'unsupported_config_key',
            `Unsupported config key: ${input.key}`,
          );
        }
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) {
          return actor;
        }
        const homeDir = actor.homeDir;
        const configStore = createConfigStore(homeDir);
        const config = await configStore.read();
        return commandSuccess({
          key: input.key,
          value: readConfigValue(config, input.key),
        });
      },
```

Update `mergeCliDependencies()` by inserting the Browser merge immediately before the existing `config` merge:

```ts
export function mergeCliDependencies(context: CliRuntimeContext): CliDependencies {
  const defaults = createDefaultCliDependencies(context);
  const provided = context.dependencies;
  return {
    browser: { ...defaults.browser, ...provided.browser },
    config: { ...defaults.config, ...provided.config },
    buzz: { ...defaults.buzz, ...provided.buzz },
  };
}
```

- [ ] **Step 4: Run the targeted tests again to verify the command now works**

Run:

```bash
npm run build && node --test tests/cli/doctor.test.mjs tests/cli/runtime.test.mjs
```

Expected: PASS. The Browser dispatch tests should return `/browser` and `/browser?uri=...`, and the runtime tests should prove the default dependency path stays on `/browser`, not `/ui/browser`.

- [ ] **Step 5: Commit the Browser command plumbing**

Run:

```bash
git add src/cli/commands/browser.ts src/cli/main.ts src/cli/types.ts src/cli/runtime.ts tests/cli/doctor.test.mjs tests/cli/runtime.test.mjs
git commit -m "feat: add browser open cli"
```

### Task 2: Add Browser help text and examples

**Files:**
- Modify: `src/cli/commandHelp.ts`
- Modify: `tests/cli/help.test.mjs`

- [ ] **Step 1: Write the failing help tests**

Extend the existing top-level help tests so Browser appears as a first-class command, then add a focused Browser leaf-help assertion:

```js
test('runCli prints top-level help text for `metabot --help` without a JSON envelope', async () => {
  const stdout = [];

  const exitCode = await runCli(['--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);

  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot <command>/m);
  assert.match(output, /^Commands:/m);
  assert.match(output, /^\s+browser\s+/m);
  assert.match(output, /^\s+identity\s+/m);
  assert.match(output, /^\s+bot\s+/m);
  assert.match(output, /^\s+config\s+/m);
  assert.match(output, /^\s+wallet\s+/m);
  assert.match(output, /^\s+services\s+/m);
  assert.match(output, /^\s+provider\s+/m);
  assert.match(output, /^\s+host\s+/m);
  assert.match(output, /^\s+trace\s+/m);
  assert.match(output, /^\s+system\s+/m);
  assert.match(output, /^\s+loom\s+/m);
  assert.match(output, /^\s+metaapp\s+/m);
  assert.doesNotMatch(output, /^\s+master\s+/m);
  assert.doesNotMatch(output, /^\s+evolution\s+/m);
  assert.equal(output.includes('"ok"'), false);
});

test('runCli prints machine-readable top-level help for `metabot --help --json`', async () => {
  const stdout = [];

  const exitCode = await runCli(['--help', '--json'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);

  const output = JSON.parse(stdout.join(''));
  assert.deepEqual(output.commandPath, []);
  assert.equal(output.command, 'metabot');
  assert.ok(Array.isArray(output.subcommands));
  assert.ok(output.subcommands.some((entry) => entry.name === 'browser'));
  assert.ok(output.subcommands.some((entry) => entry.name === 'bot'));
  assert.ok(output.subcommands.some((entry) => entry.name === 'host'));
  assert.ok(output.subcommands.some((entry) => entry.name === 'provider'));
  assert.ok(output.subcommands.some((entry) => entry.name === 'loom'));
  assert.ok(output.subcommands.some((entry) => entry.name === 'metaapp'));
  assert.equal(output.subcommands.some((entry) => entry.name === 'master'), false);
  assert.equal(output.subcommands.some((entry) => entry.name === 'evolution'), false);
});

test('runCli prints browser group help', async () => {
  const stdout = [];

  const exitCode = await runCli(['browser', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);

  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot browser <subcommand>/m);
  assert.match(output, /open\s+Open the built-in Agent Internet Browser shell\./);
  assert.equal(output.includes('"ok"'), false);
});

test('runCli documents browser open uri handoff', async () => {
  const stdout = [];

  const exitCode = await runCli(['browser', 'open', '--help', '--json'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);

  const output = JSON.parse(stdout.join(''));
  assert.deepEqual(output.commandPath, ['browser', 'open']);
  assert.equal(output.command, 'metabot browser open');
  assert.match(output.usage, /^metabot browser open \[--uri <resource-uri>\]$/);
  assert.ok(output.optionalFlags.some((entry) => entry.flag === '--uri'));
  assert.ok(output.successFields.includes('localUiUrl'));
  assert.ok(output.examples.includes("metabot browser open --uri 'metaid://idq1alice'"));
  assert.ok(output.examples.includes("metabot browser open --uri 'metaapp://8544d8...i0'"));
  assert.ok(output.examples.includes("metabot browser open --uri 'metafile://8544d8...i0'"));
});

test('runCli keeps browser out of ui open supported pages', async () => {
  const stdout = [];

  const exitCode = await runCli(['ui', 'open', '--help', '--json'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);

  const output = JSON.parse(stdout.join(''));
  assert.deepEqual(output.commandPath, ['ui', 'open']);
  assert.doesNotMatch(output.summary, /\bbrowser\b/i);
  assert.doesNotMatch(output.requiredFlags[0].description, /\bbrowser\b/i);
  assert.equal(output.examples.some((entry) => /--page browser\b/.test(entry)), false);
});
```

- [ ] **Step 2: Run the focused help tests to verify they fail**

Run:

```bash
npm run build && node --test tests/cli/help.test.mjs
```

Expected: FAIL. Browser should be missing from top-level help, `metabot browser --help` and `metabot browser open --help` should still resolve as unknown commands, and the current `ui open` help should continue to omit `browser`.

- [ ] **Step 3: Add the Browser help entries**

Insert the Browser group and Browser open leaf into `src/cli/commandHelp.ts` immediately before the existing `ui` section so Browser and UI stay adjacent in the help registry:

```ts
  {
    commandPath: ['browser'],
    summary: 'Open the built-in Agent Internet Browser shell.',
    usage: 'metabot browser <subcommand>',
    subcommands: [
      { name: 'open', summary: 'Open the built-in Agent Internet Browser shell.' },
    ],
    optionalFlags: [HELP_JSON_FLAG],
  },
  {
    commandPath: ['browser', 'open'],
    summary: 'Open the built-in Agent Internet Browser shell, optionally at a specific Browser resource URI.',
    usage: 'metabot browser open [--uri <resource-uri>]',
    optionalFlags: [
      {
        flag: '--uri',
        value: '<resource-uri>',
        description: 'Optional Browser resource URI such as metaid://<globalMetaId>, metaapp://<pinId>, or metafile://<pinId>.',
      },
      HELP_JSON_FLAG,
    ],
    successFields: [
      'localUiUrl',
    ],
    failureSemantics: [
      'Fails when the local daemon cannot build the Browser URL or when --uri is provided without a value.',
    ],
    examples: [
      'metabot browser open',
      "metabot browser open --uri 'metaid://idq1alice'",
      "metabot browser open --uri 'metaapp://8544d8...i0'",
      "metabot browser open --uri 'metafile://8544d8...i0'",
    ],
  },
```

Do not add `browser` to the `ui open --page` help entry or its supported-page description.

- [ ] **Step 4: Run the help tests again**

Run:

```bash
npm run build && node --test tests/cli/help.test.mjs
```

Expected: PASS. Top-level help should list Browser, `metabot browser --help` should exist, the Browser leaf help should document `--uri`, `localUiUrl`, and the three URI example families, and `ui open` help should still omit `browser`.

- [ ] **Step 5: Commit the help updates**

Run:

```bash
git add src/cli/commandHelp.ts tests/cli/help.test.mjs
git commit -m "docs: add browser cli help"
```
