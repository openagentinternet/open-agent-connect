---
name: metabot-llm-wiki
description: Embedded runtime for generated local Wiki skills. It manages local registries, raw document ingestion, incremental indexes, cited queries, static wiki builds, ZIP bundles, large-file upload, and optional on-chain snapshot publication.
official: true
---

# MetaBot LLM Wiki Runtime

This runtime is embedded inside each generated Wiki skill. It is not installed as a standalone default OAC skill.

## Registry

The runtime keeps a private registry for the generated skill unless `payload.registryHome` overrides it.

- Default registry file: `<generated-skill>/.wiki-home/registry.json`
- Each registry entry includes `kbId`, `rootDir`, `title`, and `aliases`.
- When no `kbId` is provided, the runtime resolves from `payload.wiki`, `wikiName`, `project`, `projectName`, `name`, the default registry entry, or the only registered project.

## Default Flow

1. `registry_create` creates or registers a Wiki project.
2. `ingest` mirrors raw documents into the workspace.
3. `index` builds local lexical/vector/hybrid indexes.
4. `absorb` runs incremental ingest and index in one step.
5. `query` answers with citations from the local index.
6. `wiki_build` creates a static HTML wiki.
7. `publish_all` builds the site, creates a ZIP, optionally uploads it, and optionally publishes a snapshot pin.

`publish_all` runs an incremental `absorb` when the current project has no indexed documents.

## Publish Modes

Publishing is controlled by two flags:

- `uploadZip`: upload the ZIP with `metabot file upload-large`.
- `snapshotOnChain`: publish the snapshot with `metabot chain write`.

Compatibility:

- `snapshotOnChain` takes priority over the legacy `publishOnChain` flag.
- `uploadZip:true` uploads even when `zipUri` is present.
- `uploadZip:false` reuses `zipUri` or keeps a local ZIP when no public URI is provided.
- When `snapshotOnChain:true`, `zipUri` must be public. Local `file://` paths are rejected.

## Command

```bash
node "<generated-skill>/runtime/metabot-llm-wiki/scripts/index.js" --payload '<JSON>'
```

Payload shape:

```json
{
  "action": "query",
  "kbId": "metaid-wiki",
  "requestId": "req-001",
  "payload": {}
}
```

## Actions

- `registry_create`
- `registry_list`
- `registry_set_default`
- `registry_resolve`
- `registry_remove`
- `init`
- `ingest`
- `index`
- `query`
- `absorb`
- `wiki_build`
- `bundle_zip`
- `publish_zip`
- `publish_snapshot`
- `publish_all`

## Examples

Create a Wiki project and make it the default:

```json
{
  "action": "registry_create",
  "payload": {
    "title": "MetaID Wiki",
    "kbId": "metaid-wiki",
    "aliases": ["metaid", "MetaID"],
    "setDefault": true
  }
}
```

Query the default Wiki:

```json
{
  "action": "query",
  "payload": {
    "question": "What does this knowledge base say about MetaID?"
  }
}
```

Run a local publish preview:

```json
{
  "action": "publish_all",
  "payload": {
    "uploadZip": false,
    "snapshotOnChain": false
  }
}
```

Upload the ZIP and publish a snapshot:

```json
{
  "action": "publish_all",
  "payload": {
    "uploadZip": true,
    "snapshotOnChain": true
  }
}
```

## Runtime Notes

- The runtime is dependency-light and writes deterministic ZIP files without requiring a separate ZIP package.
- PDF and DOCX extraction use optional local tools when available. If those tools are missing, the runtime reports the missing parser instead of silently dropping documents.
- Upload and chain writes use the installed OAC `metabot` CLI. Set `METABOT_CLI` or `OAC_METABOT_CLI` to override the CLI path.
