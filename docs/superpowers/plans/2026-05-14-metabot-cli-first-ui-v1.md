# MetaBot CLI-First UI V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first CLI-first cleanup pass for the six built-in UI pages, with multi-bot `--from` actor selection and canonical service/order/refund commands.

**Architecture:** CLI parsers and daemon routes should call shared typed dependencies instead of creating separate behavior paths. New canonical commands go under `bot`, `services owned`, `services refunds`, and `trace sessions`; old `provider` and `publish-skills` commands stay as compatibility aliases.

**Tech Stack:** TypeScript CommonJS, Node CLI, Node test runner, daemon route handlers, JSON command envelopes.

---

## File Map

- Modify `src/cli/main.ts` to dispatch the new `bot` command group.
- Create `src/cli/commands/bot.ts` for bot management CLI parsing.
- Modify `src/cli/commands/services.ts` for `--from`, `services skills`, `services owned`, `services refunds`, and `services orders`.
- Modify `src/cli/commands/provider.ts` to delegate compatibility aliases to canonical service dependencies.
- Modify `src/cli/commands/trace.ts` for `trace sessions` and actor hints.
- Modify `src/cli/commands/ui.ts` for `--from` and `--session-id`.
- Modify `src/cli/types.ts` to add typed dependencies for bot, service-owned, refunds, orders, trace sessions, and actor selection.
- Modify `src/cli/runtime.ts` to map default dependencies to existing daemon routes and to resolve `--from` profile homes for local direct implementations where needed.
- Modify `src/daemon/routes/types.ts` only if the handler shape needs to align with CLI dependency names.
- Modify daemon routes only when existing route behavior cannot be mapped through shared dependencies.
- Modify `src/cli/commandHelp.ts` for canonical help and compatibility notes.
- Add/update tests in `tests/cli/services.test.mjs`, `tests/cli/trace.test.mjs`, `tests/cli/help.test.mjs`, and `tests/cli/bot.test.mjs`.
- Add route/contract tests if no existing daemon route coverage can assert the shared mapping.

## Task 1: Add CLI Dependency Shape

**Files:**
- Modify: `src/cli/types.ts`
- Test: `tests/cli/services.test.mjs`

- [ ] **Step 1: Write failing dispatch tests for new service dependency inputs**

Add tests that inject dependencies and assert parsed input:

```js
test('runCli dispatches services skills with --from actor', async () => {
  const calls = [];
  const exitCode = await runCli(['services', 'skills', '--from', 'alice'], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      services: {
        listSkills: async (input) => {
          calls.push(input);
          return commandSuccess({ skills: [] });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{ from: 'alice' }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run build && node --test tests/cli/services.test.mjs
```

Expected: FAIL because `listSkills` or `services skills` is not implemented.

- [ ] **Step 3: Update `CliDependencies`**

Add services dependency methods:

```ts
listSkills?: (input?: { from?: string }) => Awaitable<MetabotCommandResult<unknown>>;
listOwned?: (input: { from?: string; all?: boolean; page: number; pageSize: number; refresh: boolean }) => Awaitable<MetabotCommandResult<unknown>>;
listOwnedOrders?: (input: { serviceId: string; from?: string; all?: boolean; page: number; pageSize: number; refresh: boolean }) => Awaitable<MetabotCommandResult<unknown>>;
modifyOwned?: (input: Record<string, unknown> & { from?: string }) => Awaitable<MetabotCommandResult<unknown>>;
revokeOwned?: (input: { serviceId: string; from?: string; network?: string }) => Awaitable<MetabotCommandResult<unknown>>;
listRefunds?: (input: { from?: string; all?: boolean; kind?: 'initiated' | 'received' | 'all' }) => Awaitable<MetabotCommandResult<unknown>>;
settleRefund?: (input: { from?: string; orderId?: string; paymentTxid?: string }) => Awaitable<MetabotCommandResult<unknown>>;
inspectOrder?: (input: { from?: string; orderId?: string; paymentTxid?: string }) => Awaitable<MetabotCommandResult<unknown>>;
```

Add bot dependencies matching `src/daemon/routes/types.ts`.

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: PASS after parser implementation lands in later tasks, or TypeScript errors that identify remaining dependency sites.

- [ ] **Step 5: Commit**

Commit after the first complete passing service parser slice, not after types alone.

## Task 2: Implement Canonical `services skills` And `--from`

**Files:**
- Modify: `src/cli/commands/services.ts`
- Modify: `src/cli/runtime.ts`
- Modify: `src/cli/commandHelp.ts`
- Test: `tests/cli/services.test.mjs`
- Test: `tests/cli/help.test.mjs`

- [ ] **Step 1: Write failing tests**

Cover:

- `services skills --from alice`
- compatibility alias `services publish-skills --slug alice`
- `services publish --from alice --payload-file payload.json --chain doge`
- `services call --from buyer --request-file request.json`
- `services rate --from buyer --request-file rating.json --chain opcat`

- [ ] **Step 2: Verify RED**

Run:

```bash
npm run build && node --test tests/cli/services.test.mjs tests/cli/help.test.mjs
```

Expected: FAIL on unknown subcommands or missing parsed fields.

- [ ] **Step 3: Implement parser changes**

Add flag parsing:

```ts
const from = readFlagValue(args, '--from') ?? readFlagValue(args, '--slug') ?? undefined;
```

Use `--slug` only for compatibility aliases where already exposed. Canonical docs should prefer `--from`.

- [ ] **Step 4: Update runtime default dependency**

Map `services.listSkills({ from })` to `/api/services/publish/skills?slug=<from>` when `from` exists. Map `publish/call/rate` to existing daemon routes while preserving `from` in the request body.

- [ ] **Step 5: Update help output**

Document:

```bash
metabot services skills [--from <bot-slug>]
metabot services publish [--from <bot-slug>] --payload-file <path> [--chain <mvc|btc|doge|opcat>]
metabot services call [--from <bot-slug>] --request-file <path>
metabot services rate [--from <bot-slug>] --request-file <path> [--chain <mvc|btc|doge|opcat>]
```

- [ ] **Step 6: Verify GREEN**

Run:

```bash
npm run build && node --test tests/cli/services.test.mjs tests/cli/help.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit and post buzz**

Commit message:

```bash
git commit -m "feat: add actor-aware service publish commands"
```

Post a development diary with `metabot-post-buzz`.

## Task 3: Implement `services owned`

**Files:**
- Modify: `src/cli/commands/services.ts`
- Modify: `src/cli/runtime.ts`
- Modify: `src/cli/commandHelp.ts`
- Test: `tests/cli/services.test.mjs`

- [ ] **Step 1: Write failing tests**

Cover:

- `services owned list --all --page 2 --page-size 10 --refresh`
- `services owned list --from alice`
- `services owned orders --service-id svc --all --page 3`
- `services owned modify --from alice --payload-file payload.json --chain btc`
- `services owned revoke --from alice --service-id svc --chain doge`
- reject `--all` for `modify` and `revoke`

- [ ] **Step 2: Verify RED**

Run:

```bash
npm run build && node --test tests/cli/services.test.mjs
```

Expected: FAIL on unknown `owned`.

- [ ] **Step 3: Implement parser and dependency dispatch**

Use page defaults matching daemon routes:

```ts
page: 1
pageSize: 20
refresh: hasFlag(args, '--refresh')
```

For mutate commands, read JSON payload and merge `from` and optional chain:

```ts
return handler({ ...payload, ...(from ? { from } : {}), ...(chain ? { network: chain } : {}) });
```

- [ ] **Step 4: Map runtime defaults**

Map to existing daemon routes:

- `/api/services/my`
- `/api/services/my/orders`
- `/api/services/my/modify`
- `/api/services/my/revoke`

Preserve `from` in request data so handlers can support actor-specific resolution.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm run build && node --test tests/cli/services.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit and post buzz**

Commit message:

```bash
git commit -m "feat: add services owned cli"
```

## Task 4: Implement `services refunds` And `services orders`

**Files:**
- Modify: `src/cli/commands/services.ts`
- Modify: `src/cli/commands/provider.ts`
- Modify: `src/cli/runtime.ts`
- Modify: `src/cli/commandHelp.ts`
- Test: `tests/cli/services.test.mjs`
- Test: `tests/cli/help.test.mjs`

- [ ] **Step 1: Write failing tests**

Cover:

- `services refunds list --all --received`
- `services refunds list --from alice --initiated`
- `services refunds settle --from seller --order-id order-1`
- `services refunds settle --payment-txid txid`
- `services orders inspect --from seller --payment-txid txid`
- compatibility alias `provider refund settle --order-id order-1`
- compatibility alias `provider order inspect --payment-txid txid`

- [ ] **Step 2: Verify RED**

Run:

```bash
npm run build && node --test tests/cli/services.test.mjs tests/cli/help.test.mjs
```

Expected: FAIL on unknown canonical commands.

- [ ] **Step 3: Implement parser and alias dispatch**

Move shared seller-order selector parsing into a helper if needed. Provider aliases should call the same dependency names used by canonical `services` commands.

- [ ] **Step 4: Runtime default mapping**

Map canonical commands to existing routes:

- `services.orders.inspect` -> `/api/provider/order`
- `services.refunds.list` -> `/api/provider/refunds` or `/api/provider/refunds/initiated`
- `services.refunds.settle` -> `/api/provider/refund/settle`

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm run build && node --test tests/cli/services.test.mjs tests/cli/help.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit and post buzz**

Commit message:

```bash
git commit -m "feat: move service refunds into services cli"
```

## Task 5: Implement `bot` Command Group

**Files:**
- Create: `src/cli/commands/bot.ts`
- Modify: `src/cli/main.ts`
- Modify: `src/cli/runtime.ts`
- Modify: `src/cli/types.ts`
- Modify: `src/cli/commandHelp.ts`
- Test: `tests/cli/bot.test.mjs`
- Test: `tests/cli/help.test.mjs`

- [ ] **Step 1: Write failing tests**

Cover:

- `bot list`
- `bot show --from alice`
- `bot create --name Alice`
- `bot update --from alice --payload-file payload.json`
- `bot delete --from alice --confirm`
- `bot config get --from alice`
- `bot config set --from alice --payload-file config.json`
- `bot wallet --from alice`
- `bot backup --from alice`
- `bot runtimes list --from alice`
- `bot runtimes discover --from alice`
- `bot sessions --from alice --limit 50`

- [ ] **Step 2: Verify RED**

Run:

```bash
npm run build && node --test tests/cli/bot.test.mjs tests/cli/help.test.mjs
```

Expected: FAIL because top-level `bot` is unknown.

- [ ] **Step 3: Implement command parser**

Follow existing command style from `src/cli/commands/identity.ts`, `llm.ts`, and `provider.ts`, but use dependency injection instead of direct local fetch.

- [ ] **Step 4: Add top-level dispatch**

Add `case 'bot'` in `src/cli/main.ts`.

- [ ] **Step 5: Runtime mapping**

Map to existing daemon `/api/bot/*` routes. Keep `--from` as profile slug for profile-specific routes.

- [ ] **Step 6: Verify GREEN**

Run:

```bash
npm run build && node --test tests/cli/bot.test.mjs tests/cli/help.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit and post buzz**

Commit message:

```bash
git commit -m "feat: add bot management cli"
```

## Task 6: Implement `trace sessions` And Actor Hints

**Files:**
- Modify: `src/cli/commands/trace.ts`
- Modify: `src/cli/runtime.ts`
- Modify: `src/cli/types.ts`
- Modify: `src/cli/commandHelp.ts`
- Test: `tests/cli/trace.test.mjs`
- Test: `tests/cli/help.test.mjs`

- [ ] **Step 1: Write failing tests**

Cover:

- `trace sessions --all --limit 50`
- `trace sessions --from alice --limit 20`
- `trace get --session-id s1 --from alice`
- `trace watch --trace-id t1 --from alice`

- [ ] **Step 2: Verify RED**

Run:

```bash
npm run build && node --test tests/cli/trace.test.mjs tests/cli/help.test.mjs
```

Expected: FAIL on unknown `sessions` or missing actor fields.

- [ ] **Step 3: Implement parser and dependency dispatch**

Extend trace dependencies:

```ts
listSessions?: (input: { from?: string; all?: boolean; limit?: number }) => Awaitable<MetabotCommandResult<unknown>>;
```

Keep existing `get` and `watch` output semantics.

- [ ] **Step 4: Runtime mapping**

Map list to `/api/trace/sessions`. If `--from` filtering is not yet supported by the daemon, return all sessions and add a follow-up task only if UI requires filtering. Do not fake filtering in the parser.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm run build && node --test tests/cli/trace.test.mjs tests/cli/help.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit and post buzz**

Commit message:

```bash
git commit -m "feat: add trace session listing cli"
```

## Task 7: Update UI Bridge Command

**Files:**
- Modify: `src/cli/commands/ui.ts`
- Modify: `src/cli/runtime.ts`
- Modify: `src/cli/types.ts`
- Modify: `src/cli/commandHelp.ts`
- Test: `tests/cli/ui.test.mjs` or existing help/CLI test file

- [ ] **Step 1: Write failing tests**

Cover:

- `ui open --page trace --session-id s1`
- `ui open --page publish --from alice`
- `ui open --page my-services --service-id svc`

- [ ] **Step 2: Verify RED**

Run:

```bash
npm run build && node --test tests/cli/help.test.mjs
```

Expected: FAIL until tests and parser support exist.

- [ ] **Step 3: Implement parser and URL query generation**

Preserve existing `traceId`; add `sessionId`, `from`, and `serviceId` query params.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npm run build && node --test tests/cli/help.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit and post buzz**

Commit message:

```bash
git commit -m "feat: extend ui open selectors"
```

## Task 8: Align Daemon Route Contracts

**Files:**
- Modify: `src/daemon/routes/services.ts`
- Modify: `src/daemon/routes/provider.ts`
- Modify: `src/daemon/routes/trace.ts`
- Modify: `src/daemon/routes/bot.ts`
- Modify: `src/daemon/routes/types.ts`
- Test: existing daemon route tests or new focused tests

- [ ] **Step 1: Write failing contract tests**

Assert that route-level inputs match CLI dependency shapes where routes already expose matching UI behavior.

- [ ] **Step 2: Verify RED**

Run targeted route tests. If no route test harness exists, add handler-level tests with mocked `handlers`.

- [ ] **Step 3: Normalize route input names**

Routes may continue to expose old URLs, but handler calls should use the same actor and command contract names as CLI dependencies.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npm run build && node --test tests/cli/services.test.mjs tests/cli/trace.test.mjs tests/cli/bot.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit and post buzz**

Commit message:

```bash
git commit -m "refactor: align daemon routes with cli contracts"
```

## Task 9: Manual CLI Acceptance With Real Local Keys

**Files:**
- No code changes unless bugs are found.

- [ ] **Step 1: Build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 2: Read-only smoke tests**

Run:

```bash
node dist/cli/main.js bot list
node dist/cli/main.js network services --online --limit 5
node dist/cli/main.js services owned list --all --page 1 --page-size 5
node dist/cli/main.js services refunds list --all
node dist/cli/main.js trace sessions --all --limit 10
```

Expected: each returns a JSON envelope and does not depend on a hard-coded active-only bot.

- [ ] **Step 3: Actor-specific smoke tests**

Choose a real local bot slug:

```bash
BOT_SLUG=<local-bot-slug>
node dist/cli/main.js bot show --from "$BOT_SLUG"
node dist/cli/main.js services skills --from "$BOT_SLUG"
node dist/cli/main.js bot runtimes list --from "$BOT_SLUG"
```

Expected: results correspond to that bot.

- [ ] **Step 4: Chain-write acceptance**

Use real local keys only after read-only tests pass. Publish a small test service with `--from <bot-slug>` and verify provider identity in the result.

- [ ] **Step 5: Record findings**

Create a concise test report in the final implementation message. Do not commit local secrets or request JSON files.

## Task 10: Final Review And Full Verification

**Files:**
- No code changes unless review or tests find issues.

- [ ] **Step 1: Run focused verification**

Run:

```bash
npm run build
node --test tests/cli/services.test.mjs tests/cli/trace.test.mjs tests/cli/help.test.mjs tests/cli/bot.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS before final merge because CLI contracts, daemon contracts, and chain-write actor selection are touched.

- [ ] **Step 3: Dispatch code review subagent**

Ask the reviewer to inspect:

- canonical command naming;
- `--from` actor resolution;
- alias compatibility;
- daemon/CLI contract consistency;
- test coverage against this plan.

- [ ] **Step 4: Dispatch CLI test subagent**

Ask the tester to run the manual acceptance list above using real local MetaBot profiles and report exact command outputs/summaries.

- [ ] **Step 5: Fix review/test findings**

Use TDD for any bug fixes. Commit each independent fix and post a development diary with `metabot-post-buzz`.
