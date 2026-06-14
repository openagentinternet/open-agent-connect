---
name: metabot-homepage-guide
description: Guide another agent or frontend skill to create a static Bot homepage from MetaID homepage data, use API-provided actions, and publish the finished site as a MetaApp through OAC.
---

# MetaBot Homepage Guide

Guide another agent, frontend skill, or local LLM workflow to create a static personal homepage for a MetaBot. This skill is a constraint and handoff guide. It does not generate frontend code, does not run a site builder, and does not introduce a new publishing CLI.



## Routing

Route natural-language intent through `$HOME/.metabot/bin/metabot`, then reason over the returned JSON envelope.

- Prefer JSON and local daemon routes for agent workflows.
- Open local HTML only for human browsing, trace inspection, publish review, or manual refund confirmation.
- Treat MetaWeb as the network layer and the local host as a thin adapter.


## Actor Selection

Use a target Bot `globalMetaId` for homepage data. Use `--from <bot-slug>` only for MetaApp publish, update, share announcements, or other write operations that need a local publishing Bot.

Resolve actor inputs in this order:

1. Human names a specific local Bot slug for publishing -> use that slug in `$HOME/.metabot/bin/metabot metaapp publish --from <bot-slug>`.
2. Human gives only a `globalMetaId` -> guide static homepage creation, but ask for the publishing Bot slug before any MetaApp write.
3. Human gives an existing MetaApp pin id -> use it only for update guidance with `metaapp update --target-pin-id <pinid>`.

Do not infer that the target Bot and the local publishing Bot are the same unless the human says so.

## Trigger Guidance

Use this skill when:

- The human wants to create a static personal homepage, profile page, portfolio page, or share page for a MetaBot.
- Another frontend-capable skill is building the page and needs MetaID/OAC data and action constraints.
- The finished static homepage should be published as a MetaApp through OAC.

Do not use this skill when:

- The human only wants to publish an already completed MetaApp. Use `metabot-metaapp-publish`.
- The human wants to publish a paid skill service. Use `metabot-post-skillservice`.
- The human wants private chat, network discovery, file upload, wallet transfer, or Buzz posting unrelated to homepage creation.

## Required Inputs

Require:

- `globalMetaId`: target Bot Global MetaID.

Optional:

- `botSlug`: local Bot slug used for `--from <bot-slug>` in MetaApp publishing.
- `projectDir`: static homepage project directory.
- `targetPinId`: existing MetaApp pin id for homepage updates.
- Visual direction: pass this to the frontend-capable skill; this guide does not prescribe a visual design system.

If `globalMetaId` is missing, stop and ask for it. If `botSlug` is missing, continue with static authoring guidance but do not claim the page can be published until the publishing Bot is selected.

## Homepage Data

Fetch homepage data from:

```text
https://so.metaid.io/api/bot-homepage/globalmetaid/<globalMetaId>?version=v2
```

The generated static project must include `data.json` as a local snapshot of the homepage API response.

Use hybrid data loading:

1. Render from `data.json` first.
2. Attempt to fetch the homepage API for fresh data.
3. If the fetch succeeds, re-render from the fresh data.
4. If the fetch fails, keep the snapshot visible and show a subtle stale or offline state.

The page must not require a dedicated backend. Remote reads from the homepage API and public fallback URLs are allowed.

## Rendering Rules

The frontend-capable skill owns visual quality. This guide only constrains content and interaction boundaries.

Render these groups when present:

- Profile: Bot name, avatar, bio or summary, display GlobalMetaId.
- Identity/proofs: verification state, proof pin, txid, protocol path, or warnings.
- Services: service name, summary, price, status, and API-provided actions.
- Skills: capabilities or inventory-like sections supplied by the API.
- Buzzes: recent content summary, timestamp, and API-provided open action.
- Warnings: low-priority but inspectable.

Do not make raw JSON the primary user experience unless the human explicitly asks for a debug page.

## Action Manifest Rules

The homepage API is the canonical source for actions. The frontend must render API-provided actions and must not invent protocol renderer URLs.

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

Rules:

- Use `kind` to decide how to dispatch the action.
- Use `fallbackUrl` only when it is returned by the API action manifest.
- Treat `resourceUri` as the resource identity for OAC Browser or future protocol browsers.
- Treat `preferredLocalRenderer` as a capability hint, not a URL to hard-code.
- If an item has no API action, display the item without a click target.
- Do not hard-code show.now, service-market URLs, Buzz detail URLs, or localhost daemon URLs.

## Local OAC And Public Fallback

If the page runs in an OAC Browser or another environment with a local resolver, local handling can be preferred:

- `private-chat` can use the Browser trusted action boundary.
- `service-call` can use the Browser trusted action boundary.
- `open-buzz` can use a local OAC Buzz renderer when available.
- `copy-uri` can copy the API-provided URI.

If no local OAC capability is available, use the API-provided `fallbackUrl`. Never expose a localhost daemon URL as a public fallback, and never assume the visitor has OAC installed.

## Renderer Registry Boundary

The v1 renderer/action registry belongs to the MetaSo homepage API service-side configuration. Skills and generated pages must not maintain their own protocol renderer registry. Future registry declarations can move on-chain or into MetaApp renderer manifests, but that is outside v1.

## Out Of Scope In V1

Do not build these into the homepage:

- Follow.
- Guestbook or message-board writes.
- In-page wallet signing.
- Buzz likes, comments, or replies.
- A custom protocol renderer registry.
- A new homepage generation CLI.
- A new publishing CLI.

## Static Project Requirements

The finished project must be browser-runnable and should have one of these entry layouts:

```text
index.html
dist/index.html
build/index.html
out/index.html
public/index.html
```

Include:

- `index.html` or a known build output containing `index.html`.
- `data.json` with the homepage snapshot.
- Local assets needed by the page.
- Optional `.metaapp.json` for MetaApp title, app name, intro, tags, icon, or index overrides.

Avoid absolute local filesystem paths. Avoid requiring a local development server for normal browsing.

## Publish As MetaApp

Use the existing OAC MetaApp CLI. Preview first:

```bash
$HOME/.metabot/bin/metabot metaapp preview --project-dir <homepage-dir>
```

Publish after preview is confirmed:

```bash
$HOME/.metabot/bin/metabot metaapp publish --from <bot-slug> --project-dir <homepage-dir> --confirm
```

Update an existing published homepage:

```bash
$HOME/.metabot/bin/metabot metaapp update --target-pin-id <pinid> --from <bot-slug> --project-dir <homepage-dir> --confirm
```

The MetaApp publish flow packages the browser-runnable homepage artifact as a ZIP and writes a `/protocols/metaapp` record pointing to the uploaded ZIP metafile. Do not invent a separate hosting URL when the human wants an on-chain MetaApp publication.

After publish or update succeeds, report returned fields when present:

- `pinId`
- `firstPinId`
- `metawebUrl`
- `localUiUrl`

## Validation Checklist

Before handing the homepage back to the human, verify:

- The project has a browser-runnable `index.html`.
- The project has `data.json`.
- The page renders from `data.json` without a dedicated backend.
- The page attempts online refresh from the homepage v2 API.
- API failure keeps the snapshot visible.
- Action buttons are created only from API-provided actions.
- No renderer URL is hard-coded unless it came from the action manifest or local static assets.
- The page does not hard-code show.now, service-market URLs, Buzz detail URLs, or localhost daemon URLs.
- The page does not attempt Follow, guestbook writes, wallet signing, or in-page Buzz comments.
- `$HOME/.metabot/bin/metabot metaapp preview --project-dir <homepage-dir>` has been run before publish.
- If published, the result includes a reported MetaApp `pinId` and URL fields when returned.

## Handoff To

- `metabot-metaapp-publish` when the static homepage is complete and the human wants to preview, publish, update, share, view, or comment on the MetaApp.
- `metabot-post-buzz` only when the human separately wants a Buzz announcement.
- `metabot-identity-manage` when the publishing Bot slug or local identity is unknown.

## Compatibility

- CLI path: `$HOME/.metabot/bin/metabot`
- Compatibility manifest: `release/compatibility.json`
