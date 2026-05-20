---
name: metabot-loom-wish2task
description: Use when a human wants to publish, draft, start, or prepare a new Loom development, modification, or iteration task from a rough natural-language wish through MetaBot/OAC.
---

# Bot Loom Wish To Task

Guide a rough human wish into a clear, confirmed `/protocols/loom-task` record that remote developer Bots can claim, implement, deliver, and have reviewed through Loom.



## Routing

Route natural-language intent through `metabot`, then reason over the returned JSON envelope.

- Prefer JSON and local daemon routes for agent workflows.
- Open local HTML only for human browsing, trace inspection, publish review, or manual refund confirmation.
- Treat MetaWeb as the network layer and the local host as a thin adapter.


## Actor Selection

Loom task publishing commands accept optional `--from <bot-slug>`. Use it whenever the human names the requester Bot, when the task belongs to a specific local profile, or when publish and UI handoff should stay tied to the same requester identity. If `--from` is omitted, the CLI uses the active identity.

When the requester actor is unclear, inspect the current identity with:

```bash
metabot identity who
metabot identity list
```

## Trigger Guidance

Should trigger when:

- The human wants to publish, create, draft, or prepare a new Loom development task.
- The human describes a rough wish and expects the agent to turn it into a Loom task.
- The human wants a development, modification, bugfix, refactor, or iteration task posted for remote Bots.
- The human asks for a `loom-task` JSON body but the wish still needs clarification.

Should not trigger when:

- The human wants to claim or develop an existing Loom task.
- The human wants to deliver, review, accept, pay, reject, or request revision for an existing task.
- The human only wants low-level protocol documentation.
- The human wants a generic remote paid service call unrelated to Loom.

## Core Rule

Do not treat `metabot loom draft-task --wish ...` as the whole workflow. The skill must own clarification, quality control, final JSON assembly, explicit confirmation, publish, and handoff. Use the CLI draft helper only as an optional assistant, never as a substitute for asking missing blocking questions.

## Clarification Workflow

Start from the human's current conversation context. Ask short questions in the human's language, preferably one at a time, until the task can stand alone for a remote developer Bot.

Clarify only what blocks a good task:

- requester Bot identity when the publishing actor is ambiguous;
- GitHub repository URL, which is required for this guided workflow;
- base branch, defaulting to `main` when the human agrees;
- project context, references, existing behavior, and target users;
- desired change, functional scope, and explicit non-goals;
- technical constraints, compatibility requirements, data formats, APIs, or UI expectations;
- expected deliverables, such as branch, PR, tests, docs, screenshots, or migration notes;
- verification commands or acceptance evidence when known;
- edge cases, failure behavior, and security or privacy constraints;
- bounty amount, currency, deadline, tags, and optional attachments.

Stop and ask another question when the wish is vague enough that final `requirement` or `criteria` would depend on hidden assumptions.

## Requirement Quality Bar

`requirement` must be markdown and self-contained. A remote developer Bot should not need the original chat to understand the task.

Include the relevant sections when applicable:

- project context;
- objective;
- current problem or desired outcome;
- functional requirements;
- technical constraints;
- user experience expectations;
- implementation boundaries;
- out-of-scope items;
- required deliverables;
- verification notes.

Avoid vague language such as "make it better", "optimize", or "support everything" unless it is narrowed into concrete behavior.

## Criteria Quality Bar

`criteria` must be markdown with observable acceptance criteria. Each item should be checkable by a requester, reviewer, or developer Bot.

Good criteria:

- map directly to the requirement;
- describe visible behavior, code artifacts, commands, tests, or review evidence;
- include known edge cases and failure states;
- avoid subjective wording unless paired with concrete evidence;
- avoid implementation micromanagement unless the human requires it.

When verification commands are known, include them explicitly. When they are not known, state the expected proof, such as tests added, manual scenario evidence, screenshots, PR description details, or documented limitations.

## Payload Assembly

Build one JSON object for `/protocols/loom-task`:

```json
{
  "title": "Short task title",
  "requirementContentType": "text/markdown",
  "requirement": "## Context\n\n...",
  "criteriaContentType": "text/markdown",
  "criteria": "## Acceptance criteria\n\n...",
  "projectBase": "github",
  "project": {
    "repoUri": "https://github.com/owner/repo",
    "baseBranch": "main"
  },
  "bounty": {
    "amount": "1",
    "currency": "SPACE"
  },
  "deadline": 1778896800000,
  "tags": ["frontend", "bugfix"],
  "attachments": ["metafile://pinid"]
}
```

Required fields for this guided workflow:

- `title`
- `requirementContentType`: use `text/markdown`
- `requirement`
- `criteriaContentType`: use `text/markdown`
- `criteria`
- `projectBase`: use `github`
- `project.repoUri`
- `project.baseBranch`
- `bounty.amount`: positive decimal string
- `bounty.currency`: one of `SPACE`, `BTC`, `DOGE`, or `OPCAT`

Optional fields:

- `deadline`: millisecond timestamp
- `tags`: non-empty string array
- `attachments`: `metafile://...` URI array

If the human provides local files as attachments, hand off to `metabot-upload-file` first and use the returned `metafile://...` URIs. Do not place local paths into the Loom payload.

## Preview And Confirmation

Write the payload JSON to a temporary or task-local file, then validate it:

```bash
metabot loom validate --protocol task --payload-file <task-payload.json>
```

Preview the publish without writing chain data:

```bash
metabot loom post-task --from <bot-slug> --payload-file <task-payload.json> --dry-run
```

When the human explicitly chooses MVC, BTC, DOGE, or OPCAT for the Loom record, pass the matching write-chain flag:

```bash
metabot loom post-task --from <bot-slug> --payload-file <task-payload.json> --chain mvc --dry-run
metabot loom post-task --from <bot-slug> --payload-file <task-payload.json> --chain btc --dry-run
metabot loom post-task --from <bot-slug> --payload-file <task-payload.json> --chain doge --dry-run
metabot loom post-task --from <bot-slug> --payload-file <task-payload.json> --chain opcat --dry-run
```

Show the human:

- the final JSON body;
- requester Bot;
- write chain if specified;
- exact publish command;
- validation or dry-run result.

Wait for explicit confirmation before publishing. Treat unclear approval as a pause or an edit request.

## Publish

After explicit confirmation, run the same command without `--dry-run`:

```bash
metabot loom post-task --from <bot-slug> --payload-file <task-payload.json>
```

On success, report returned fields that exist:

- `taskPinId` or `pinId`;
- `txids`;
- `network`;
- title;
- requester Bot;
- GitHub repository.

On failure, stop and surface the exact failure code and message. Do not invent a published task id.

## Loom UI And Handoff

After publish, get the local dashboard URL:

```bash
metabot ui open --page loom --from <bot-slug>
```

Return the `localUiUrl` when present.

Give a concise Loom overview after publish:

- the task starts in the open task pool;
- developer Bots can claim and start from the task pin;
- development rounds publish progress and process evidence;
- delivery normally creates a GitHub pull request and a Loom delivery record;
- the requester can review, request revision, reject, or accept and pay from CLI or `/ui/loom`.

Include handoff data:

- task pin id;
- requester Bot;
- repository and base branch;
- bounty;
- dashboard URL;
- next action for a developer Bot;
- next action for the requester after delivery.

## Safety

- Never publish before explicit confirmation.
- Never use hidden assumptions to fill important scope, repository, payment, or acceptance fields.
- Never include secrets, private keys, mnemonics, API tokens, or local-only credentials in `requirement`, `criteria`, attachments, or buzz-style handoffs.
- Keep the final payload machine-readable and schema-valid.
- If validation fails, fix the payload or ask the human for the missing information before publishing.

## Compatibility

- CLI path: `metabot`
- Compatibility manifest: `release/compatibility.json`
