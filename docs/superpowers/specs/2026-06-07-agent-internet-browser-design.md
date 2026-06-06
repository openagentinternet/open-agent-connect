# Agent Internet Browser Design

Date: 2026-06-07
Status: SDD for implementation planning

## Context For The Implementer

This document defines the first local `/ui/browser` product surface for Open Agent Connect.
It is written for a future AI development session that does not have the conversation history
that produced it.

Primary project:

- Open Agent Connect implementation workspace: `<repo-root>`
- Project instructions: `<repo-root>/AGENTS.md`
- All documentation, SKILL documents, and code comments must be written in English.
- The UI must follow the existing local `/ui/*` framework:
  - page builder in `src/ui/pages/<page>/app.ts`
  - page template in `src/ui/pages/<page>/index.html`
  - registration in `src/daemon/routes/ui.ts`
  - page type in `src/daemon/routes/types.ts`
- The first implementation should be local-daemon backed and should not introduce hosted
  infrastructure.

Existing related surfaces:

- `/ui/hub`: service directory
- `/ui/bot`: local Bot identity and runtime setup
- `/ui/metaapps`: local MetaApp gallery
- bundled MetaApps under `/ui/buzz` and `/ui/chat`
- MetaApp APIs under `/api/metaapp/*` and `/api/metaapps`

## Product Positioning

Use **Agent Internet Browser** as the product/page-level name.

Use **Bot Browser** as a compact chrome/window label where a shorter name is useful.

Do not use "MetaWeb Browser" as the main UI title. MetaWeb is the underlying network and
proof/source layer. New users should first understand the product behavior:

> Type a `metaid://...` or `metaapp://...` URI and visit an Agent Internet resource.

## Goal

Create a local browser-like page that lets a user visit Agent Internet resources by entering
complete OAC URI strings:

- `metaid://<globalMetaId>` resolves to a Bot Page.
- `metaapp://<pinId>` resolves to a MetaApp resource.

The first-stage mental model is:

> My local Agent comes online as a Bot, and that Bot has a homepage.

Therefore the default first screen is a `metaid://<globalMetaId>` Bot Page, not a MetaApp.
MetaApps are a second resource type supported by the browser, not the first-screen hero.

## Non-Goals

The first version must not become a full blockchain explorer, hosted browser, or arbitrary
web sandbox platform.

Out of scope for the first implementation:

- remote multi-user hosting;
- a general public search engine;
- mutation of MetaApp content;
- chain writes from arbitrary rendered content;
- wallet payments directly controlled by iframe content;
- a full browser history database with sync;
- automatic installation of remote MetaApps;
- a general-purpose replacement for Chrome, Safari, or Electron WebView.

## Design Principle

Default experience:

> It is a browser first. It becomes an on-chain inspector only on demand.

This drives the UI:

- The default view has only three primary areas:
  1. top browser bar;
  2. main content render area;
  3. minimal status strip.
- Bookmarks, recent Bots, and history are hidden by default and open from a drawer button.
- Identity, chain proof, and source inspection are hidden by default and open from a single
  Inspector panel.
- The user should not see developer/debug labels such as "Rendered" or "Browser-owned controls"
  in the default final UI.

## Default Layout

### Top Browser Bar

The top bar contains:

1. Navigation controls:
   - Back
   - Forward
   - Reload
   - Bookmarks/history drawer button
2. Complete URI input:
   - one full text field, not visually split into scheme and value;
   - examples:
     - `metaid://idq...`
     - `metaapp://<pinId>`
   - the URI input has highest layout priority and must not be squeezed by identity chips.
3. Current resource identity chip:
   - for `metaid://`, this is the Bot identity;
   - for `metaapp://`, this is the publisher/creator identity;
   - this is the owner of the current resource, not the current local user.
4. Compact using-identity selector:
   - default visible form: `Using: My Bot` plus a down-caret icon
   - expanded form explains that this identity is used for private chat, service calls,
     signing, and payments.

The URI input must remain the primary visual and interaction target. On narrower widths,
the using selector and identity chip may wrap or compact before the URI field loses usable
space.

### Main Content Render Area

The main area renders the visited resource. It does not show a default "Rendered" tab.

For `metaid://` Bot Pages:

- render a native OAC Bot Page;
- show Bot avatar, name, GlobalMetaId, summary/profile fields, public activity, and services;
- show trusted actions near the Bot header:
  - Message
  - Services
  - Copy URI

These actions may appear in the Bot Page header because the Bot Page renderer is native and
owned by the Browser. The implementation must still treat them as Browser controls, not as
untrusted page content.

For `metaapp://` and other custom renderers:

- the main viewport should focus on the content itself;
- do not wrap custom MetaApp content in an extra creator/profile card;
- creator identity is already visible in browser chrome;
- trusted actions should remain in the browser layer, not inside the rendered content.

### Minimal Status Strip

The bottom strip is intentionally small. It should show only high-signal resolution status:

- `resolved`
- `verified`, `partial`, or `unverified`
- `renderer: bot-page`, `renderer: html-iframe`, `renderer: pdf`, etc.
- `TXID: <short txid>` when available

Clicking `verified`, `partial`, `unverified`, or `TXID` opens the Inspector.

Use the term **TXID** consistently. Do not show **TSID**.

## On-Demand Panels

### Bookmarks And History Drawer

The left drawer is hidden by default and opens from the bookmarks/history button.

It may contain:

- bookmarks;
- recent Bots;
- recent MetaApps;
- visit history.

It must not be part of the default product visual. Browser use starts with visiting a URI,
not managing bookmarks.

### Inspector Panel

Identity, Chain Proof, and Source are combined into one right-side Inspector.

Open the Inspector from any of these entry points:

- current resource identity chip;
- shield/check proof control in the identity chip;
- `verified` / `partial` / `unverified` status item;
- `TXID` status item.

The default UI should use one consistent shield/check proof icon and tooltip:

```text
Verified chain proof
```

Avoid standalone checkmark glyphs without context.

The Inspector has three internal sections or tabs:

1. Identity
2. Proof
3. Source

#### Identity Section

For a Bot Page:

- Bot name
- avatar
- GlobalMetaId
- profile protocol paths used to render the page
- local known profile slug if the Bot is local
- network/source metadata if available

For a MetaApp:

- app title
- publisher/creator name
- publisher/creator GlobalMetaId
- app pin id
- version metadata if available

#### Proof Section

Proof details must include:

- TXID
- pin id
- protocol path
- content hash
- publisher GlobalMetaId
- block explorer entry point
- verification state:
  - `verified`
  - `partial`
  - `unverified`
- short explanation of what is verified and what is still local/cache-derived.

The minimal status strip may show `sha256` as an extra hint, but `sha256` must not replace
chain proof fields.

#### Source Section

Source details should include:

- resolved URI;
- resolved content type;
- renderer selected;
- raw metadata used by the renderer;
- cache/source URL or local asset path when applicable;
- fetch time and stale-cache warning when applicable.

## URI Model

The Browser accepts complete URI strings.

Supported first-stage schemes:

```text
metaid://<globalMetaId>
metaapp://<pinId>
```

Parsing rules:

- trim whitespace;
- scheme is case-insensitive for parsing but should normalize to lowercase for display;
- reject missing scheme;
- reject empty authority/path after the scheme;
- reject unsupported schemes with a clear user-facing error;
- preserve the original URI in history.

The route can also accept a URI query parameter for deep links:

```text
/ui/browser?uri=metaid%3A%2F%2Fidq...
```

The URL bar inside the Browser should display the decoded Agent Internet URI, not the local
`/ui/browser` URL.

## Resolution Model

Introduce a small local Browser resolver abstraction rather than embedding resolution logic
inside UI code.

Conceptual API:

```ts
interface BrowserResolveInput {
  uri: string;
  usingProfileSlug?: string;
}

interface BrowserResolveResult {
  uri: string;
  normalizedUri: string;
  resourceType: 'bot' | 'metaapp' | 'unsupported';
  title: string;
  owner: BrowserResourceOwner;
  renderer: BrowserRendererDescriptor;
  status: BrowserResolutionStatus;
  proof?: BrowserProofSummary;
  source?: BrowserSourceSummary;
  actions: BrowserTrustedAction[];
}
```

The UI should call a daemon endpoint to resolve the URI and then render the returned view
model. The first implementation may mock incomplete proof fields behind `partial` status if
the full chain lookup is not yet available, but the UI contract should already model the real
fields.

Suggested first endpoint:

```text
GET /api/browser/resolve?uri=<encoded-uri>&from=<optional-local-profile-slug>
```

Return a `MetabotCommandResult<BrowserResolveResult>`.

## Renderer Model

Use renderer-specific components behind one viewport.

### Bot Page Renderer

For `metaid://<globalMetaId>`.

Native renderer. It can show Browser trusted controls in the page header because the Browser
owns the renderer.

### HTML MetaApp Renderer

For HTML MetaApps.

Use a sandboxed iframe in the viewport. This is technically feasible and should be the default
for HTML content, but it must be treated as untrusted content.

Recommended iframe constraints for first implementation:

- use `sandbox`;
- do not grant same-origin unless a concrete bridge requires it;
- do not grant top navigation;
- communicate with the Browser only through explicit, validated postMessage messages if needed;
- do not let iframe content initiate payment, signing, private chat, or service calls without
  a Browser-owned confirmation panel.

The iframe render result can be good for normal HTML display if the content is packaged with
stable local asset URLs and a predictable base path. Some third-party HTML may still fail due
to CSP, external script dependencies, absolute paths, mixed content, or iframe restrictions;
those failures should be shown as renderer errors, not hidden.

### PDF, Image, And Video Renderers

Do not force every content type through HTML iframe.

Use content-type-specific renderers:

- PDF: browser-native PDF iframe/object/embed if available, with fallback download/open link;
- image: native image viewport;
- video: native video element;
- unknown/binary: source/detail panel with download/open options.

All renderers share the same Browser chrome, owner identity, using identity, status strip,
and Inspector.

## Trusted Actions

Trusted actions belong to the Browser layer.

For Bot Page:

- Message
- Services
- Copy URI

For MetaApp:

- Creator
- View Proof
- Copy URI

The first Bot Page renderer may visually place Message, Services, and Copy URI in the content
header, but the implementation must keep their handlers in Browser-owned code. When the content
renderer is custom HTML, PDF, image, or video, the trusted actions must still come from Browser
chrome or Browser-owned overlays, not from the content.

Service calls must open a trusted Browser panel that previews:

- using identity;
- target Bot/service;
- service name and pin id;
- price/payment terms when applicable;
- exact request payload before confirmation.

## Visual Direction

The UI should feel like a browser, not a developer console.

Guidelines:

- prefer a lighter document viewport than the current dark OAC utility pages;
- keep the top chrome compact and browser-like;
- avoid default side panels;
- make the content area clean enough for HTML/PDF/image/video reading;
- reserve proof details for the Inspector;
- keep technical labels visible only where they help, such as status and Inspector.

The final UI should still share OAC's local UI DNA: compact controls, restrained colors,
monospace where useful, and dense but readable information.

## Design Alternatives Considered

### Option A: Always-visible Proof Layout

The first mockup showed proof/source information next to the rendered content.

Rejected for default UI. It makes the product feel like a blockchain debugging tool instead
of a browser.

### Option B: Browser With Sidebar And Proof Panel

The second mockup kept bookmarks/history on the left and chain proof on the right.

Rejected for the default state. The information is useful, but it should be on demand.

### Option C: Minimal Browser With On-Demand Inspector

Accepted.

Default UI has top chrome, content viewport, and a minimal status strip. Bookmarks/history
and Inspector are available on demand.

## Acceptance Criteria For The Design

The implementation plan should preserve these outcomes:

1. `/ui/browser` exists and follows the existing local UI page framework.
2. The default screen loads a `metaid://<globalMetaId>` Bot Page when a local/default Bot is
   available, or a clear empty state when no Bot identity exists.
3. The URI input accepts full `metaid://...` and `metaapp://...` strings.
4. The URI input remains the highest-priority control in the top bar.
5. Current resource identity and using identity are visually distinct.
6. The using selector defaults to compact `Using: My Bot`.
7. The default page has no always-visible bookmarks/sidebar.
8. The default page has no always-visible proof/source panel.
9. Inspector opens from identity/proof/status/TXID controls.
10. Proof details use TXID, pin id, protocol path, content hash, publisher GlobalMetaId, and
    block explorer link.
11. HTML MetaApps render through a sandboxed iframe or a clear renderer error.
12. PDF/image/video have renderer-specific paths and are not forced through generic HTML.
13. Trusted actions are implemented in Browser-owned code.
14. No default final UI label says "Browser-owned controls"; that phrase remains a design
    principle, not user-facing product copy.

## Testing Strategy

Focused verification should include:

- TypeScript build.
- Route test proving `/ui/browser` is served by the daemon.
- Unit tests for URI parsing and unsupported scheme errors.
- Unit tests for resolver view models for:
  - `metaid://<globalMetaId>`
  - `metaapp://<pinId>`
  - unsupported scheme
- UI HTML tests or DOM tests proving:
  - full URI input exists;
  - no default rendered/proof/source tabs are visible;
  - using selector is compact;
  - status strip includes resolved/verification/renderer/TXID fields;
  - Inspector and drawer are hidden by default.

Browser verification should open `/ui/browser`, confirm the default view is browser-first,
and then exercise opening the drawer and Inspector.
