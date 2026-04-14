{{FRONTMATTER}}

# Open Agent Connect Runtime Resolve Shim

## Host Adapter

{{HOST_SKILLPACK_METADATA}}

## Runtime Resolve Contract

This installed skill is a runtime-resolve shim for `{{SKILL_NAME}}`.
Do not assume this packaged markdown is the final contract.

Resolve the live contract for this host before execution:

```bash
{{METABOT_CLI}} skills resolve --skill {{SKILL_NAME}} --host {{HOST_KEY}} --format markdown
```

Follow the resolved contract exactly after command output is returned.
If resolve fails, surface the error and stop instead of guessing behavior.

## Compatibility

- Primary CLI path: `{{METABOT_CLI}}`
- Compatibility manifest: `{{COMPATIBILITY_MANIFEST}}`
