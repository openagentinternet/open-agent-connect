# MetaBot Bot Homepage Guide Skill Design

Date: 2026-06-14
Status: approved design for a guide-only skill

## Purpose

`metabot-bot-homepage-guide` is a documentation-first skill for agents that help a
user create a static personal homepage for a MetaBot. The skill does not generate
the frontend, does not run a site builder, and does not introduce a new publishing
CLI. Its job is to constrain and guide another frontend-capable agent or skill so
the generated homepage follows the MetaID/OAC data, action, and publishing
contracts.

The intended workflow is:

1. A user asks an agent to create a homepage for a Bot.
2. The agent uses a frontend-capable skill or local LLM workflow to design and
   build the page.
3. `metabot-bot-homepage-guide` supplies the MetaBot homepage data contract,
   action rules, static export requirements, validation checklist, and MetaApp
   publish handoff.
4. The completed static site can be previewed and published with the existing
   OAC MetaApp CLI.

## Product Scope

The v1 skill covers a beautiful, shareable static Bot homepage with safe links and
fallback behavior. It is not an interactive wallet application.

In scope:

- Guide another agent to build a static homepage for a target Bot.
- Require hybrid data loading: local `data.json` snapshot first, online homepage
  API refresh second.
- Require all user-facing actions to come from the homepage API action manifest.
- Explain local OAC versus public fallback behavior.
- Explain how to publish the finished static homepage as a MetaApp with the
  existing OAC CLI.
- Provide a validation checklist for generated artifacts.

Out of scope for v1:

- Follow buttons.
- Guestbook or message-board writes.
- In-page wallet signing.
- In-page Buzz likes, comments, or replies.
- A new CLI for homepage generation or publishing.
- A new frontend design system.
- Any frontend-side protocol renderer registry.

## Skill Name And Location

The skill should live at:

```text
SKILLs/metabot-bot-homepage-guide/SKILL.md
```

Recommended skill metadata:

```yaml
name: metabot-bot-homepage-guide
description: Guide another agent or frontend skill to create a static Bot homepage from MetaID homepage data, use API-provided actions, and publish the finished site as a MetaApp through OAC.
```

## Required Inputs

The guide should ask for or infer:

- `globalMetaId`: required; identifies the Bot whose homepage data should be
  loaded.
- `botSlug`: optional; used when publishing as MetaApp with
  `metabot metaapp publish --from <bot-slug>`.
- Visual direction: optional; passed through to the frontend-capable skill. This
  guide should not prescribe the visual style beyond product and safety
  requirements.
- Existing MetaApp pin id: optional; used only when updating an already published
  homepage.

If `globalMetaId` is missing, the guide should stop and ask for it. If `botSlug`
is missing, the guide can still support static generation, but MetaApp publish
instructions must say that the caller should select the publishing Bot before
running `--from`.

## Homepage Data Contract

The frontend should load homepage v2 data from the MetaSo homepage API:

```text
https://so.metaid.io/api/bot-homepage/globalmetaid/<globalMetaId>?version=v2
```

If the API evolves to include query flags for actions or proofs, the guide should
prefer the documented production URL returned by the API owner. The frontend
agent must not scrape unrelated pages to construct homepage data.

The static project must include a generated snapshot:

```text
data.json
```

The page must use hybrid loading:

1. Load and render `data.json` first, so the page works as a static artifact.
2. Attempt to fetch the homepage API for the latest data.
3. If the API request succeeds, re-render from the fresh data.
4. If the API request fails, continue showing the local snapshot and expose a
   subtle stale/offline state.

The generated page must not require a dedicated backend. Remote API calls to the
homepage API and public fallback URLs are allowed.

## Rendering Guidance

The frontend-capable skill owns visual quality. This guide only constrains the
content model and interaction boundaries.

The homepage should render these data groups when present:

- Bot profile: name, avatar, summary/bio, display GlobalMetaId.
- Identity/proof details: verification state, proof pin, txid, protocol path, or
  warnings when supplied.
- Services: service name, summary, price, status, and API-provided action.
- Skills: display as capability or inventory content when supplied.
- Buzzes: recent content summaries, timestamps, and API-provided open actions.
- Warnings: low-visual-priority but inspectable.

The page may use any visual style appropriate to the Bot. It should not display
raw JSON as the primary experience unless the user explicitly requests a
developer/debug page.

## Action Manifest Contract

The homepage API is the canonical source for actions. The skill must instruct
frontend agents not to infer renderer URLs, service-market URLs, Buzz URLs, or
protocol-specific routes.

Supported v1 action kinds:

- `private-chat`
- `service-list`
- `service-call`
- `open-buzz`
- `copy-uri`

Recommended action shape:

```json
{
  "id": "open-buzz:<pinId>",
  "label": "Open Buzz",
  "kind": "open-buzz",
  "enabled": true,
  "resourceUri": "metaid-pin://<pinId>",
  "fallbackUrl": "https://show.now/buzz/<pinId>",
  "preferredLocalRenderer": "oac:buzz",
  "requires": [],
  "payload": {
    "pinId": "<pinId>"
  }
}
```

Field rules:

- `kind` determines how the frontend dispatches the action.
- `fallbackUrl` must come from the API action manifest.
- `resourceUri` identifies the underlying resource for OAC Browser or future
  protocol browsers.
- `preferredLocalRenderer` is a hint, not a hard-coded URL.
- `payload` contains the smallest execution payload, such as `pinId`,
  `servicePinId`, or `providerGlobalMetaId`.
- If an item has no API-provided action, the frontend may display the item but
  must not invent a click target.

The static homepage may cache actions inside `data.json`, but cached actions are
only an offline snapshot. When online, the page should prefer fresh API actions.

## Local OAC And Public Fallback Behavior

The generated page should treat OAC-local behavior and public fallback behavior
as two separate layers.

When running in an OAC Browser or another environment that provides a local
resolver, actions may be handled locally:

- `private-chat` can be routed through the Browser trusted action boundary.
- `service-call` can be routed through the Browser trusted action boundary.
- `open-buzz` can be opened in the local OAC Buzz renderer when available.
- `copy-uri` can copy the API-provided URI.

When no local OAC capability is available, the page should use the API-provided
`fallbackUrl` for open actions. It must not expose a localhost daemon URL as a
public fallback link, and it must not assume that the visitor has OAC installed.

The frontend should degrade gracefully:

- Disabled actions remain visible only if the API marks them disabled and the UI
  can explain the disabled state succinctly.
- Missing fallback URLs should suppress the action button instead of guessing.
- Action failures should not break the rest of the page.

## Renderer Registry Boundary

The v1 renderer/action registry belongs in the MetaSo homepage API service-side
configuration. This allows renderer URLs and public fallbacks to be updated
without requiring old skills or old generated pages to be regenerated.

The generated homepage and this skill must not maintain their own protocol
renderer registry. A future version may move registry declarations on-chain or
into a MetaApp-based renderer manifest, but that is not part of v1.

## Static Project Requirements

The finished homepage project should be a browser-runnable static project. It
must contain one of these entry layouts:

```text
index.html
dist/index.html
build/index.html
out/index.html
public/index.html
```

The project should include:

- `index.html` or a known build output containing `index.html`.
- `data.json` with the generated homepage snapshot.
- Any local assets needed by the page.
- Optional `.metaapp.json` for MetaApp metadata, if the publishing workflow needs
  title, app name, intro, tags, icon, or index overrides.

The static site should avoid absolute local filesystem paths and should avoid
depending on a local development server for normal browsing.

## Publish As MetaApp

The guide should hand off publishing to the existing OAC MetaApp CLI.

Preview before publishing:

```bash
$HOME/.metabot/bin/metabot metaapp preview --project-dir <homepage-dir>
```

Publish after preview is confirmed:

```bash
$HOME/.metabot/bin/metabot metaapp publish --from <bot-slug> --project-dir <homepage-dir> --confirm
```

Update an existing MetaApp homepage:

```bash
$HOME/.metabot/bin/metabot metaapp update --target-pin-id <pinid> --from <bot-slug> --project-dir <homepage-dir> --confirm
```

The MetaApp publish flow packages the browser-runnable homepage artifact as a ZIP
and writes a `/protocols/metaapp` record that points to the uploaded ZIP
metafile. The guide should tell agents not to invent a separate hosting URL when
the user wants an on-chain MetaApp publication.

After publish or update succeeds, the agent must report returned values when
present:

- `pinId`
- `firstPinId`
- `metawebUrl`
- `localUiUrl`

## Validation Checklist

Before handing the static homepage back to the user, the assisting agent should
verify:

- The project has a browser-runnable `index.html`.
- The project has a `data.json` homepage snapshot.
- The page renders from `data.json` without a dedicated backend.
- The page attempts online refresh from the homepage v2 API.
- API failure keeps the snapshot visible.
- Action buttons are created only from API-provided actions.
- No renderer URL is hard-coded by the frontend unless it came from the action
  manifest or local static assets.
- The page does not hard-code show.now, service-market URLs, or Buzz detail URLs
  outside API-provided `fallbackUrl` values.
- The page does not expose localhost daemon URLs as public links.
- The page does not attempt v1-out-of-scope features such as Follow, guestbook
  writes, wallet signing, or in-page Buzz comments.
- The project can be previewed with `metabot metaapp preview --project-dir`.
- If published, the agent reports the returned MetaApp `pinId` and URL fields.

## Implementation Notes

The initial implementation should add only the guide skill and any small examples
that are needed to make the instructions concrete. It should not modify OAC
Browser runtime behavior, MetaApp publish behavior, or the MetaSo homepage API in
this repository.

If future work adds `open-buzz` handling to OAC Browser, that should be a
separate implementation plan because it changes runtime action support rather
than the guide skill itself.
