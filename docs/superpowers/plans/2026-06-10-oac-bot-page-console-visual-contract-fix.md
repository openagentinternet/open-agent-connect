# OAC Bot Page Console Visual Contract Fix

## Goal

Bring `/ui/bot` back in line with the confirmed Bot Page Console contract while preserving the existing local provider capabilities and real daemon data flow.

The work is a UI information-architecture correction only:

- keep the existing bot profile, runtime, skill, wallet, backup, delete, and session APIs;
- keep existing routes and legacy deep links available;
- keep `/browser` and `/ui/conversations` out of scope;
- default `/ui/bot` to Local Bots, the selected Bot hero, and the Public Identity tab only.

## Current Capability Inventory

`/ui/bot` already exposes these capabilities and they must remain reachable:

- Local Bot selector from `/api/bot/profiles`.
- Bot public identity editing through `PUT /api/bot/profiles/:slug` for name, avatar, and bio.
- Bot behavior editing through `PUT /api/bot/profiles/:slug` for role, soul, goal, primary provider, and fallback provider.
- Chat skill selection through `/api/services/skills?from=<slug>` and `PUT /api/bot/profiles/:slug` for `allowChatSkills`.
- Runtime/provider diagnostics through `/api/bot/runtimes`, runtime discovery, and runtime test handlers.
- Execution history through `/api/bot/sessions?slug=<slug>&limit=50`.
- Wallet actions through existing wallet balance and transfer handlers.
- Backup export through existing backup handlers.
- Delete Bot through the existing delete handler.
- Navigation to publish and manage services through existing `/ui/publish` and `/ui/services` routes.

## Mapping To V4 IA

| Existing capability | V4 location |
| --- | --- |
| Bot selector | Left `Local Bots` selector |
| Avatar, Bot name, public bio | `Public Identity` |
| Homepage renderer and upload entry | `Public Identity` |
| GlobalMetaID copy | Selected Bot hero |
| Bot URI copy | Selected Bot hero |
| Open Public Bot Page | Selected Bot hero |
| View Conversations | Selected Bot hero |
| Role, soul, goal | `Behavior` |
| Primary/fallback provider | `Behavior` |
| `allowChatSkills` | `Chat Skills` |
| Publish/manage service shortcuts | `Services` |
| Wallet | `Advanced` |
| Backup | `Advanced` |
| Runtime/provider diagnostics | `Advanced` |
| Execution history | `Advanced` |
| Delete Bot | `Advanced` |

## Remaining Gap List

- Remove Bot-list runtime diagnosis text such as `[LLM unavailable]`.
- Remove leftover default-dashboard CSS/markup affordances such as `bot-stats`.
- Keep Services as entry links only and ensure both links carry `from=<slug>`.
- Make the homepage upload placeholder use the confirmed copy and avoid MetaApp/PINID wording.
- Keep Advanced reachable but visually separate wallet, backup, runtime diagnostics, execution history, and delete from the default Public Identity first screen.
- Keep legacy `tab=info` and `tab=history` compatibility without exposing old primary tabs such as `Basic Info / Execution History / Settings`.
- Add or update targeted tests for the hard-no list and service link behavior.

## File-Level Plan

- `src/ui/pages/bot/app.ts`
  - Keep the current view model and API calls.
  - Remove Bot-list LLM-unavailable badges.
  - Preserve Public Identity, Behavior, Chat Skills, Services, and Advanced tab rendering.
  - Ensure Services renders only `Publish Service` and `Manage Services` links with `from=<slug>`.
  - Ensure non-active helper rerenders do not revive the old combined info surface.

- `src/ui/pages/bot/index.html`
  - Remove stale dashboard CSS.
  - Keep the V4 shell, left selector, hero, tabs, and hidden Advanced content.
  - Add an explicit execution-history label inside Advanced if needed for discoverability.

- `src/ui/i18n.ts`
  - Update OAC-owned copy for homepage upload placeholder and creation success wording.
  - Keep user-generated content, chain data, Bot names, bios, service descriptions, and conversation messages untranslated.

- `tests/ui/botPageScript.test.mjs`
  - Cover Public Identity default, hard-no strings, left selector purity, Services entry-only behavior, Advanced reachability, and exact upload placeholder copy.

- `tests/daemon/httpServer.test.mjs`
  - Cover route-rendered shell hard-no strings and Provider Console navigation.

## Reused APIs And Handlers

No backend API changes are planned. The UI will continue to use:

- `/api/bot/profiles`
- `/api/bot/profiles/:slug`
- `/api/services/skills?from=<slug>`
- `/api/bot/runtimes`
- `/api/bot/runtimes/discover`
- `/api/bot/runtimes/:runtimeId/test`
- `/api/bot/sessions?slug=<slug>&limit=50`
- existing wallet, backup, and delete handlers

## Explicitly Out Of Scope

- No `/browser` changes.
- No `/ui/conversations` rewrite or conversation merge logic.
- No service marketplace, service discovery, or owned-service list inside `/ui/bot`.
- No backend online-status query for the green live indicator.
- No route deletion and no old API deletion.
- No fake or fixture-only final acceptance.

## Test Plan

1. Add/update focused tests before implementation for the observed gaps.
2. Run `npm run build`.
3. Run targeted tests:
   - `node --test tests/ui/i18n.test.mjs`
   - `node --test tests/ui/botPageScript.test.mjs`
   - `node --test tests/daemon/httpServer.test.mjs`
4. Re-run the same targeted verification after each code batch that changes UI behavior.

## Real Daemon Browser Acceptance

Final acceptance must use the real local daemon data source, not fake fixtures:

1. Start or retarget the daemon from this worktree's compiled entrypoint.
2. Record `lsof -nP -iTCP:<port> -sTCP:LISTEN`.
3. Record `ps -p <pid> -o command=` and confirm it points to this worktree's `dist/cli/main.js`.
4. Fetch `/api/bot/profiles` and report the real `botCount` plus the first few Bot names.
5. Browser-smoke `/ui/bot` and verify:
   - the left Local Bots list shows real Bots and not `No Bots yet`;
   - default active tab is `Public Identity`;
   - hero shows GlobalMetaID and `metaid://<globalMetaId>`;
   - `Open Public Bot Page` and `View Conversations` are available;
   - `Behavior`, `Chat Skills`, `Services`, and `Advanced` tabs switch;
   - old capabilities are reachable in their mapped tabs;
   - hard-no strings and dashboard sections are absent from the default screen.

