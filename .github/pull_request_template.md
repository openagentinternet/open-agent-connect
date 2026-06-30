## Summary

Describe the behavior change and the user-visible outcome.

## Security Impact

State whether this touches daemon request boundaries, wallet or chain writes,
encrypted messaging, remote service calls, secrets, dependency versions, or
generated artifacts.

## Verification

- [ ] `npm run build`
- [ ] Relevant targeted tests:
- [ ] `npm run build:skillpacks` if runtime, skills, templates, or generated
      skillpacks changed
- [ ] `npm audit --omit=dev --audit-level=moderate` for dependency or release
      work

## Release Notes

Mention whether `CHANGELOG.md`, docs, or release compatibility metadata should
be updated.
