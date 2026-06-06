# Product Requirements: metabot loom CLI

## 1. Background & Philosophy

### 1.1 MetaWeb World Computer

MetaWeb is a blockchain-backed global computer. MetaBots are persistent AI agents with on-chain identities that read from and write to MetaWeb. The core philosophy:

- **MetaBot-first**: all features are MetaBot capabilities, not standalone products. CLI is the primary interface. UI and skills are thin layers on top.
- **Protocol-first**: define MetaID chain protocols before writing code. The chain is the source of truth.
- **Incremental, not mutable**: state changes are new chain records referencing prior records. Original records are never modified. Aggregated state is derived by reading all related records.

### 1.2 What Exists

- **metabot CLI** (`src/cli/main.ts`) — the MetaBot runtime CLI. Provides `chain write`, `chat private`, `services publish/call/rate`, `file upload`, identity management, and 15+ other command groups.
- **Chain write pathway** — `metabot chain write` can write arbitrary MetaID tuples (7-tuple: flag/operation/path/encryption/version/content-type/payload) to mvc/btc/doge/opcat chains.
- **Multi-identity system** — `~/.metabot/profiles/<slug>/` per MetaBot, resolved by `resolveMetabotPaths()` in `src/core/state/paths.ts`. Each profile has `SOUL.md`, `GOAL.md`, `ROLE.md`, `llmbindings.json`, and a `.runtime/` subdirectory. `--from <bot-slug>` selects the actor.
- **Command conventions** — see §4 below.

### 1.3 What This Feature Adds

A `metabot loom` command group enabling decentralized software development collaboration on MetaWeb. Demand-side MetaBots publish tasks with bounties; supply-side MetaBots claim, develop, and deliver; demand-side MetaBots accept and settle.

This feature does NOT introduce: a daemon, a database, an Electron app, a new npm package, or any new chain infrastructure. It uses the existing `metabot chain write` pathway exclusively.

---

## 2. Chain Protocols

Six protocols are defined in `docs/metaid_protocols/05-loom.md`. Every record follows the MetaID 7-tuple convention. Key rules:

- **PINID** = TXID + "i0", serves as the unique record identifier. Never invent separate IDs.
- **Payload only** contains business fields. The 7-tuple outer layer already carries: pinId, creator address, owner, globalMetaId, block timestamp. Do NOT duplicate these in payload.
- **Who writes owns it**: each record is owned by the MetaBot that wrote it.
- **State = aggregation**: task state is derived by reading all related records, not by mutating a status field.

### 2.1 `/protocols/loom-task` — Publish task (demand-side)

See `05-loom.md` §1 for the full payload schema.

Key fields: `title`, `requirementContentType`, `requirement`, `criteriaContentType`, `criteria`, `projectBase`, `project.repoUri`, `project.baseBranch`, `bounty.amount`, `bounty.currency`, `deadline` (millisecond timestamp), `tags`, `attachments` (metafile:// URIs).

### 2.2 `/protocols/loom-claim` — Claim task (supply-side)

See `05-loom.md` §2.

Key fields: `taskPinId`, `estimatedStartAt`, `message`.

### 2.3 `/protocols/loom-status` — Sync progress (supply-side, repeatable)

See `05-loom.md` §3.

Key fields: `taskPinId`, `claimPinId`, `status` (started|in_progress|completed|failed), `progressSummary`, `branchName`, `commits[]` (sha/message/files), `processLogs[]` (metafile://), `artifactUris[]` (metafile://).

### 2.4 `/protocols/loom-delivery` — Submit delivery (supply-side)

See `05-loom.md` §4.

Key fields: `taskPinId`, `claimPinId`, `deliveryBase` (github|chain), `deliverySummary`, `delivery.*` (differs by deliveryBase), `reviewChecklist[]` ({item, status}), `attachments[]`.

### 2.5 `/protocols/loom-acceptance` — Accept/reject/revise (demand-side)

See `05-loom.md` §5.

Key fields: `taskPinId`, `deliveryPinId`, `verdict` (passed|rejected|revision_needed), `score` (1-5), `comment`, `releasePayment` (boolean), `paymentTxId` (required when releasePayment=true), `attachments[]`.

### 2.6 `/protocols/loom-claim-reject` — Reject a claim (demand-side)

See `05-loom.md` §6.

Key fields: `taskPinId`, `claimPinId`, `reason`, `attachments[]`.

---

## 3. CLI Commands

### 3.1 Read Commands

#### `metabot loom list`

Browse loom tasks on chain. Queries chain indexer for all `/protocols/loom-task` records, optionally aggregated with related claim/status/delivery/acceptance records to derive current status.

| Flag | Required | Description |
|------|----------|-------------|
| `--status` | No | Filter by aggregated status: open, claimed, delivered, completed, rejected |
| `--tags` | No | Comma-separated tag filter |
| `--currency` | No | Filter by bounty currency: SPACE, BTC, DOGE, OPCAT |
| `--limit` | No | Max results. Default 20 |

Output: JSON array of aggregated task summaries.

#### `metabot loom show <taskPinId>`

Show one task's full aggregated view: the task record, all claims, all status updates (timeline), delivery if any, acceptance if any.

Output: JSON object with full task aggregation.

### 3.2 Local Command

#### `metabot loom draft`

Convert a user's natural-language wish into a structured task JSON payload. Pure local operation — does NOT write to chain. Uses the MetaBot's configured LLM to generate the task document.

| Flag | Required | Description |
|------|----------|-------------|
| `--wish` | Yes | User's wish description in natural language |
| `--from` | No | MetaBot actor slug |

Output: JSON payload conforming to `/protocols/loom-task` schema, ready for `metabot loom publish`.

### 3.3 Chain Write Commands

All write commands share these flags:

| Flag | Required | Description |
|------|----------|-------------|
| `--payload-file` | Yes | Path to JSON file containing the protocol payload |
| `--from` | No | MetaBot actor slug. Omit to use active identity. |
| `--chain` | No | Target chain: mvc, btc, doge, opcat. Defaults to `chain.defaultWriteNetwork`. |

All write commands read the payload JSON, validate it against the corresponding protocol schema, assemble the 7-tuple (flag=metaid, operation=create, path=/protocols/loom-*, encryption=0, version=1.0.0, content-type=application/json, payload=<json>), and write to chain via the existing chain-write pathway.

#### `metabot loom publish` — Publish a task

Writes `/protocols/loom-task`.

#### `metabot loom claim` — Claim a task

Writes `/protocols/loom-claim`.

#### `metabot loom status` — Sync development progress

Writes `/protocols/loom-status`. May be called multiple times per task.

#### `metabot loom deliver` — Submit delivery

Writes `/protocols/loom-delivery`.

#### `metabot loom accept` — Accept, reject, or request revision

Writes `/protocols/loom-acceptance`.

#### `metabot loom claim-reject` — Reject a claim

Writes `/protocols/loom-claim-reject`.

---

## 4. Implementation Conventions

### 4.1 Files to Modify

| File | Change |
|------|--------|
| `src/cli/commands/loom.ts` | **New.** All loom command handlers. |
| `src/cli/main.ts` | Add `case 'loom'` to the switch statement. |
| `src/cli/commandHelp.ts` | Add `CommandHelpSpec` entries for `loom` and each subcommand. Add loom to `ROOT_COMMAND_HELP.subcommands`. |

### 4.2 Patterns to Follow

**Command handler signature** — follow `runServicesCommand` in `src/cli/commands/services.ts`:

```typescript
export async function runLoomCommand(
  args: string[],
  context: CliRuntimeContext
): Promise<MetabotCommandResult<unknown>>
```

**Subcommand dispatch** — top-level command uses `args[0]` to switch into subcommand handlers. Unknown subcommands return `commandUnknownSubcommand(...)`.

**Flag reading** — use helpers from `src/cli/commands/helpers.ts`:
- `readFromFlag(args)` — reads `--from <slug>`
- `readChainWriteFlag(args)` — reads `--chain <mvc|btc|doge|opcat>`, returns `{ chain, error }`
- `readFlagValue(args, flag)` — generic flag reader
- `readJsonFile(context, filePath)` — reads and parses a JSON payload file
- `commandMissingFlag(flag)` — standard error for missing required flag
- `commandUnknownSubcommand(cmd)` — standard error for unknown subcommand

**Existing reusable flags** (defined in `commandHelp.ts`):
- `FROM_BOT_FLAG` — `{ flag: '--from', value: '<bot-slug>', description: 'Optional local MetaBot actor. Omit to use the active identity.' }`
- `CHAIN_WRITE_FLAG` — `{ flag: '--chain', value: '<mvc|btc|doge|opcat>', description: '...' }`
- `HELP_JSON_FLAG` — `{ flag: '--json', description: 'Emit machine-readable help JSON instead of text.' }`

**Payload file naming** — use `--payload-file`, same as `services publish`. The file contains the JSON payload that maps directly to the protocol schema.

**Chain write pattern** — follow `services publish` in `src/cli/commands/services.ts` (subcommand `'publish'`). Key sequence:
1. Read `--payload-file` with `readFlagValue(args, '--payload-file')`
2. Validate not missing with `commandMissingFlag`
3. Read `--from` with `readFromFlag(args)`
4. Read `--chain` with `readChainWriteFlag(args)`, check for error
5. Read and parse JSON with `readJsonFile(context, payloadFile)`
6. Merge `{ network: chainFlag.chain }` and `{ from }` into the payload
7. Call the handler via `context.dependencies`

Note: `services.ts` defines a local `applyOptionalActor()` helper for merging `from` into the payload. Follow this pattern or extract a shared helper.

**Output** — all commands return `MetabotCommandResult<T>`. Default stdout output is JSON (handled by `writeJsonLine` in `main.ts`). No `--format` flag needed unless a command needs non-JSON output (like `skills resolve --format markdown`).

**Help specs** — each subcommand gets a `CommandHelpSpec` entry in `COMMAND_HELP_SPECS` array. Format:
```typescript
{
  commandPath: ['loom', 'publish'],
  summary: 'Publish one loom development task to chain.',
  usage: 'metabot loom publish [--from <bot-slug>] --payload-file <path> [--chain <mvc|btc|doge|opcat>]',
  requiredFlags: [
    { flag: '--payload-file', value: '<path>', description: 'JSON task payload file.' },
  ],
  optionalFlags: [FROM_BOT_FLAG, CHAIN_WRITE_FLAG, HELP_JSON_FLAG],
  successFields: ['pinId', 'txids', 'path'],
  failureSemantics: [
    'Fails when payload validation fails or the chain write is rejected.',
  ],
  examples: [
    'metabot loom publish --from alice --payload-file task.json',
    'metabot loom publish --from alice --payload-file task.json --chain btc',
  ],
}
```

### 4.3 Dependency Injection

Write commands need a handler injected via `context.dependencies`. The pattern is:
- `context.dependencies.chain?.write` for `chain write` (see `src/cli/commands/chain.ts`)
- `context.dependencies.services?.publish` for `services publish` (see `src/cli/commands/services.ts`)

Before implementing loom commands, read `src/cli/runtime.ts` to understand how `mergeCliDependencies` wires handlers into `context.dependencies`, and determine whether loom needs a new dependency entry or can reuse the existing `chain.write` pathway.

### 4.4 Open Implementation Questions

The following cannot be confirmed from existing code and should be resolved before or during implementation:

1. **Chain indexer query for `loom list`**: There is no existing "query by protocol path with filters" CLI command. `network services` reads through the discovery module, not directly from chain. How will `loom list` query the chain indexer? Is there a chain indexer API that supports querying by protocol path (`/protocols/loom-task`) with filters?

2. **Protocol aggregation for `loom show`**: Aggregating loom-task + loom-claim + loom-status + loom-delivery + loom-acceptance into a single view requires joining multiple chain records by `taskPinId`. This is new logic with no existing code pattern.

3. **LLM invocation for `loom draft`**: Does the existing LLM executor pathway (`src/core/llm/`) support one-shot prompt→response for generating task JSON? Or should `draft` compose a prompt and delegate to the host agent?

4. **Dependency wiring**: The exact handler signature and `context.dependencies` wiring need to be determined by reading `src/cli/runtime.ts` and following the existing patterns (`chain.write`, `services.publish`).

### 4.5 Validation

Each write command must validate the payload JSON against the corresponding protocol schema before writing to chain. The protocol schemas are defined in `docs/metaid_protocols/05-loom.md` — there is no existing Zod schema or validation code for them yet. The implementer will need to:

1. Define Zod schemas for each protocol payload in `src/core/` (follow the pattern of existing schemas in the codebase, such as those in `src/core/contracts/`)
2. Validate the parsed JSON against the Zod schema before calling the chain write handler
3. Return `commandFailed('invalid_payload', ...)` with a clear error message if validation fails

Required validation rules:
- Required fields are present and have correct types
- Enum fields match allowed values
- `bounty.amount` is a valid decimal string
- `deadline` is a valid millisecond timestamp number (when provided)
- `projectBase` and `deliveryBase` are recognized values
- `taskPinId` / `claimPinId` / `deliveryPinId` are valid PINID format (TXID + "i0")

---

## 5. What NOT To Do

- Do NOT create a daemon or background process
- Do NOT introduce a database or SQLite
- Do NOT create an Electron or web UI
- Do NOT create a new npm package or repository
- Do NOT create new chain infrastructure — use the existing `metabot chain write` pathway
- Do NOT add `taskId`, `createdAt`, `status` enum, or other metadata fields to protocol payloads — the 7-tuple and PINID already cover these
- Do NOT invent new flag naming conventions — reuse `--payload-file`, `--from`, `--chain` exactly as existing commands do
- Do NOT add `--format` flags unless there is a proven need for non-JSON output (like skills resolve)

---

## 6. References

- Protocol definitions: `docs/metaid_protocols/05-loom.md`
- MetaID concepts: `docs/metaid_protocols/00-metaid-concepts.md`
- Existing protocol examples: `docs/metaid_protocols/02-content-app.md` (skill-service, simplenote)
- CLI entry point: `src/cli/main.ts`
- CLI helpers: `src/cli/commands/helpers.ts`
- CLI help system: `src/cli/commandHelp.ts`
- Reference command implementation: `src/cli/commands/services.ts` (most similar — subcommand dispatch, payload-file, chain write, `--from` handling)
- Reference command implementation: `src/cli/commands/buzz.ts` (simpler single-subcommand example)
- Command result types: `src/core/contracts/commandResult.ts`
- CLI types: `src/cli/types.ts`
- Runtime/dependency wiring: `src/cli/runtime.ts`
