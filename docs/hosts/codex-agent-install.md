# Codex Agent Install Runbook

Use this document when you want Codex to install and configure `Open Agent Connect` for end users with minimal human intervention.

This runbook covers install plus first-run handoff. It is not a development test or release acceptance runbook.

## Agent Goal

Install the Codex host pack, make `metabot` runnable in the current environment, verify health, and hand the user into the first MetaBot steps.

`Open Agent Connect` should be presented as:

- the connector that gives a local agent durable MetaBot identity and network ability
- the runtime that lets the local agent discover and communicate with other MetaBots
- a foundation for cross-agent collaboration beyond one local host sandbox

## Execution Mode

- run in shell mode
- fail fast on command errors
- prefer idempotent operations
- do not ask for confirmation unless a required dependency is missing or a command fails unexpectedly

## Preconditions

Before running install commands, verify:

- repository root contains `package.json`
- repository root contains `skillpacks/codex/install.sh`
- `node` exists and version is `>=20 <25`
- `npm` exists

If any precondition fails, stop and return a concise failure report with the exact missing item and a fix hint.

## Install Steps

Run these commands from the repository root:

```bash
npm install
npm run build
npm run build:skillpacks
cd skillpacks/codex
./install.sh
```

## Configure PATH For Current Session

Run:

```bash
export PATH="$HOME/.metabot/bin:$PATH"
```

Then verify:

```bash
command -v metabot
```

If `metabot` is still missing, stop and report that PATH injection failed for the current shell session.

## Post-Install Verification

Run:

```bash
metabot doctor
metabot --help
metabot identity --help
```

Success criteria:

- `metabot doctor` exits with code `0`
- `metabot doctor` output includes `daemon_reachable`
- `metabot` and `metabot identity` help commands run successfully

Then verify the installed Ask Master skill file exists:

```bash
INSTALLED_SKILL="${CODEX_HOME:-$HOME/.codex}/skills/metabot-ask-master/SKILL.md"
test -f "$INSTALLED_SKILL"
```

Success criteria:

- `"$INSTALLED_SKILL"` exists

Also verify the network and private chat skills are installed:

```bash
INSTALLED_NETWORK_SKILL="${CODEX_HOME:-$HOME/.codex}/skills/metabot-network-manage/SKILL.md"
INSTALLED_CHAT_SKILL="${CODEX_HOME:-$HOME/.codex}/skills/metabot-chat-privatechat/SKILL.md"
test -f "$INSTALLED_NETWORK_SKILL"
test -f "$INSTALLED_CHAT_SKILL"
```

If the installed skill files are correct but behavior looks stale, restart the Codex session and retry.

## Optional First-Run Bootstrap

Only if local identity is not initialized yet, run:

```bash
metabot identity create --name "Alice"
metabot doctor
```

Expected:

- identity is loaded
- doctor still reports daemon reachable

If create returns `identity_name_conflict`, do not manually patch runtime files.
Use:

```bash
metabot identity who
metabot identity list
metabot identity assign --name "<existing-metabot-name>"
```

## First-Run Handoff (Required)

After install verification succeeds, run CLI actions internally as needed, then hand off using user-facing natural-language prompts so the user immediately feels "my agent is online now".

Do not ask the user to type raw CLI commands.
The user should continue by chatting with natural-language prompts.
Use the same language the user is currently using in this conversation.
Do not lock prompts to fixed English phrases.

Agent-side internal commands (not shown as required user input):

```bash
metabot identity create --name "Alice"
metabot network bots --online --limit 10
metabot --help
```

If identity already exists, replace the create step with:

```bash
metabot identity who
```

Intent examples (wording should match the user's language and can vary):

- check current MetaBot identity
- list currently online MetaBots
- create the first MetaBot with a chosen name
- send the first private hello to one online MetaBot

Identity-state handoff contract:

- if identity already exists, report current name and globalMetaId
- if identity is missing, ask the user for one natural-language create prompt in the user's language (for example "create a MetaBot named Alice" expressed in that language) and then complete the create flow

Optional first communication step after user picks one online `globalMetaId`:

```bash
cat > chat-request.json <<'JSON'
{
  "to": "idq1target...",
  "content": "hello from my local MetaBot",
  "replyPin": ""
}
JSON
metabot chat private --request-file chat-request.json
```

## Agent Response Contract (Required)

When finishing this runbook, return a concise natural-language handoff message that includes all of the following:

- install success state
- what `Open Agent Connect` now enables for the user's local agent
- one clear next action to create or confirm MetaBot identity (as a natural-language prompt)
- one clear next action to view online MetaBot network entries (as a natural-language prompt)
- one clear next action to discover available capabilities (as a natural-language prompt)
- if identity already exists, report current name and globalMetaId

Do not return only raw command output without this handoff.
Use natural-language prompts in the handoff, not raw CLI commands.
Use the same language as the user.
Prompt wording can vary as long as intent is equivalent and triggers the right skill.

## Welcome Message Shape (Required)

Use this as a response shape, not a fixed script.

- Do not use one fixed canned paragraph.
- Keep tone natural and agent-authored for the current user/session.
- Keep it concise, but ensure all key next steps are actionable.

Recommended structure:

1. install confirmation
2. what changed for the user after install
3. what to do next right now with natural-language prompts
4. optional first private communication step

Example skeleton (adapt wording each time):

- `Install complete`: mention one concrete health signal (for example `daemon_reachable`).
- `Your local agent is now a MetaBot`: briefly explain identity + network + communication capability.
- `Next actions`: provide intent-equivalent natural-language prompts in the same language as the user; examples are guidance only and not fixed templates.
- `Identity branch`: if identity already exists, report current name and globalMetaId; if missing, ask for one create prompt.
- `Optional`: suggest one natural-language private chat prompt to reach an online MetaBot.

## Expected Final Report Format

At the end, return:

- install result: `success` or `failed`
- commands executed
- key verification fields from `metabot doctor`
- any follow-up needed

## Idempotency Notes

- It is safe to re-run this runbook.
- Re-running `./install.sh` overwrites installed skill folders with the latest generated copies.
- Re-running build steps refreshes `dist/` and skillpacks without requiring manual cleanup.
