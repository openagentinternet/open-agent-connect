# Single-Machine Single-Daemon Design and Migration Contract

Date: 2026-07-18
Status: Draft for review

## Decision

Open Agent Connect will use one daemon for one normal local installation.

The production daemon will:

- listen only on `127.0.0.1`;
- use `http://127.0.0.1:10001` by default, or one persistently selected
  loopback address when first-install port fallback is required;
- serve all local MetaBot profiles indexed under the same MetaBot root;
- resolve the acting profile from `--from`, an equivalent request actor field,
  or the active-profile pointer when no actor is supplied;
- run machine-wide listeners and watchdogs once;
- run profile-scoped background work once per indexed profile; and
- be owned by one process supervisor rather than by an individual profile.

The target model is:

```text
Host agents / CLI / local UI
             |
             | one local endpoint
             v
  selected local endpoint
  (http://127.0.0.1:10001 by default)
             |
             v
     one production daemon
             |
             +-- actor resolver --> profile alice state and signer
             +-- actor resolver --> profile bob state and signer
             +-- actor resolver --> profile eric state and signer
             |
             +-- one machine-wide listener manager
             +-- one profile background-job coordinator
```

`--from` selects a MetaBot actor. It must no longer select a daemon process or
daemon port.

## Why This Replaces the Current Topology

The current runtime is profile-first at the process boundary:

- daemon state and the daemon lock live under each profile runtime;
- the daemon is constructed with one startup `homeDir`;
- a deterministic port is derived from that profile home; and
- CLI commands carrying `--from` resolve the target profile home before they
  resolve or start a daemon.

That topology grew from compatibility fixes rather than from a durable product
requirement. It now conflicts with the runtime's actual behavior:

- daemon handlers can already resolve another indexed profile and load that
  profile's state, configuration, and signer;
- Browser, Bot, wallet, LLM, service, provider, and trace surfaces already have
  actor-aware behavior;
- the SimpleMsg listener manager already enumerates all indexed profiles; and
- each additional daemon can therefore duplicate machine-wide sockets,
  watchdogs, cache refreshes, and other background work.

Multiple profile daemons do not create a meaningful secret-isolation boundary.
They run as the same operating-system user, and the current runtime already has
authorized code paths for resolving other indexed profile homes. The durable
security boundary is explicit actor resolution plus profile-scoped state and
signing, not a separate TCP server for each profile.

## Supersession Boundary

This document supersedes only the daemon topology and daemon-process storage
rules in the following historical documents:

- `2026-04-23-metabot-storage-layout-v2-design.md`, where `daemon.json` and
  `locks/daemon.lock` are defined as profile-local process metadata; and
- `2026-07-06-daemon-profile-routing-and-startup-recovery.md`, where the
  implementation intentionally preserves one daemon per profile.

All other profile-first storage rules remain authoritative. Identity state,
secrets, configuration, sessions, exports, databases, and profile mutation
locks remain profile-scoped.

Historical documents remain in the repository as records of earlier decisions.
New code, tests, and current documentation must follow this design after the
migration is implemented.

## Goals

- Provide one stable local management and API address.
- Eliminate profile-derived daemon ports and duplicate profile daemons.
- Keep all actor-sensitive operations explicitly profile-scoped.
- Ensure background work has one clear owner.
- Make daemon stop, restart, recovery, logging, and supervision dependable.
- Isolate development runtimes from the installed production runtime.
- Migrate existing installations without modifying identity, wallet, profile,
  conversation, service, or chain state.
- Fail closed when daemon ownership cannot be proven.

## Non-Goals

- Merging profile data into one shared profile database.
- Making profile secrets global.
- Exposing the daemon beyond the loopback interface.
- Adding remote daemon access.
- Adding HTTPS in the first migration.
- Changing the meaning of `--from` as an actor selector.
- Changing MetaID, A2A, Browser, wallet, or chain protocol contracts.
- Keeping multiple production daemon versions active against the same MetaBot
  root.

## Runtime Instance Model

### Normal installation

A normal user installation has exactly one production runtime instance:

```text
instance: default
MetaBot root: ~/.metabot
preferred daemon URL: http://127.0.0.1:10001
selected daemon URL: the persisted installation endpoint
```

All supported hosts on that operating-system account use the same installed
CLI shim and the same daemon. Cursor, Codex, WorkBuddy, Claude Code, and other
hosts must not install or start independent OAC daemons for the same MetaBot
root.

### Development exception

A developer may run one explicitly isolated development instance. It must use:

- a separate system home and therefore a separate `.metabot` root;
- separate profiles, secrets, runtime state, locks, and logs;
- a different fixed port, with `11001` as the development default;
- a repository-local CLI entry or shim; and
- no writes to `~/.metabot/bin/metabot` or the installed production runtime.

The development instance must not share production profile directories. Running
two daemon versions against the same identity secrets, conversation state,
provider state, or UTXO mutation state is forbidden.

The development exception is still one daemon per isolated runtime instance. It
does not restore the per-profile daemon model.

## Endpoint and Port Contract

The production default is:

```text
host: 127.0.0.1
port: 10001
base URL: http://127.0.0.1:10001
Bot management URL: http://127.0.0.1:10001/ui/bot
```

### One-time port selection and stable fallback

`10001` is the preferred default, not an assertion that every operating-system
account can reserve it. A normal installation has one selected daemon port.
The selected port is recorded in `~/.metabot/runtime/installation.json` and is
used by the CLI, local UI, supervisor, daemon record, and every supported host.

The selection contract is:

1. On a new installation or topology migration, attempt `10001` first.
2. If `10001` is owned by the healthy daemon for the same runtime instance,
   clients attach to it. If its owned daemon is unhealthy, verified recovery
   stops it and restarts on `10001`.
3. If an unrelated process owns `10001`, never terminate that process. Select
   the first free port in the bounded installation fallback range
   `10002` through `10020`, persist that port before starting the daemon, and
   clearly report the resulting management URL.
4. If every port in that range is unavailable, fail with an actionable
   `daemon_port_unavailable` error and identify the range and conflicting
   ports. Do not use an unbounded search or an ephemeral random port.
5. After a port has been persisted, every normal start, restart, recovery, and
   supervisor launch must use that exact port. A later collision with that port
   fails with `daemon_port_in_use`; it must not cause another automatic move.
6. Moving a completed installation to another port, including moving back to
   `10001`, is an explicit port migration: stop the verified owned daemon,
   update `installation.json` and the supervisor configuration atomically,
   restart, and verify the new endpoint.

Fallback selection happens only while creating or migrating an installation.
It is deterministic within the configured range and permanently recorded; it
is not runtime port drift. An installation on fallback port `10002`, for
example, has the stable management URL
`http://127.0.0.1:10002/ui/bot` until an explicit port migration changes it.

An advanced port override may remain available for constrained environments,
but it must update the same installation-level configuration through the
explicit port-migration path. It must not be selected independently by
individual profile commands or inherited accidentally from one host process.

The first migration remains HTTP-only. Loopback binding, host validation, and
same-origin write protection remain required. Local HTTPS requires a trusted
certificate lifecycle and is a separate design decision.

## Global Daemon Storage Boundary

Daemon process metadata moves out of profile runtimes into a new global runtime
layer:

```text
~/.metabot/
  manager/
    identity-profiles.json
    active-home.json

  runtime/
    installation.json
    daemon.json
    locks/
      daemon.lock
    logs/
      daemon.log
    recovery/
      last-exit.json
      migration.json

  profiles/
    <slug>/
      .runtime/
        config.json
        identity-secrets.json
        provider-secrets.json
        runtime-state.json
        runtime.sqlite
        sessions/
        exports/
        state/
        locks/
```

`~/.metabot/manager/` remains limited to the profile index and active-profile
pointer. Global daemon files must not be added to `manager/`.

`runtime/installation.json` is durable installation-level configuration. It is
not an active-process record and must survive daemon restarts. Its first
required daemon setting is the selected loopback port.

### Installation record

The installation record must include at least:

- schema version;
- selected daemon host and port;
- selection origin: `default`, `fallback`, or explicit port migration; and
- the timestamp of the most recent explicit configuration change.

It must not contain PIDs, locks, secrets, profile selectors, or transient
daemon health. Those belong in the daemon record, profile state, or logs.

### Global daemon record

The global `runtime/daemon.json` must include at least:

- schema version;
- instance ID;
- daemon owner ID;
- PID;
- host;
- port;
- base URL;
- OAC package version;
- runtime fingerprint;
- startup timestamp; and
- supervisor kind and service identity when supervised.

The daemon status response must expose enough non-secret fields to prove that a
client reached the expected OAC instance and version.

### Profile runtime after migration

Profile `.runtime/` directories keep all profile-specific data. They no longer
contain active daemon process records or the daemon singleton lock.

Other profile mutation locks remain valid and may be expanded where profile
state or chain writes require serialization.

## Actor Selection Contract

Every actor-sensitive request must resolve one indexed local profile before
reading secrets, signing, mutating profile state, or starting profile-specific
work.

Actor resolution priority is:

1. explicit `from` or equivalent actor identifier in the request;
2. the current `manager/active-home.json` pointer; and
3. an actionable `profile_not_selected` failure.

The daemon must read the active pointer at request time. The active profile is
not fixed when the daemon starts.

An explicit actor may match supported profile selectors, but it must resolve to
one indexed profile. Unknown or ambiguous selectors fail before side effects.
Arbitrary filesystem paths are never accepted as actor selectors.

### Request routing

The CLI always resolves the same daemon base URL. It forwards actor intent to
the daemon:

```text
metabot buzz post --from bob
  -> POST http://127.0.0.1:10001/api/buzz/post
  -> body.from = "bob"
  -> daemon resolves bob
  -> daemon loads bob state and signer
```

The CLI must not:

- read Bob's `daemon.json`;
- derive a port from Bob's profile path;
- start a Bob-specific daemon; or
- change the global active profile merely because `--from bob` was supplied.

### Handler context

Actor-aware handlers should receive a resolved profile context equivalent to:

```ts
interface ResolvedProfileContext {
  profile: IdentityProfileRecord;
  paths: MetabotPaths;
  runtimeStateStore: RuntimeStateStore;
  configStore: ConfigStore;
  secretStore: SecretStore;
  signer: Signer;
}
```

The exact TypeScript shape may differ, but the boundary must be centralized.
Routes must not independently rebuild actor matching, path resolution, and
signer selection.

Actor contexts may cache non-secret path and store objects. Signer or secret
material must not be placed in global JSON state, logs, status payloads, or
cross-profile caches.

## Global and Profile-Scoped APIs

Routes fall into two categories.

### Global routes

Global routes operate on machine-wide state and do not select a signer. Examples
include:

- daemon status and health;
- installation diagnostics;
- profile listing;
- host skill binding status; and
- machine-wide runtime discovery where the data is genuinely shared.

### Actor routes

Actor routes must resolve a profile context. Examples include:

- identity details and profile editing;
- wallet reads and writes;
- chain writes;
- buzz and private chat sends;
- MetaApp publishing and trusted actions;
- service publishing, calls, refunds, and ratings;
- provider operations;
- profile LLM bindings and preferred runtime state; and
- profile conversations, sessions, traces, and exports.

Existing routes that implicitly use the daemon startup home must be classified
and converted before the single daemon becomes the default.

## Background Work Ownership

The single daemon owns one background coordinator.

### Machine-wide workers

These run exactly once per daemon instance:

- the HTTP server;
- the SimpleMsg listener manager that enumerates indexed profiles;
- the SimpleMsg presence watchdog;
- profile index reconciliation;
- process health reporting;
- log rotation; and
- supervisor heartbeat integration.

### Profile workers

These run at most once per eligible profile and are keyed by profile slug or
canonical profile home:

- private-chat auto-reply dispatch and backfill;
- inbound order replay and handling;
- provider presence behavior;
- service refund synchronization;
- online service and rating cache refresh where the cache is profile-scoped;
- profile LLM runtime discovery, bindings, and execution state; and
- any later profile heartbeat or scheduled provider work.

The coordinator must reconcile its worker set when:

- a profile is created, registered, removed, or repaired;
- a profile configuration enabling background behavior changes;
- provider presence changes;
- an LLM binding or runtime preference changes in a way that requires refresh;
  or
- the daemon starts after downtime.

A failure in one profile worker must not terminate the daemon or stop workers
for other profiles. Failures must be logged with a profile slug but without
secrets or private message content.

## Concurrency and Signing Safety

Moving to one process must preserve profile isolation at mutation boundaries.

- Chain and wallet writes use the signer from the resolved actor context.
- Profile runtime state writes use that profile's store.
- Profile-scoped mutation locks remain keyed by canonical profile home.
- Operations that may spend from the same profile must be serialized or use the
  existing chain adapter's safe UTXO coordination.
- No fallback to the daemon's startup profile is allowed after explicit actor
  resolution fails.
- A response and local UI URL must preserve the selected actor where the page
  requires actor context.

The migration must add cross-profile tests that run concurrent operations for
two profiles and prove that state, signer selection, and results do not cross.

## Lifecycle and Health Contract

### Health checks

Daemon health checks must have a short hard timeout. A live PID is not proof of
a healthy daemon.

A healthy daemon must prove:

- the TCP endpoint accepts requests;
- `/api/daemon/status` completes within the timeout;
- the returned instance ID and owner ID match the global daemon record; and
- the runtime version is compatible with the invoking CLI.

### Start reconciliation

Startup must reconcile the global record, lock, PID, port, and HTTP identity as
one ownership set. It must distinguish:

- healthy owned daemon;
- dead process with stale state;
- live owned process with an unhealthy endpoint;
- port occupied by an unrelated process;
- lock owner mismatch; and
- incompatible installed runtime.

Recovery may terminate a process only after ownership is proven from multiple
signals. PID existence alone is insufficient because PIDs can be reused.

### Stop semantics

A successful stop means all of the following are true:

- the owned daemon received graceful termination;
- the process exited;
- the selected daemon port was released;
- the global lock was removed or safely quarantined; and
- the matching daemon record was removed.

If graceful termination exceeds its deadline, a verified owned process may be
force-terminated. Failure to prove ownership must return an actionable error
instead of killing the process.

### Logging

The installed daemon must not run with discarded stdout and stderr. It must
write bounded, rotating local logs under `~/.metabot/runtime/logs/`.

Logs may contain:

- timestamps;
- process and instance identifiers;
- lifecycle transitions;
- route or worker categories;
- profile slugs when needed for diagnosis; and
- sanitized error codes and messages.

Logs must not contain mnemonics, private keys, provider tokens, decrypted
private messages, raw sensitive request bodies, or signed transaction material.

## Process Supervision

The canonical installed runtime is supervised by the operating system.

### macOS

The first implementation uses one user LaunchAgent with:

- a stable service label;
- `RunAtLoad`;
- restart-on-exit behavior with backoff;
- an absolute path to the versioned installed runtime, never a worktree;
- stdout and stderr directed to bounded OAC log handling; and
- explicit production instance and port configuration.

Because `KeepAlive` cannot detect a live but unresponsive process, an external
health watchdog must trigger verified recovery when HTTP health fails.

### Other platforms

Linux should use a systemd user service with equivalent ownership and restart
semantics. Windows supervision requires a separate platform design before it is
declared supported.

The CLI management surface should eventually provide:

```text
oac daemon service install
oac daemon service status
oac daemon service restart
oac daemon service uninstall
```

Exact command naming may be finalized in the implementation plan, but service
installation and daemon runtime behavior must remain separate concepts.

## CLI and Runtime Version Ownership

The installed daemon is owned by the installed OAC runtime, not by whichever
host invokes the CLI most recently.

- A host-specific invocation must not replace the daemon entrypoint.
- A source checkout must not rewrite the installed production shim.
- A runtime fingerprint mismatch must not cause an arbitrary CLI binary to kill
  and replace a healthy supervised daemon.
- Version mismatch should return compatibility information and direct the
  installed service manager to perform a controlled update or restart.
- Release and production service updates continue to come only from `main`.

## Migration Contract

The migration changes only ephemeral daemon process metadata and daemon
ownership. It must not rewrite profile identities, secrets, balances,
conversations, services, traces, LLM bindings, persona files, or chain state.

### Preconditions

Before migration, the updater must:

1. resolve the MetaBot root from the real system home;
2. read the manager profile index without rebuilding it by directory scan;
3. enumerate the indexed profiles' legacy `daemon.json` and
   `locks/daemon.lock` files;
4. inspect live daemon processes, entrypoints, ports, and HTTP owner IDs;
5. select `10001` or, only when it is owned by an unrelated process, persist
   the first free port in the defined fallback range before starting a daemon;
   and
6. record a sanitized migration snapshot under
   `~/.metabot/runtime/recovery/migration.json`.

### Legacy daemon shutdown

For each indexed profile:

1. If no legacy daemon metadata exists, continue.
2. If the recorded process is dead, quarantine stale daemon metadata.
3. If a healthy legacy OAC daemon owns the record, request graceful shutdown
   and wait for process exit, port release, and lock cleanup.
4. If the process is alive but unhealthy, verify executable and owner evidence
   before termination.
5. If ownership cannot be proven, stop migration and report the profile, PID,
   port, record path, and safe manual next step.

Migration must never kill an arbitrary process solely because its PID appears
in a stale JSON or lock file.

### Global daemon activation

After all verified legacy daemons have stopped:

1. create the global runtime directories;
2. install or update the stable production CLI shim;
3. install the supervisor configuration;
4. start one daemon on the selected loopback port;
5. verify daemon identity and version;
6. verify that all indexed profiles are visible;
7. verify that each eligible profile has exactly one background worker set; and
8. remove or quarantine legacy per-profile daemon records and daemon locks.

The migration is not complete merely because the selected port is listening.

### Interrupted migration

The migration journal must make every stage repeatable. Re-running migration
after interruption must safely resume from the observed process and filesystem
state rather than assuming the previous step completed.

At no stage may two production daemon generations operate concurrently against
the same MetaBot root.

### Rollback

Rollback is allowed before the new version performs an incompatible profile
data migration. This design does not require such a data migration.

Rollback must:

1. stop and verify removal of the global daemon;
2. remove or disable its supervisor entry;
3. restore the prior installed CLI entrypoint;
4. leave all profile data untouched; and
5. allow the prior runtime to recreate ephemeral per-profile daemon records if
   it is started again.

The sanitized migration snapshot may be retained for diagnosis. It must not
contain secrets.

## Implementation Sequence

Implementation begins only after this design is approved.

### Phase 1: Shared lifecycle correctness

- Add bounded daemon health probes.
- Make stop wait for process exit, port release, lock cleanup, and state cleanup.
- Add safe ownership verification and stale-state quarantine.
- Add persistent sanitized daemon logs.
- Fix test and interrupted-run daemon cleanup.

These changes should be written so they remain useful after the global daemon
migration.

### Phase 2: Global path and actor foundations

- Extend the central path model with `~/.metabot/runtime/` paths.
- Add durable installation-level daemon endpoint configuration and discovery.
- Add the global daemon record and lock types.
- Centralize resolved profile context creation.
- Classify every daemon route as global or actor-scoped.
- Remove CLI behavior that selects a daemon from `--from`.

### Phase 3: Single daemon and background coordinator

- Start one daemon on the selected production port.
- Make actor fallback read the active-home pointer at request time.
- Convert startup-home-bound handlers to resolved actor contexts.
- Introduce one background coordinator with per-profile worker ownership.
- Prove that machine-wide listeners start once.

### Phase 4: Migration and development isolation

- Implement idempotent legacy daemon discovery and shutdown.
- Implement the one-time bounded port fallback and explicit port-migration
  path.
- Quarantine old per-profile daemon metadata.
- Change development mode to use an isolated system home and port.
- Stop development mode from rewriting the installed production shim.
- Add rollback and interrupted-migration coverage.

### Phase 5: Supervision and release integration

- Add the macOS LaunchAgent lifecycle.
- Add the external health watchdog and restart backoff.
- Add service status and management commands.
- Update install, update, uninstall, doctor, and acceptance documentation.
- Validate the release artifact from `main` through the normal release workflow.

## Verification Requirements

This migration changes shared runtime behavior, process ownership, persistence
paths, install behavior, and release artifacts. The completed implementation
requires the full repository verification policy, including:

```bash
npm run build
npm run build:skillpacks
npm test
npm run verify
npm run test:contracts
```

Implementation plans may use focused tests during development, but final
release validation must exercise the repository's canonical ordered test
scripts and a supported Node.js 20-24 runtime.

Required automated coverage includes:

- one fixed daemon URL across multiple profiles;
- `--from` selecting an actor without selecting a daemon;
- no-actor fallback following active-home changes without daemon restart;
- unknown and ambiguous actor failures before side effects;
- cross-profile signer and state isolation;
- one machine-wide listener manager;
- one worker set per eligible profile;
- profile creation and configuration reconciliation;
- healthy daemon attachment;
- dead, stale, alive-but-not-listening, and HTTP-hung recovery;
- unrelated process ownership refusal;
- default-port selection, bounded first-install fallback, and persistent
  endpoint discovery;
- refusal to move a configured installation port automatically at runtime;
- explicit port migration, including a move back to `10001`;
- reliable graceful and forced stop behavior;
- idempotent migration and interrupted migration;
- development and production instance isolation;
- supervisor restart after process exit; and
- supervisor recovery from a live but unhealthy daemon.

## Manual Acceptance Requirements

At least two real local profiles must be used for non-destructive acceptance.
No funded chain write is required merely to validate daemon topology.

Acceptance must prove:

1. only one production `daemon serve` process targets the production MetaBot
   root;
2. the selected management URL remains valid while switching the selected Bot;
3. CLI commands for two profiles return the same daemon base URL;
4. each command reads and writes only its selected profile state;
5. changing the active profile changes no-`--from` behavior without restarting
   the daemon;
6. all eligible profiles remain represented in the listener manager;
7. killing the daemon causes supervised restart on the same port;
8. an induced unhealthy endpoint is recovered without leaving stale lock or
   daemon state;
9. with an unrelated process occupying `10001`, first installation selects a
   free bounded fallback port, reports it, and preserves it after restart;
10. with an unrelated process occupying the persisted fallback port, daemon
    restart fails without selecting another port;
11. an explicit port migration can return an installation to `10001` after it
    becomes free; and
12. a development instance can run on its isolated port without changing the
   production process, shim, profiles, or URL; and
13. uninstall removes the supervisor and global daemon runtime metadata without
    deleting profile data.

## Release and Compatibility Policy

The topology migration is a shared runtime compatibility change and must ship
as one coordinated release:

- CLI, daemon, install/update logic, generated skillpack runtimes, and release
  compatibility metadata must agree on the global daemon model;
- the release must be built, tested, tagged, and published only from `main`;
- mixed old/new production runtimes against one MetaBot root are unsupported;
  and
- upgrade diagnostics must tell the user whether migration completed, requires
  safe manual action, or rolled back.

## Acceptance Criteria

This design is implemented only when all of the following are true:

1. A normal installation runs one production daemon for all indexed profiles.
2. A new installation uses `http://127.0.0.1:10001/ui/bot` when that port is
   available; otherwise it selects and permanently records one bounded
   fallback port.
3. `--from` selects only an actor and never a daemon or port.
4. Omitting `--from` uses the active profile at request time.
5. Machine-wide listeners and watchdogs run once.
6. Profile background work runs at most once per eligible profile.
7. Profile state and signing remain isolated and explicitly resolved.
8. Legacy per-profile daemons migrate idempotently without profile-data
   mutation.
9. Development and production runtimes cannot replace or supervise each other.
10. Stop, recovery, logging, and OS supervision meet the lifecycle contract.
11. No production startup silently changes its selected port or falls back to
    a random port.
12. Full automated and manual acceptance requirements pass before release.

## Review Checklist

Before implementation planning starts, reviewers should explicitly confirm:

- one normal installed daemon is the intended product topology;
- `10001` is the preferred production port and a one-time bounded fallback is
  acceptable when it is already occupied;
- selected-port persistence and explicit port migration are acceptable;
- HTTP loopback is sufficient for the first migration;
- `~/.metabot/runtime/` is the correct global process-state boundary;
- active-profile fallback is evaluated per request;
- the development instance must use isolated profile data;
- legacy daemon ownership must be proven before termination; and
- the phased migration and rollback contract is acceptable.
