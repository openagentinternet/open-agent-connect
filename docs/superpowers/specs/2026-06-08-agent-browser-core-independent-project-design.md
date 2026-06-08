# Agent Browser Core Independent Project Design

Date: 2026-06-08
Status: Draft for user review

## Context

The Agent Internet Browser started inside Open Agent Connect because OAC already had the
first usable local runtime: Bot profiles, daemon routes, settings storage, MetaApp cache,
private chat, service calls, and local UI pages.

The product direction is now broader. The same Browser should run in at least three places:

- a standalone public website under its own domain;
- the embedded Browser inside Open Agent Connect;
- the embedded Browser inside IDBots.

Maintaining three Browser implementations would be the wrong long-term shape. The Browser
should become a single product codebase with host-specific adapters. The standalone website
should be the primary day-to-day product target, while OAC and IDBots consume the same Browser
package through stable integration contracts.

The planned external repository is:

```text
https://github.com/openagentinternet/agent-browser-core
```

This document defines the intended architecture for that repository. It does not implement the
repo split yet.

## Scope Note

This is a strategic architecture spec, not a file-level migration plan. It intentionally does
not depend on the exact Browser feature set that exists inside OAC today. The current Browser
may continue changing while this document is reviewed. Once the Browser feature surface is
stable, a separate implementation plan should map the finalized modules into the package
boundaries described here.

## Core Decision

Create `agent-browser-core` as a standalone Browser product repository that owns:

- the Browser UI shell;
- resource resolution contracts;
- renderer selection;
- Bot homepage and MetaApp rendering;
- the built-in template registry;
- host adapter contracts;
- standalone hosted deployment code;
- adapter conformance tests for OAC, IDBots, and standalone hosts.

OAC and IDBots should not fork the Browser UI. They should provide host adapters that satisfy
the Browser contract, then import a pinned Browser package version during their own builds.

The key mental model is:

```text
Browser product code is shared.
Runtime identity, persistence, wallet, and privileged actions are host-provided.
```

## Goals

- Maintain one Browser product codebase for standalone, OAC, and IDBots.
- Make the standalone hosted Browser a first-class deployment target.
- Keep OAC and IDBots integration thin and contract-based.
- Make the top-right "current user" area host-neutral.
- Support wallet login and wallet-backed signing/payments in the standalone host.
- Keep OAC Bot profile behavior available through an OAC adapter.
- Keep IDBots account or agent behavior available through an IDBots adapter.
- Keep built-in Bot homepage templates shared across every host.
- Allow future user-uploaded templates without forcing that trust model into the first split.
- Make version upgrades testable through shared adapter conformance tests.

## Non-Goals

- Do not maintain separate Browser forks for standalone, OAC, and IDBots.
- Do not make the Browser core depend on OAC profile homes, IDBots SQLite tables, or Metalet
  directly.
- Do not allow untrusted rendered content to call wallet signing or payment APIs directly.
- Do not automatically upgrade OAC or IDBots to an unpinned latest Browser release.
- Do not implement user-uploaded templates in the first independent repository milestone.
- Do not require local LLM configuration for the standalone public website.

## Target Hosts

### Standalone Website

The standalone website is intended for human users on a public domain. Its top-right actor
control should be a Metalet wallet connection flow:

- disconnected state: a "Connect Wallet" control;
- connected state: the current wallet user, address, avatar when available, and wallet-backed
  capabilities;
- action capabilities: wallet signing, payment, template settings, and future hosted actions;
- no local LLM configuration;
- no local OAC Bot profile requirement.

The standalone host must treat wallet state as a browser-side session. Private keys stay inside
the wallet extension or wallet provider. The Browser may request signatures or payments only
through explicit trusted UI actions.

### Open Agent Connect Embedded Browser

OAC remains a local runtime host. Its adapter maps OAC concepts into Browser contracts:

- local MetaBot profiles become Browser actors;
- the top-right actor control can display "Using: <Bot>";
- settings persist in OAC profile config while OAC owns the backing store;
- MetaApp cache operations map to OAC's local cache;
- private chat, service calls, Bot profile actions, and local message views map to trusted OAC
  actions;
- OAC may keep local daemon routes, but route handlers should delegate to the Browser package.

### IDBots Embedded Browser

IDBots should consume the same Browser package and provide its own host adapter:

- the top-right actor control maps to IDBots account, agent, or identity state;
- settings and cache map to IDBots application storage;
- IDBots-specific actions map to IDBots routes or local services;
- the Browser core does not know whether the backing account is stored in SQLite.

## Repository Shape

The repository name should be `agent-browser-core`. The repository should be a TypeScript
workspace with packages and apps separated by responsibility.

Recommended layout:

```text
agent-browser-core/
  apps/
    standalone-web/
      src/
      public/
      vite.config.ts
  packages/
    core/
      src/
        contracts/
        normalize/
        resolvers/
        renderers/
        templates/
        uri/
    ui/
      src/
        app/
        chrome/
        panels/
        state/
    host-contract/
      src/
        browserHostAdapter.ts
        conformance/
    host-standalone/
      src/
        metaletWalletAdapter.ts
        standaloneHost.ts
        standaloneApi.ts
    test-harness/
      src/
        fixtures/
        fakeHosts/
        conformanceRunner.ts
  docs/
    specs/
    integration/
  scripts/
  package.json
  tsconfig.json
```

The exact workspace tool can be decided when the repository is created. The conservative default
is npm workspaces because OAC already uses npm and Node.js. The standalone web app can use Vite
for browser bundling without forcing OAC to use Vite internally.

## Package Boundaries

### `@openagentinternet/agent-browser-core`

Owns host-neutral Browser logic:

- URI parsing and normalization;
- resource envelope definitions;
- renderer selection;
- Bot homepage data normalization;
- MetaApp resource normalization;
- built-in template registry;
- trusted action declarations;
- non-DOM utility code.

This package must avoid Node-only APIs unless they are isolated behind optional server entry
points. It should be usable by browser bundlers and by Node hosts.

### `@openagentinternet/agent-browser-ui`

Owns the Browser UI shell:

- address bar;
- resource identity chip;
- top-right actor chip;
- left history/bookmarks panel;
- right inspector panel;
- settings and template selection UI;
- renderer host frame;
- trusted action buttons.

The UI should consume host-neutral runtime snapshots and resource envelopes. It should not import
OAC, IDBots, SQLite, or Metalet internals.

### `@openagentinternet/agent-browser-host-contract`

Owns stable host integration contracts and conformance tests:

- `BrowserHostAdapter`;
- `BrowserHostClient`;
- actor model;
- runtime snapshot;
- settings snapshot;
- cache snapshot;
- trusted action input/result types;
- conformance test harness that OAC and IDBots can run in CI.

This package is the main compatibility boundary. If this contract changes, OAC and IDBots must
be able to detect incompatibility before upgrading.

### `@openagentinternet/agent-browser-host-standalone`

Owns standalone website host behavior:

- Metalet wallet session adapter;
- same-origin API client;
- hosted settings storage adapter;
- hosted resource resolution adapter;
- hosted MetaApp preview route policy;
- wallet signing and payment trusted actions.

This package may depend on Metalet-facing code. The core and UI packages must not.

## Build Output

The independent project should publish package exports that work for both web bundlers and the
current OAC CommonJS environment.

Recommended package policy:

- publish TypeScript declarations;
- publish ESM for browser and modern bundler use;
- publish CJS compatibility exports while OAC still consumes CommonJS output;
- keep server-only exports separate from browser-safe exports.

Example export shape:

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs"
    },
    "./ui": {
      "types": "./dist/ui.d.ts",
      "import": "./dist/ui.mjs",
      "require": "./dist/ui.cjs"
    },
    "./host-contract": {
      "types": "./dist/host-contract.d.ts",
      "import": "./dist/host-contract.mjs",
      "require": "./dist/host-contract.cjs"
    },
    "./standalone": {
      "types": "./dist/standalone.d.ts",
      "import": "./dist/standalone.mjs"
    }
  }
}
```

## Runtime Model

The Browser frontend should start by loading a host runtime snapshot.

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
  features: BrowserFeatureFlags;
  labels: BrowserRuntimeLabels;
}
```

The top-right chip is driven by this snapshot:

- standalone returns wallet labels and wallet actors;
- OAC returns Bot labels and OAC Bot actors;
- IDBots returns account or agent labels and IDBots actors.

Browser UI copy should be label-driven. The core UI should not hardcode "Using Bot",
"No Bot", `/ui/bot`, or SQLite/account-specific wording.

## Actor Model

The current user/identity concept should be modeled as a Browser actor:

```ts
type BrowserHostKind = "standalone" | "oac" | "idbots";
type BrowserActorKind = "wallet" | "oac-bot" | "idbots-agent" | "idbots-account";

type BrowserActorCapability =
  | "private-chat"
  | "service-call"
  | "wallet-sign"
  | "payment"
  | "template-settings"
  | "profile-management"
  | "message-view";

interface BrowserActor {
  id: string;
  label: string;
  kind: BrowserActorKind;
  globalMetaId?: string;
  address?: string;
  avatar?: string;
  isDefault: boolean;
  capabilities: BrowserActorCapability[];
}
```

Actions should be enabled by capabilities, not by host name. For example:

- OAC Bot actor: `private-chat`, `service-call`, `template-settings`;
- standalone wallet actor: `wallet-sign`, `payment`, `template-settings`;
- IDBots account actor: whatever IDBots can actually support.

## Host Adapter Contract

The host adapter is the boundary between Browser product code and runtime-specific services.

```ts
interface BrowserHostAdapter {
  getRuntime(input?: BrowserRuntimeInput): Promise<BrowserCommandResult<BrowserRuntimeSnapshot>>;
  resolveResource(input: BrowserResolveInput): Promise<BrowserCommandResult<BrowserResolveResult>>;
  getSettings(input?: BrowserSettingsInput): Promise<BrowserCommandResult<BrowserSettingsSnapshot>>;
  updateSettings(input: BrowserSettingsUpdateInput): Promise<BrowserCommandResult<BrowserSettingsSnapshot>>;
  getCache(input?: BrowserCacheInput): Promise<BrowserCommandResult<BrowserCacheSnapshot>>;
  clearCache(input: BrowserCacheClearInput): Promise<BrowserCommandResult<BrowserCacheClearResult>>;
  runTrustedAction(input: BrowserTrustedActionInput): Promise<BrowserCommandResult<BrowserTrustedActionResult>>;
}
```

This can remain one facade while the system is small. If pressure grows, it can split into:

- `BrowserActorAdapter`;
- `BrowserResolverAdapter`;
- `BrowserSettingsAdapter`;
- `BrowserCacheAdapter`;
- `BrowserTrustedActionAdapter`;
- `BrowserWalletAdapter`.

The first independent package should avoid splitting too early. The conformance tests should
lock behavior, not internal implementation shape.

## Frontend Host Client

The UI should not call a concrete daemon directly. It should use a `BrowserHostClient` interface.

For OAC and IDBots, this client can be an HTTP client pointed at local or app-hosted routes.
For standalone, this client can combine:

- same-origin HTTP for resource resolution, settings, cache, and server-side preview;
- browser-side Metalet SDK calls for wallet login, signing, and payment actions.

```ts
interface BrowserHostClient {
  getRuntime(input?: BrowserRuntimeInput): Promise<BrowserCommandResult<BrowserRuntimeSnapshot>>;
  resolveResource(input: BrowserResolveInput): Promise<BrowserCommandResult<BrowserResolveResult>>;
  getSettings(input?: BrowserSettingsInput): Promise<BrowserCommandResult<BrowserSettingsSnapshot>>;
  updateSettings(input: BrowserSettingsUpdateInput): Promise<BrowserCommandResult<BrowserSettingsSnapshot>>;
  getCache(input?: BrowserCacheInput): Promise<BrowserCommandResult<BrowserCacheSnapshot>>;
  clearCache(input: BrowserCacheClearInput): Promise<BrowserCommandResult<BrowserCacheClearResult>>;
  runTrustedAction(input: BrowserTrustedActionInput): Promise<BrowserCommandResult<BrowserTrustedActionResult>>;
}
```

The interface mirrors the host adapter so tests can run the same contract against direct adapters
or HTTP clients.

## Resource Envelope

The Browser renderer should receive normalized resource envelopes instead of raw host responses.

```ts
interface BrowserResourceEnvelope {
  uri: string;
  normalizedUri: string;
  resourceType: "bot" | "metaapp" | "document" | "image" | "pdf" | "unknown";
  title: string;
  owner?: BrowserResourceOwner;
  proof?: BrowserResourceProof;
  renderer: BrowserRendererDescriptor;
  actions: BrowserTrustedActionDescriptor[];
  sections: BrowserResourceSection[];
  raw?: unknown;
}
```

The normalized model should tolerate future API growth. For Bot homepages, new list-like data
such as services, buses, skills, buzzes, posts, activity, and related apps should be expressed
as typed or generic sections:

```ts
interface BrowserResourceSection {
  id: string;
  title: string;
  kind: "services" | "skills" | "buses" | "buzzes" | "apps" | "activity" | "generic-list";
  items: BrowserResourceListItem[];
}
```

Unknown sections should still be displayable as generic lists when the payload follows the
agreed section skeleton. This keeps templates resilient when remote JSON expands.

## Template System

Built-in Bot homepage templates should live in `agent-browser-core`, not in OAC or IDBots.

Each template should have metadata:

```json
{
  "schemaVersion": 1,
  "id": "classic-profile",
  "name": "Classic Profile",
  "description": "A balanced Bot homepage layout for identity, services, and activity.",
  "resourceTypes": ["bot"],
  "previewImage": "./preview.png",
  "entry": "./template.ts",
  "version": "1.0.0"
}
```

Template renderer contract:

```ts
interface BrowserTemplate {
  metadata: BrowserTemplateMetadata;
  render(input: BrowserTemplateRenderInput): BrowserTemplateRenderResult;
}
```

The first independent release should support:

- two or three built-in Bot homepage templates;
- default template selection through Browser settings;
- template preview metadata for settings UI;
- generic list rendering for future Bot homepage sections;
- no uploaded third-party templates yet.

User-uploaded templates need a separate trust model:

- package signing or publisher identity;
- install and uninstall lifecycle;
- renderer sandboxing;
- preview generation;
- template permission declarations;
- sharing and moderation policy.

That should be a later spec, not part of the first repository split.

## Trusted Actions

Rendered content should not directly perform privileged actions. The Browser-owned chrome and
native renderers emit trusted action requests:

```ts
type BrowserTrustedActionKind =
  | "private-chat"
  | "service-call"
  | "copy-uri"
  | "open-settings"
  | "login"
  | "wallet-sign"
  | "payment"
  | "edit-profile"
  | "configure-chat"
  | "view-messages";
```

The host decides whether a trusted action is supported:

- OAC handles private chat, service calls, profile edits, chat config, and local messages;
- standalone handles login, wallet signing, and payments through Metalet;
- IDBots handles its own account and agent actions.

If a host does not support an action, it should fail closed with a structured unsupported-action
result. The Browser UI should display that as a normal unavailable action, not as a crash.

## Standalone Wallet Model

The standalone website should use a dedicated wallet adapter rather than making Metalet a core
dependency.

```ts
interface BrowserWalletAdapter {
  getSession(): Promise<BrowserWalletSession | null>;
  connect(): Promise<BrowserWalletSession>;
  disconnect(): Promise<void>;
  sign(input: BrowserWalletSignInput): Promise<BrowserWalletSignResult>;
  pay(input: BrowserPaymentInput): Promise<BrowserPaymentResult>;
}
```

The standalone host converts wallet session state into Browser actors:

- no session: no default actor, `walletLogin: true`, labels show connect-wallet copy;
- connected session: actor kind `wallet`, address populated, wallet capabilities enabled.

The Browser UI should only request wallet actions from first-party Browser controls. MetaApp
iframe content must not be allowed to call wallet APIs directly.

## Storage And Cache

Storage is host-owned:

- standalone stores settings per wallet user or anonymous session through hosted storage;
- OAC stores settings in OAC profile config;
- IDBots stores settings in its application account storage;
- Browser core only knows the settings contract.

Cache is also host-owned:

- standalone may use hosted object storage, database records, CDN artifacts, and browser cache;
- OAC maps to its local MetaApp artifact cache;
- IDBots maps to IDBots local or app-managed storage.

The Browser UI should show cache controls only when `features.cacheManagement` is enabled.

## Security Model

The security model must be stricter for the standalone public website than for a local OAC page.

Required principles:

- untrusted MetaApp content runs in a sandboxed iframe or equivalent isolated renderer;
- wallet signing and payment are first-party Browser trusted actions only;
- untrusted iframe content cannot access the wallet adapter;
- preview assets should use CSP and content-type controls;
- resource resolution should avoid leaking privileged host secrets;
- standalone hosted APIs should assume hostile public traffic;
- OAC and IDBots local routes should not inherit public-host assumptions accidentally.

Standalone MetaApp preview is a dedicated security topic. The first production standalone release
must define CSP, sandbox flags, allowed asset types, and same-origin versus subdomain isolation
before enabling arbitrary remote MetaApp previews.

## OAC And IDBots Integration Model

OAC and IDBots should consume `agent-browser-core` as a versioned dependency, not as an
uncontrolled latest source pull.

Recommended model:

1. Browser releases a semver version.
2. OAC or IDBots CI opens or tests an upgrade to that exact version.
3. The host adapter conformance suite runs.
4. Host-specific Browser route/UI smoke tests run.
5. The host release pins the passing Browser version.

This keeps one Browser codebase while avoiding accidental breakage from contract drift.

For OAC, the adapter can initially stay in the OAC repository because it imports OAC internals.
For IDBots, the adapter can initially stay in the IDBots repository because it imports IDBots
storage and account internals. If an adapter becomes generic enough later, it can move into
`agent-browser-core` as an optional package.

## Conformance Tests

`agent-browser-core` should ship a host conformance test package. Each host must prove:

- it returns a valid runtime snapshot;
- actors have stable ids, labels, kinds, and capabilities;
- no-actor behavior is well defined;
- settings read/write round-trips;
- resource resolution returns normalized envelopes;
- cache operations follow the declared feature flags;
- trusted unsupported actions fail closed;
- supported actions return structured results;
- host labels render without OAC-specific assumptions.

OAC and IDBots CI should import these tests and run them against their real adapters.

## Versioning Policy

The host contract should follow semver:

- patch: bug fixes and compatible UI/rendering updates;
- minor: additive resource sections, additive capabilities, additive actions, new built-in
  templates, compatible renderer behavior;
- major: breaking adapter contract changes, removed fields, changed action semantics, or changed
  resource envelope requirements.

During the initial extraction, `0.x` versions are acceptable. Even in `0.x`, OAC and IDBots
should pin exact versions until the conformance suite becomes mature.

## Migration Strategy

### Phase 1: Freeze The Browser Product Surface

Before creating the external repository, freeze the Browser product surface that should move
as shared code:

- resource types and renderers;
- built-in Bot homepage templates;
- settings categories;
- trusted actions;
- actor and runtime labels;
- cache and preview expectations;
- inspector and browser chrome behavior.

This phase is intentionally feature-oriented rather than file-oriented. It should happen after
any in-flight Browser feature work settles.

### Phase 2: Create The External Repository

Create `https://github.com/openagentinternet/agent-browser-core` with:

- TypeScript workspace setup;
- package layout from this spec;
- Browser contracts and renderer code migrated from the finalized Browser surface;
- documentation adapted from the finalized Browser specs;
- initial conformance test package;
- standalone web app skeleton.

This phase should not require OAC to consume the new package yet.

### Phase 3: Publish The First Browser Package

Publish an initial package version with:

- host contract exports;
- UI shell exports;
- built-in template registry;
- resource normalization;
- conformance test harness;
- standalone local dev server or Vite preview.

This release can be marked pre-1.0.

### Phase 4: Move OAC To The Published Package

Update OAC to import the Browser package:

- keep the OAC adapter in OAC;
- replace copied Browser UI/core files with package imports;
- keep OAC route paths stable;
- run Browser conformance tests against the OAC adapter;
- run OAC focused Browser tests.

### Phase 5: Build The Standalone Production Host

Implement the public standalone app:

- Metalet wallet connect/disconnect;
- wallet actor runtime;
- wallet signing and payment trusted actions;
- hosted settings;
- hosted resolver and preview API;
- production CSP/sandbox policy;
- deployment workflow.

### Phase 6: Add IDBots Integration

Implement the IDBots adapter in IDBots:

- map IDBots account or agent state to Browser actors;
- map SQLite-backed settings/cache to Browser contracts;
- wire IDBots trusted actions;
- run conformance tests in IDBots CI;
- pin the Browser package version.

### Phase 7: Add Third-Party Template Packages

Only after the shared Browser and host adapters are stable, design user-uploaded templates:

- template package format;
- signing and publisher identity;
- install and sharing workflow;
- preview generation;
- sandboxing;
- marketplace or registry policy.

## Success Criteria

The architecture succeeds when:

- standalone, OAC, and IDBots use the same Browser UI/rendering/template code;
- the top-right actor control is host-specific without Browser forks;
- standalone can use Metalet wallet login without OAC dependencies;
- OAC can keep local Bot functionality without standalone wallet assumptions;
- IDBots can use its account system without Browser core knowing SQLite;
- Browser releases can be tested and pinned by host CI;
- adding a built-in Browser template updates all hosts after a version upgrade;
- adapter contract drift is caught before OAC or IDBots release.

## Risks

- Extracting the external repository too early could freeze unstable contracts.
- Browser UI code may still contain OAC-specific wording that needs cleanup during extraction.
- Dual ESM/CJS publishing adds build complexity but is useful while OAC remains CommonJS.
- Standalone MetaApp preview has higher security requirements than local OAC preview.
- Wallet signing and payment action semantics need careful UX and security design.
- Automatic CI upgrades can still break hosts if conformance tests are incomplete.

## Open Decisions

- Whether the published package should be one package or several smaller scoped packages.
- Whether the standalone app should be deployed from the same repository or a separate deployment
  repository after the first production release.
- Whether IDBots actor kind should be `idbots-agent`, `idbots-account`, or support both.
- Which hosted storage backend should standalone use for wallet-scoped settings.
- Whether standalone MetaApp previews should use same-origin routes, isolated subdomains, or a
  separate preview domain.

## Recommended Immediate Next Step

Do not split the repository immediately after this spec. First, wait for the in-flight Browser
feature work to settle, then use this document to create an implementation plan for repository
extraction:

1. finalize the host contract naming and exported package boundaries;
2. inventory the finalized Browser modules and classify them as core, UI, host adapter, or host
   private implementation;
3. create the `agent-browser-core` repository skeleton;
4. move contract and UI code into the new package;
5. wire OAC to consume the package through a pinned version;
6. only then build the production standalone Metalet wallet host.

This order keeps the architecture moving toward one shared Browser product without forcing OAC
or IDBots to chase an unstable public package.
