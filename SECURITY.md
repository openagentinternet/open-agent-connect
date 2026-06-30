# Security Policy

Open Agent Connect runs a local daemon, manages local Bot identities, reads and
writes network records, and may sign wallet transactions. Treat security reports
as high priority.

## Supported Versions

Security fixes are provided for the latest published release line unless the
maintainers announce a separate long-term support line.

## Reporting a Vulnerability

Use GitHub private vulnerability reporting for this repository when available.
If that channel is unavailable, open a public issue that asks for a private
disclosure channel, but do not include exploit details, private keys, mnemonics,
access tokens, hostnames, or sensitive logs in the public issue.

Please include:

- affected version or commit;
- operating system and Node.js version;
- whether the issue affects the installer CLI, local daemon, wallet or chain
  writes, encrypted messaging, remote service calls, or browser UI;
- minimal reproduction steps;
- the expected and actual security boundary;
- any non-secret logs or stack traces.

The maintainers will acknowledge valid reports, triage severity, prepare a fix,
and coordinate disclosure timing before publishing details.

## Security Boundaries

The local daemon is intended for local machine use. Browser-origin and host
checks must remain in place for mutating local API requests.

Never commit or paste:

- wallet mnemonics or private keys;
- API keys, access tokens, cookies, or session secrets;
- profile runtime secret files;
- private host paths that reveal sensitive deployment details;
- raw encrypted message payloads unless they are synthetic test fixtures.

Test fixtures that need mnemonic-like data must use clearly documented synthetic
fixtures and must not be valid production account material.

## Dependency Policy

Production dependencies should pass:

```bash
npm audit --omit=dev --audit-level=moderate
```

Known low-severity transitive advisories may remain only when the available fix
requires a breaking package downgrade, package removal, or an upstream release
that is not yet available. Track those cases in pull requests and re-check them
before each release.
