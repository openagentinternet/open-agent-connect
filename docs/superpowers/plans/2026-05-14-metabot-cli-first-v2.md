# MetaBot CLI-First V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add consistent optional `--from <bot-slug>` actor selection to the remaining MetaBot CLI commands, especially every command that writes chain data or uses a local Bot private key.

**Architecture:** CLI parsers should read `--from` and pass it through dependency inputs. Runtime dependencies and daemon default handlers should resolve the selected profile before choosing stores, config, signers, private chat keys, default write networks, or local history. Commands without `--from` keep current active-identity behavior.

**Tech Stack:** TypeScript CommonJS, Node CLI command parsers, daemon HTTP routes, local profile/state stores, chain adapters, Node test runner, machine-first JSON command envelopes.

---

## File Map

- Modify `src/cli/commands/helpers.ts` for shared actor flag parsing.
- Modify `src/cli/types.ts` for actor-aware dependency input types.
- Modify `src/cli/runtime.ts` for actor-home resolution and daemon route forwarding.
- Modify `src/daemon/routes/types.ts` for actor-aware daemon handler input types.
- Modify `src/daemon/defaultHandlers.ts` for actor-scoped signers, stores, config, and private chat state.
- Modify `src/cli/commands/buzz.ts`, `chain.ts`, `file.ts`, `chat.ts`, `master.ts`, `wallet.ts`, `evolution.ts`, `config.ts`, and `llm.ts` for `--from` parsing.
- Modify `src/cli/commandHelp.ts` for help text, usage strings, and examples.
- Update tests:
  - `tests/cli/buzz.test.mjs`
  - `tests/cli/chain.test.mjs`
  - `tests/cli/file.test.mjs`
  - `tests/cli/chat.test.mjs`
  - `tests/cli/masterCommand.test.mjs`
  - `tests/cli/wallet.test.mjs`
  - `tests/cli/evolution.test.mjs`
  - `tests/cli/config.test.mjs`
  - `tests/cli/help.test.mjs`
  - create `tests/cli/llm.test.mjs` if no equivalent focused LLM parser test exists
  - update focused daemon/default-handler tests where parser tests cannot prove signer/profile scoping

## Task 1: Shared Actor Plumbing

**Files:**
- Modify: `src/cli/commands/helpers.ts`
- Modify: `src/cli/types.ts`
- Modify: `src/cli/runtime.ts`
- Test: first command parser test touched in Task 2

- [ ] **Step 1: Write the first failing actor parser test in Task 2 before modifying helpers**

Use a real command parser test to prove the helper is necessary. Do not add unused helper code without a red test.

- [ ] **Step 2: Add a shared `readFromFlag` helper**

Add a helper with explicit alias control:

```ts
export function readFromFlag(
  args: string[],
  options: { allowSlugAlias?: boolean } = {},
): string | undefined {
  return readFlagValue(args, '--from')
    ?? (options.allowSlugAlias ? readFlagValue(args, '--slug') : null)
    ?? undefined;
}
```

- [ ] **Step 3: Add actor-aware dependency input types**

Add optional `from?: string` to the relevant dependency signatures in `src/cli/types.ts`:

```ts
buzz.post
chain.write
file.upload
chat.private
chat.conversations
chat.messages
chat.autoReplyStatus
chat.setAutoReply
master.publish
master.ask
master.trace
wallet.balance
wallet.transfer
evolution.status
evolution.adopt
evolution.publish
evolution.rollback
evolution.search
evolution.import
evolution.imported
config.get
config.set
llm.listBindings
llm.bindRuntime
llm.unbindRuntime
llm.setPreferredRuntime
llm.getPreferredRuntime
```

Use the existing dependency method names where they differ from the list above.

- [ ] **Step 4: Add runtime actor resolution helper**

In `src/cli/runtime.ts`, add a local helper that resolves the profile home from optional `from`:

```ts
async function resolveActorHomeDir(
  context: CliRuntimeContext,
  from?: string,
): Promise<MetabotCommandResult<never> | { homeDir: string }> {
  if (!from) return { homeDir: normalizeHomeDir(context.env, context.cwd) };
  const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
  const profiles = await listIdentityProfiles(systemHomeDir).catch(() => []);
  const resolved = resolveProfileNameMatch(from, profiles);
  if (resolved.status === 'not_found') return commandFailed('profile_not_found', resolved.message);
  if (resolved.status === 'ambiguous') return commandFailed('identity_profile_ambiguous', resolved.message);
  return { homeDir: resolved.match.homeDir };
}
```

Keep exact return shape flexible if TypeScript needs a discriminant.

- [ ] **Step 5: Verify build after each slice, not as a standalone commit unless buildable**

Run:

```bash
npm run build
```

Expected: PASS once Task 2 integrates the helper.

## Task 2: Basic Chain Write Commands

**Files:**
- Modify: `src/cli/commands/buzz.ts`
- Modify: `src/cli/commands/chain.ts`
- Modify: `src/cli/commands/file.ts`
- Modify: `src/cli/runtime.ts`
- Modify: `src/daemon/routes/types.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `src/cli/commandHelp.ts`
- Test: `tests/cli/buzz.test.mjs`
- Test: `tests/cli/chain.test.mjs`
- Test: `tests/cli/file.test.mjs`
- Test: `tests/cli/help.test.mjs`

- [ ] **Step 1: Write failing parser tests**

Add tests that inject command dependencies and assert `from` is forwarded:

```js
await runCli(['buzz', 'post', '--from', 'alice', '--request-file', requestFile, '--chain', 'doge'], harness);
assert.deepEqual(calls[0].from, 'alice');
assert.deepEqual(calls[0].network, 'doge');
```

Repeat the same pattern for:

```bash
metabot chain write --from alice --request-file pin.json --chain opcat
metabot file upload --from alice --request-file file.json --chain opcat
```

- [ ] **Step 2: Run the red tests**

Run:

```bash
npm run build && node --test tests/cli/buzz.test.mjs tests/cli/chain.test.mjs tests/cli/file.test.mjs
```

Expected: FAIL because `from` is missing from dependency inputs.

- [ ] **Step 3: Implement parser pass-through**

Use `readFromFlag(args)` in `buzz.ts`, `chain.ts`, and `file.ts`. Merge `from` into the parsed request after path normalization and after `network` selection.

- [ ] **Step 4: Implement daemon/default-handler actor scoping**

In `src/daemon/defaultHandlers.ts`, resolve `rawInput.from` before signer/store use for:

- `buzz.post`
- `chain.write`
- `file.upload`

The selected actor must control:

- runtime state store;
- signer;
- config store default write network;
- attachment upload signer for buzz attachments;
- file upload signer and upload network.

- [ ] **Step 5: Update help**

Document:

```bash
metabot buzz post [--from <bot-slug>] --request-file <path> [--chain <mvc|btc|doge|opcat>]
metabot chain write [--from <bot-slug>] --request-file <path> [--chain <mvc|btc|doge|opcat>]
metabot file upload [--from <bot-slug>] --request-file <path> [--chain <mvc|btc|opcat>]
```

- [ ] **Step 6: Verify green**

Run:

```bash
npm run build && node --test tests/cli/buzz.test.mjs tests/cli/chain.test.mjs tests/cli/file.test.mjs tests/cli/help.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit and post buzz**

Run:

```bash
git add src/cli/commands/helpers.ts src/cli/types.ts src/cli/runtime.ts src/daemon/routes/types.ts src/daemon/defaultHandlers.ts src/cli/commands/buzz.ts src/cli/commands/chain.ts src/cli/commands/file.ts src/cli/commandHelp.ts tests/cli/buzz.test.mjs tests/cli/chain.test.mjs tests/cli/file.test.mjs tests/cli/help.test.mjs
git commit -m "feat: add actor selection to basic chain writes"
```

Then use `metabot-post-buzz` with a development diary for the commit.

## Task 3: Chat Commands

**Files:**
- Modify: `src/cli/commands/chat.ts`
- Modify: `src/cli/runtime.ts`
- Modify: `src/daemon/routes/types.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `src/cli/commandHelp.ts`
- Test: `tests/cli/chat.test.mjs`
- Test: relevant daemon/default-handler chat tests if they exist

- [ ] **Step 1: Write failing parser tests**

Cover:

```bash
metabot chat private --from alice --request-file chat.json --chain doge
metabot chat conversations --from alice
metabot chat messages --from alice --conversation-id c1 --limit 25
metabot chat auto-reply status --from alice
metabot chat auto-reply enable --from alice --strategy default
metabot chat auto-reply disable --from alice
```

Expected dependency inputs include `from: 'alice'`.

- [ ] **Step 2: Run the red tests**

Run:

```bash
npm run build && node --test tests/cli/chat.test.mjs
```

Expected: FAIL because chat parsers drop `from`.

- [ ] **Step 3: Implement parser pass-through**

Add `from` to the dependency input for every actor-scoped chat subcommand.

- [ ] **Step 4: Implement daemon/default-handler actor scoping**

`chat.private` must resolve the actor before:

- reading identity state;
- reading private chat identity;
- resolving default write network;
- writing simplemsg;
- persisting private chat state;
- writing trace artifacts.

Conversation, message, and auto-reply commands must read/write the selected actor's private chat state and auto-reply config.

- [ ] **Step 5: Update help**

Document `--from <bot-slug>` for `chat private`, `chat conversations`, `chat messages`, and all `chat auto-reply` subcommands.

- [ ] **Step 6: Verify green**

Run:

```bash
npm run build && node --test tests/cli/chat.test.mjs tests/cli/help.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit and post buzz**

Run:

```bash
git add src/cli/commands/chat.ts src/cli/runtime.ts src/daemon/routes/types.ts src/daemon/defaultHandlers.ts src/cli/commandHelp.ts tests/cli/chat.test.mjs tests/cli/help.test.mjs
git commit -m "feat: add actor selection to chat cli"
```

Then use `metabot-post-buzz`.

## Task 4: Wallet Commands

**Files:**
- Modify: `src/cli/commands/wallet.ts`
- Modify: `src/cli/runtime.ts`
- Modify: `src/cli/commandHelp.ts`
- Test: `tests/cli/wallet.test.mjs`
- Test: focused runtime wallet tests if existing parser tests cannot prove selected home usage

- [ ] **Step 1: Write failing parser tests**

Cover:

```bash
metabot wallet balance --from alice --chain btc
metabot wallet transfer --from alice --to <address> --amount 0.00001BTC --confirm
```

Expected dependency inputs include `from: 'alice'`.

- [ ] **Step 2: Run the red tests**

Run:

```bash
npm run build && node --test tests/cli/wallet.test.mjs
```

Expected: FAIL because wallet parsers drop `from`.

- [ ] **Step 3: Implement parser pass-through**

Add `from` to `wallet.balance` and `wallet.transfer` dependency inputs.

- [ ] **Step 4: Implement runtime actor scoping**

Resolve selected actor home before reading:

- runtime state store;
- profile addresses;
- secret store mnemonic;
- transfer derivation path.

The active-identity path remains unchanged when `from` is omitted.

- [ ] **Step 5: Update help**

Document:

```bash
metabot wallet balance [--from <bot-slug>] [--chain <all|mvc|btc|doge|opcat>]
metabot wallet transfer [--from <bot-slug>] --to <address> --amount <amount><UNIT> [--confirm]
```

- [ ] **Step 6: Verify green**

Run:

```bash
npm run build && node --test tests/cli/wallet.test.mjs tests/cli/help.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit and post buzz**

Run:

```bash
git add src/cli/commands/wallet.ts src/cli/runtime.ts src/cli/commandHelp.ts tests/cli/wallet.test.mjs tests/cli/help.test.mjs
git commit -m "feat: add actor selection to wallet cli"
```

Then use `metabot-post-buzz`.

## Task 5: Config And LLM Commands

**Files:**
- Modify: `src/cli/commands/config.ts`
- Modify: `src/cli/commands/llm.ts`
- Modify: `src/cli/runtime.ts`
- Modify: `src/cli/commandHelp.ts`
- Test: `tests/cli/config.test.mjs`
- Test: create or modify `tests/cli/llm.test.mjs`
- Test: `tests/cli/help.test.mjs`

- [ ] **Step 1: Write failing parser tests**

Cover:

```bash
metabot config get --from alice chain.defaultWriteNetwork
metabot config set --from alice chain.defaultWriteNetwork opcat
metabot llm bindings --from alice
metabot llm bind --from alice --runtime-id r1 --role primary
metabot llm unbind --from alice --binding-id b1
metabot llm set-preferred --from alice --provider codex
metabot llm get-preferred --from alice
```

- [ ] **Step 2: Run the red tests**

Run:

```bash
npm run build && node --test tests/cli/config.test.mjs tests/cli/llm.test.mjs
```

Expected: FAIL because these parsers drop `from`.

- [ ] **Step 3: Implement parser pass-through**

Add `from` to config and LLM dependency inputs.

For LLM commands, keep `--slug` compatibility only where it already exists. Canonical examples should use `--from`.

- [ ] **Step 4: Implement runtime actor scoping**

Resolve selected actor home before accessing:

- config stores;
- LLM binding stores;
- preferred runtime state;

- [ ] **Step 5: Update help**

Document `--from <bot-slug>` for all profile-local config and LLM commands. Explain any retained `--slug` option as a compatibility alias.

- [ ] **Step 6: Verify green**

Run:

```bash
npm run build && node --test tests/cli/config.test.mjs tests/cli/llm.test.mjs tests/cli/help.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit and post buzz**

Run:

```bash
git add src/cli/commands/config.ts src/cli/commands/llm.ts src/cli/runtime.ts src/cli/commandHelp.ts tests/cli/config.test.mjs tests/cli/llm.test.mjs tests/cli/help.test.mjs
git commit -m "feat: add actor selection to profile tools"
```

Then use `metabot-post-buzz`.

## Task 6: Documentation, Skill Examples, And Final Acceptance

**Files:**
- Modify: in-repository docs and skill documents only when they contain stale command examples.
- Test: focused CLI and daemon suites touched by Tasks 2-6.

- [ ] **Step 1: Search stale command examples**

Run:

```bash
rg "metabot (buzz post|chain write|file upload|chat private|master publish|master ask|wallet|evolution publish|llm .*--slug)" docs src tests release -n
```

- [ ] **Step 2: Update in-repo examples**

Prefer examples that show `--from <bot-slug>` for actor-sensitive operations. Do not edit external installed skills outside the repository in this task.

- [ ] **Step 3: Run focused verification**

Run:

```bash
npm run build && node --test \
  tests/cli/buzz.test.mjs \
  tests/cli/chain.test.mjs \
  tests/cli/file.test.mjs \
  tests/cli/chat.test.mjs \
  tests/cli/masterCommand.test.mjs \
  tests/cli/wallet.test.mjs \
  tests/cli/config.test.mjs \
  tests/cli/llm.test.mjs \
  tests/cli/evolution.test.mjs \
  tests/cli/help.test.mjs
```

Add any daemon/default-handler test files touched during implementation.

- [ ] **Step 4: Run help smoke commands**

Run:

```bash
node dist/cli/main.js buzz post --help --json
node dist/cli/main.js chain write --help --json
node dist/cli/main.js file upload --help --json
node dist/cli/main.js chat private --help --json
node dist/cli/main.js master publish --help --json
node dist/cli/main.js wallet balance --help --json
node dist/cli/main.js evolution publish --help --json
```

Expected: each actor-scoped command help includes `--from <bot-slug>`.

- [ ] **Step 5: Run user-requested subagent checks after code is complete**

Dispatch:

- one code review subagent focused on signer/profile correctness and CLI-first architecture;
- one CLI smoke subagent focused on real `metabot` command usability.

- [ ] **Step 6: Fix accepted findings, rerun focused verification, commit, and post buzz**

Commit message for docs-only cleanup if needed:

```bash
git commit -m "docs: update cli first v2 actor examples"
```

Every commit in this task still requires a development diary through `metabot-post-buzz`.
