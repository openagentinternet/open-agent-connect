# Bot Browser Guidance And Handoff Design

Date: 2026-06-21
Status: approved product direction, ready for implementation planning

## Purpose

Open Agent Connect already ships a working Browser entrypoint:

- `metabot browser open`
- `metabot browser open --uri <resource-uri>`
- local Browser routes under `/browser`

The missing piece is not Browser capability. The missing piece is product
guidance. OAC onboarding, host install docs, skill handoff copy, and some local
UI actions still teach the older path first:

- identity
- online Bots
- online Bot services
- Bot Hub
- local `/ui/*` pages

That older path must remain. This design adds Browser as a first-class peer
entrypoint without replacing those existing paths.

## Problem Statement

The current OAC experience has three gaps:

1. A user can install OAC successfully and never learn that a Browser exists.
2. A user can discover an online Bot or publish a MetaApp, but the follow-up
   guidance does not consistently suggest opening the result in Browser.
3. Natural-language requests such as `打开 Bot 浏览器`, `打开 Agent 浏览器`,
   `open this Bot page`, or `open this MetaApp in browser` do not have an
   explicit dedicated skill contract, even though the CLI capability already
   exists.

## Goals

- Make Browser visible in onboarding and handoff copy as a first-class OAC
  surface.
- Keep Browser at the same product level as Bot Hub and existing local `/ui`
  pages after install.
- Add one dedicated Browser skill that routes natural-language Browser intents
  onto the existing CLI capability.
- Add Browser-focused follow-up prompts to Bot discovery, Bot creation, Bot
  homepage, and MetaApp publish flows.
- Add one small local UI reinforcement so published MetaApps can be opened in
  Browser from the local gallery.

## Non-Goals

- Do not redesign the Browser runtime, renderer stack, or Browser page chrome.
- Do not replace Bot Hub as the directory-oriented browse surface.
- Do not move Bot management, trace management, wallet-sensitive actions, or
  other admin flows out of existing local `/ui/*` pages.
- Do not make Browser the only or default next step after install.
- Do not fork or rebrand the underlying `@openagentinternet/agent-browser-ui`
  package in this change.
- Do not add search, indexing, or new network read models.

## Product Positioning

Browser is a peer surface, not a takeover surface.

After this change, the first-run OAC mental model should be:

- OAC can create or use a Bot identity.
- OAC can discover online Bots and online Bot services.
- OAC can open richer local OAC pages such as Bot Hub and Bot management.
- OAC can open Agent Internet resources in Browser, including Bot pages and
  MetaApps.

The install success handoff must continue to mention the existing core actions.
Browser gets added as an additional first-class next action, not as the only
featured path.

## Naming

Use these names consistently:

- **Agent Internet Browser** as the formal product/surface name.
- **Bot Browser** as a compact or conversational alias.

Allowed user-intent equivalents:

- `打开 Bot 浏览器`
- `打开 Agent 浏览器`
- `open Bot Browser`
- `open Agent Internet Browser`

Do not introduce a new public product name for this task.

## Resource Model

This change should standardize which kinds of follow-up actions belong in
Browser.

### Browser-first resource types

- A Bot public page or homepage:
  - `metaid://<globalMetaId>`
- A published MetaApp:
  - `metaapp://<pinId>`
- A MetaFile resource when explicitly requested:
  - `metafile://<pinId>`

### Existing local UI first

- Bot management and profile editing:
  - `/ui/bot`
- service directory browsing and rich click-through:
  - `/ui/hub`
- trace inspection:
  - `/ui/trace`
- local MetaApp gallery management:
  - `/ui/metaapps`

### Rule

If the user is asking to open a public network resource, prefer Browser.
If the user is asking to manage local runtime state, prefer existing `/ui/*`
pages.

## Dedicated Skill

Add a new shared skill:

- `metabot-browser-open`

### Purpose

Map natural-language Browser intents to the existing Browser CLI and deep-link
model.

### In scope

- Open Browser with no URI:
  - `metabot browser open`
- Open Browser with a Bot URI:
  - `metabot browser open --uri metaid://<globalMetaId>`
- Open Browser with a MetaApp URI:
  - `metabot browser open --uri metaapp://<pinId>`
- Open Browser with a MetaFile URI:
  - `metabot browser open --uri metafile://<pinId>`

### Intent examples the skill should cover

- Open Bot Browser.
- Open Agent Browser.
- Open Agent Internet Browser.
- Open my Bot page.
- Open this Bot page in Browser.
- Open this MetaApp in Browser.
- Visit this Bot homepage.

### Out of scope

- No Bot or MetaApp search.
- No network list fetching on its own.
- No Bot identity creation or switching.
- No service ordering or trace follow-up.

### Packaging impact

The new skill must be treated like the other shared `metabot-*` skills:

- included in `package.json` published files
- included in skillpack generation
- available in shared and host-specific skillpacks

Add the minimum required base registry entry so the skill contract resolver can
advertise this Browser skill through the existing `skills resolve` path.

## Onboarding And Install Handoff

The install and host wrapper guides must retain the old next actions and add
Browser beside them.

### Required handoff shape after successful install

The success message should continue to include natural-language next actions for:

- confirm or create Bot identity
- view online Bots
- discover available Bot services
- open Bot Hub or local management surfaces

It should now also include at least one Browser next action:

- open Agent Internet Browser
- open my Bot page in Browser

### Constraint

Do not rewrite the install flow so Browser becomes the only recommended first
action. Browser must appear as one more peer action in the same next-step group.

### Files affected

- `docs/install/open-agent-connect.md`
- `docs/hosts/codex-agent-install.md`
- `docs/hosts/codex.md`
- `docs/hosts/claude-code.md`
- `docs/hosts/openclaw.md`
- generated skillpack host README copy if it embeds first-command guidance

## Skill And Handoff Surfaces

This task is mainly about the places where OAC tells the user what to do next.

### `metabot-help`

Add Browser to the example bank and capability framing.

New example intents should include:

- Open Agent Internet Browser.
- Open my Bot page.
- Open a published MetaApp in Browser.

### `metabot-identity-manage`

After a Bot is created or confirmed, add Browser follow-ups such as:

- open the Bot management link
- open my Bot page in Browser
- show online Bots
- show available Bot services

The Bot management and identity prompts stay. Browser is additive.

### `metabot-network-manage`

After a Bot list, the skill should continue to suggest:

- view online Bot services
- message the first online Bot

When the list contains one or more Bots, it should also suggest at least one
Browser follow-up such as:

- open the first Bot's page in Browser
- open the selected Bot's homepage in Browser

After a services list, when the selected or displayed provider Bot identity is
known, the skill should suggest:

- open the provider Bot page in Browser

Bot Hub guidance remains valid and must stay.

### `metabot-call-remote-service`

When a service selection or service result is tied to a provider Bot identity,
the handoff should include one Browser follow-up that opens that provider Bot
page. This is secondary guidance only. Trace UI guidance remains unchanged.

### `metabot-metaapp-publish`

After a successful MetaApp publish, update, share, or view workflow, the skill
should suggest opening the published MetaApp in Browser using the MetaApp pin.

The result shape should remain grounded in the existing `pinId`, `metawebUrl`,
and `localUiUrl` outputs. This task only adds Browser follow-up guidance.

### `metabot-homepage-guide`

When the workflow produces or references a Bot homepage MetaApp, the handoff
should mention opening that homepage resource in Browser.

## Local UI Reinforcement

This change should make one small local UI improvement where Browser is the
obvious missing action.

### MetaApps gallery

The local `/ui/metaapps` detail panel should expose an explicit Browser-facing
open action for the selected record.

Chosen behavior:

- keep existing local detail and download actions
- add an explicit `Open in Browser` action for the selected MetaApp resource

The important part is that the gallery should no longer force the user to infer
that Browser exists.

### Bot page and settings page

The current Bot page and settings surfaces already expose Browser entry points.
This task does not require a major redesign there. Only minimal wording cleanup
is acceptable if needed for consistency.

## Copy Rules

The new user-facing copy must follow these rules:

- Keep the user's language.
- Use natural-language prompts, not raw CLI commands, in normal handoff copy.
- Preserve the existing next actions instead of replacing them.
- Present Browser as a peer option alongside Bot Hub and other local UI pages.
- When the target is a public Bot page or published MetaApp, name Browser
  explicitly instead of assuming the user will discover it.

Do not write copy that implies:

- Browser replaces Bot Hub
- Browser replaces Bot management pages
- install success is incomplete until Browser is opened

## Likely File Touch Set

This design expects changes in these clusters:

### New shared skill

- `SKILLs/metabot-browser-open/SKILL.md`

### Existing shared skill guidance

- `SKILLs/metabot-help/SKILL.md`
- `SKILLs/metabot-identity-manage/SKILL.md`
- `SKILLs/metabot-network-manage/SKILL.md`
- `SKILLs/metabot-call-remote-service/SKILL.md`
- `SKILLs/metabot-metaapp-publish/SKILL.md`
- `SKILLs/metabot-homepage-guide/SKILL.md`

### Packaging and skillpack generation

- `package.json`
- `scripts/build-metabot-skillpacks.mjs`
- `src/core/skills/baseSkillRegistry.ts`

### Install and host docs

- `docs/install/open-agent-connect.md`
- `docs/hosts/codex-agent-install.md`
- `docs/hosts/codex.md`
- `docs/hosts/claude-code.md`
- `docs/hosts/openclaw.md`

### Small local UI reinforcement

- `src/ui/pages/metaapps/app.ts`
- `tests/daemon/httpServer.test.mjs` or the most direct MetaApps-page coverage
- any small i18n updates only if the UI change introduces new visible text

## Verification Strategy

This is a docs/skills/copy-heavy change with one small UI adjustment.
Use a focused verification set:

- `npm run build`
- `npm run build:skillpacks`
- `node --test tests/skillpacks/buildSkillpacks.test.mjs`

If the MetaApps page action text or behavior changes, also run the smallest
relevant local UI test coverage for that page.

Do not require a full `npm test` unless implementation expands into shared
runtime behavior beyond the documented scope above.

## Acceptance Criteria

This design is complete when all of the following are true:

- a dedicated `metabot-browser-open` skill exists and is packaged into
  generated skillpacks
- install success guidance still mentions the old core next actions and now
  also mentions Browser as a peer option
- help, identity, network, and MetaApp-related skills all contain Browser-aware
  follow-up prompts where the target resource is a Bot page or MetaApp
- local MetaApps gallery exposes a clear Browser-facing action
- no onboarding or handoff copy implies that Browser replaces Bot Hub or
  existing local `/ui` management surfaces

## Out-Of-Scope Follow-Up Work

These may be reasonable later, but they are not part of this task:

- making Browser the default first-run landing page
- adding Browser-specific search or recommendations
- adding a Bot picker inside Browser open flows
- changing Browser renderer behavior or Browser page chrome
- adding richer Browser actions to every local UI page
