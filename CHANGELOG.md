# Changelog

All notable changes to Open Agent Connect should be documented in this file.

This project follows the spirit of Keep a Changelog and uses semantic version
tags for releases.

## Unreleased

### Security

- Hardened order protocol parsing for protocol-path pin ids.
- Added local daemon request-boundary checks for host and mutating API origins.
- Added dependency overrides that remove currently fixable production critical,
  high, and moderate advisories.
- Removed the standard BIP39 test mnemonic from production source and added a
  tracked-source guard test.

### Project Governance

- Added security policy, contribution guide, code of conduct, pull request
  template, issue templates, CI, CodeQL, dependency review, and Dependabot
  configuration.
