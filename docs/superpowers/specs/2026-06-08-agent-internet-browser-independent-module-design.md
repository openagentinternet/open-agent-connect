# Agent Internet Browser Independent Module Design

Date: 2026-06-08
Status: Design for user review

## Context

The current Agent Internet Browser started as the Open Agent Connect local `/ui/browser`
surface. That was the right first implementation because OAC already had a local daemon,
Bot identity management, MetaApp preview sessions, and browser settings storage.

The long-term product direction is broader:

- a standalone hosted Browser running under its own domain;
- the same Browser embedded into Open Agent Connect;
- the same Browser embedded into IDBots.

The Browser should therefore become a single maintainable module with host-specific adapters.
OAC and IDBots should import or bundle that module instead of maintaining separate browser
implementations.

## Goals

- Keep one Browser product codebase for standalone, OAC, and IDBots.
- Make the Browser UI and resource-rendering flow independent from OAC profile storage.
- Preserve the existing OAC `/ui/browser` behavior while the architecture is split.
- Give standalone hosting first-class design status instead of treating it as a later patch.
- Keep host-specific behavior behind explicit adapter boundaries.

## Non-Goals For The First Refactor

- Do not create a new external repository yet.
- Do not replace the existing OAC `/ui/browser` route.
- Do not implement Metalet wallet login in this round.
- Do not implement user-uploaded templates or template sharing in this round.
- Do not rewrite the Browser UI framework before the host boundary is stable.

## Target Hosts

### Standalone Hosted Browser

This is the primary long-term deployment target. It runs under a public domain and serves users
who are not inside OAC or IDBots.

Expected host responsibilities:

- authenticate the current user, likely through Metalet in a later phase;
- provide a current actor derived from the logged-in wallet or account;
- store browser settings per user or per session;
- provide hosted cache, object storage, and MetaApp preview infrastructure;
- enforce public-domain sandboxing, CSP, and CORS policies.

### OAC Embedded Browser

OAC remains the first implementation host. Its adapter maps existing OAC concepts into the
host-neutral Browser model:

- local MetaBot profiles become Browser actors;
- `~/.metabot/cache/metaapps` remains the OAC MetaApp cache root;
- existing private chat and service call endpoints remain trusted host actions;
- OAC config remains the backing store for browser settings during migration.

### IDBots Embedded Browser

IDBots should consume the same Browser module and provide its own adapter:

- IDBots identity or agent state becomes Browser actors;
- IDBots application storage becomes the cache/settings backend;
- IDBots runtime actions map to its own chat, service, and wallet flows.

## Core Decision

Introduce a host adapter facade between the Browser module and every runtime host.

The Browser should ask the host for actors, settings, resource resolution, cache state, and
trusted actions. It should not know whether those capabilities come from OAC profile homes,
IDBots app data, or a standalone web server.

The dependency direction should be one-way: host adapters may import Browser contracts, but the
Browser module must not import OAC or IDBots internals.

```ts
interface BrowserHostAdapter {
  getRuntime(input: BrowserRuntimeInput): Promise<BrowserRuntimeSnapshot>;
  resolveResource(input: BrowserResolveInput): Promise<BrowserResolveResult>;
  getSettings(input: BrowserSettingsInput): Promise<BrowserSettingsSnapshot>;
  updateSettings(input: BrowserSettingsUpdateInput): Promise<BrowserSettingsSnapshot>;
  getCache(input: BrowserCacheInput): Promise<BrowserCacheSnapshot>;
  clearCache(input: BrowserCacheClearInput): Promise<BrowserCacheClearResult>;
  runTrustedAction(input: BrowserTrustedActionInput): Promise<BrowserTrustedActionResult>;
}
```

This can start as one facade. It can later split into smaller adapters such as actor, storage,
resolver, and actions if the implementation pressure becomes real.

## Host-Neutral Actor Model

The current Browser UI is centered on an OAC-specific `usingSlug`. That should become a generic
Browser actor id.

```ts
interface BrowserActor {
  id: string;
  label: string;
  kind: "oac-bot" | "idbots-agent" | "wallet";
  globalMetaId?: string;
  address?: string;
  avatar?: string;
  isDefault: boolean;
  capabilities: BrowserActorCapability[];
}

type BrowserActorCapability =
  | "private-chat"
  | "service-call"
  | "wallet-sign"
  | "payment"
  | "template-settings";
```

OAC can still accept `from=<slug>` on existing routes for compatibility, but Browser internals
should move toward `actorId`.

## Runtime Snapshot

The Browser frontend should load a host-neutral runtime snapshot before rendering host-dependent
controls.

```ts
interface BrowserRuntimeSnapshot {
  host: {
    kind: "standalone" | "oac" | "idbots";
    name: string;
    localMode: boolean;
    publicBaseUrl?: string;
  };
  actors: BrowserActor[];
  defaultActor: BrowserActor | null;
  defaultUri: string | null;
  features: {
    privateChat: boolean;
    serviceCall: boolean;
    cacheManagement: boolean;
    templateSettings: boolean;
    walletLogin: boolean;
  };
  labels: {
    actorChip: string;
    noActorTitle: string;
    noActorBody: string;
    noActorAction?: {
      label: string;
      href: string;
    };
  };
}
```

This replaces UI assumptions such as "Using: My Bot", "No Bot", and `/ui/bot` with host-provided
copy and actions.

## Settings Model

Browser settings should become a Browser-owned model. OAC can continue to store the same values
inside its existing config during migration.

```ts
interface BrowserSettings {
  defaultChain: "btc" | "doge";
  metaSoBaseUrl: string;
  metasoP2pBaseUrl: string;
  privateChatEnabled: boolean;
  serviceCallEnabled: boolean;
  botHomepageTemplateId: string;
}
```

The important boundary is direction: the Browser module owns the settings contract, and each host
decides where those settings are persisted.

## Resource Resolution

The Browser module keeps a single resource flow:

```text
URI -> normalize input -> resolve resource -> normalize payload -> render by resource type
```

The host adapter decides how to resolve each URI type:

- OAC uses the existing daemon resolver and local MetaApp preview sessions.
- IDBots maps to its runtime resolver and storage.
- Standalone can either proxy resolution through its server or call public APIs directly when the
  security model allows it.

The Browser renderer receives normalized `BrowserResolveResult` data. It should not receive OAC
profile-home paths, local daemon internals, or host-specific config objects.

## Templates

Bot homepage templates should remain Browser module assets. A built-in template registry is the
right current model because it allows OAC, IDBots, and standalone deployments to share the same
rendering behavior.

The first independent-module boundary should support:

- built-in template metadata: id, name, description, preview image, supported resource type;
- built-in template renderers compiled with the Browser module;
- host-specific default template selection through `BrowserSettings`;
- a normalized Bot homepage payload that tolerates future lists such as services, buzzes, buses,
  skills, and activity.

User-uploaded template packages are intentionally left for a later spec. They need a signing,
sandboxing, preview, and install policy that is separate from this host-boundary refactor.

## Trusted Actions

The Browser UI should stop hardcoding OAC action endpoints such as private chat and service call.
Instead, rendered pages should emit trusted Browser action requests:

```ts
type BrowserTrustedActionKind =
  | "private-chat"
  | "service-call"
  | "copy-uri"
  | "open-settings"
  | "login";

interface BrowserTrustedActionInput {
  actorId: string | null;
  resourceUri: string;
  kind: BrowserTrustedActionKind;
  payload: Record<string, unknown>;
}
```

The host adapter decides whether the action is available and how it is fulfilled. Standalone can
disable OAC-only actions until wallet login and hosted action flows exist.

## Storage And Cache

Browser cache storage must be adapter-owned.

- OAC adapter maps cache operations to the existing MetaApp cache rooted at
  `~/.metabot/cache/metaapps`.
- IDBots adapter maps cache operations to IDBots application storage.
- Standalone adapter maps cache operations to hosted object storage, a database, CDN-backed
  artifacts, or browser-managed cache depending on the final hosting architecture.

The Browser UI can show cache statistics and clear-cache controls only when the runtime snapshot
enables `cacheManagement`.

## Frontend Runtime Configuration

The Browser frontend should receive a runtime config object rather than hardcoded endpoint paths.

```ts
interface BrowserFrontendRuntimeConfig {
  apiBaseUrl: string;
  endpoints: {
    runtime: string;
    resolve: string;
    settings: string;
    cache: string;
    actions: string;
  };
  hostKind: "standalone" | "oac" | "idbots";
}
```

OAC can inject local daemon endpoints. Standalone can use same-origin hosted endpoints or a
published JSON runtime document.

## Migration Plan

### Phase 1: Adapter Boundary Inside OAC

Add host-neutral Browser types and an OAC Browser host adapter inside the current repository.
Move OAC-specific profile lookup, settings mapping, cache path selection, and trusted action
wiring behind that adapter.

Keep the existing OAC HTTP routes stable:

- `/api/browser/context`
- `/api/browser/resolve`
- `/api/browser/settings`
- `/api/browser/cache`

During this compatibility phase, `/api/browser/context` can carry the new runtime snapshot shape.
A later standalone host may expose the same data as `/api/browser/runtime` if that reads more
naturally in a public API.

This phase should not change user-visible behavior.

### Phase 2: UI Runtime Config And Actor Naming

Change the Browser UI to consume the runtime snapshot and frontend config. Internally rename
`usingSlug` state to `actorId`, while keeping OAC route compatibility for `from=<slug>`.

Move private chat and service call buttons through a Browser trusted-action endpoint.

### Phase 3: Browser Module Packaging

Create a Browser-owned package boundary in the repository. The exact shape can be decided during
implementation, but the direction should be one of:

- `src/browser/*` as an internal package-like module first;
- a workspace package such as `packages/agent-browser`;
- a later external repository after OAC and IDBots both consume the same package boundary.

The recommended order is internal package-like module first, then workspace package, then external
repository only after the public API has stabilized.

### Phase 4: Standalone Host

Build the standalone hosted adapter:

- user session and wallet login;
- hosted settings storage;
- hosted cache and MetaApp preview infrastructure;
- public-domain CSP and sandbox policy;
- production deployment configuration.

This phase should reuse the same Browser module and renderer code that OAC already uses.

## Tests And Verification

Phase 1 should add adapter contract tests that prove:

- OAC profiles map into host-neutral Browser actors;
- OAC browser config maps into Browser settings;
- OAC MetaApp cache operations are still backed by the existing cache root;
- existing OAC Browser route tests still pass.

Phase 2 should add UI tests that prove:

- no-actor copy and action links come from runtime labels;
- actor state uses host-neutral ids internally;
- trusted actions route through the Browser action boundary;
- template selection still works through Browser settings.

Documentation-only changes should use `git diff --check`. Code changes should run `npm run build`
and the focused Browser route, resolver, config, and UI tests.

## Risks And Open Decisions

- Standalone hosted resolution may need a server-side proxy to avoid leaking privileged APIs or
  running into CORS limits.
- Hosted MetaApp preview needs a stricter sandbox and CSP policy than local OAC preview.
- Metalet login and wallet session semantics are not specified in this document.
- User-uploaded templates need a separate trust, signing, install, and sandbox design.
- Extracting an external repository too early would freeze the wrong public API.

## Recommended Next Implementation

Implement Phase 1 only:

1. Add host-neutral Browser adapter types.
2. Create the OAC Browser host adapter.
3. Route existing OAC Browser handlers through that adapter.
4. Preserve existing route contracts and user-visible behavior.
5. Add focused adapter tests plus existing Browser route and UI coverage.

This gives the Browser a real independent boundary without forcing a repo split before the
contract has proved itself in OAC.
