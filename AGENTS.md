# Agent Instructions

- Commit once for every round of modifications.
- For every commit, use the `metabot-post-buzz` skill to post a detailed development diary of that round's changes on-chain.
- All documentation, SKILL documents, and code comments must be written in English.
- When spawning review or test subagents, default to model `gpt-5.4`.
- Do not use `gpt-5.1-codex-mini` for review/test subagents unless the user explicitly asks for it.
- Prefer small, frequent commits. Commit each independent, verifiable unit of work as soon as it is complete.
- For every modification or newly added feature, create one commit.
- Before committing, make sure the relevant local tests or verification steps pass for your changes.
- When merging completed work into `main`, use `git merge --no-ff` to preserve the feature merge point.
