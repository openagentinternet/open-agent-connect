# MetaBot Skill-Service Conversational Publish Design

Date: 2026-05-15
Status: Approved design for implementation planning

## Context

`metabot-post-skillservice` currently documents the low-level payload-file publishing flow. The installed copy at `/Users/tusm/.metabot/skills/metabot-post-skillservice/SKILL.md` is older than the repository source skill at `skillpacks/shared/skills/metabot-post-skillservice/SKILL.md`. The repository source already knows about `--from <bot-slug>` and `metabot services skills --from <bot-slug>`, while the installed copy still reads like a manual JSON example.

The publish UI already implements the desired product semantics: the user selects one local MetaBot, the UI lists only that MetaBot's primary runtime skills, and publishing writes through the same service publish handler. This skill update should teach an agent to drive that same flow through conversation without changing CLI behavior.

## Goal

Make `metabot-post-skillservice` behave as a conversational publish assistant. In a chat session, the agent should gather the required service fields, discover the correct local MetaBot and primary runtime skill, prepare the payload, upload or reuse the service icon when requested, show a final preview, ask for explicit confirmation, and then publish the service.

## Non-Goals

- Do not change the `metabot` CLI.
- Do not add a runtime picker. Runtime selection remains part of MetaBot configuration, not service publishing.
- Do not list fallback runtime skills or skills from unrelated platform roots.
- Do not publish on-chain before the user confirms the final payload and command.
- Do not make DOGE file uploads appear supported. DOGE can be used for the service record write, but dependent file upload does not support DOGE.

## Source Files

Implementation should update both skill copies:

- `skillpacks/shared/skills/metabot-post-skillservice/SKILL.md`
- `/Users/tusm/.metabot/skills/metabot-post-skillservice/SKILL.md`

The repository source is the canonical copy. The installed copy is updated so the user can test the new behavior immediately in the current local environment.

## Conversational Publish Flow

The skill should treat "publish/register a skill service" as a guided workflow rather than asking the user to hand-author JSON.

1. Discover local provider candidates.
   - Run `metabot identity who --json` to identify the active default MetaBot.
   - Run `metabot identity list --json` or `metabot bot list --json` to list other local MetaBots.
   - Summarize the default and alternatives, then ask the user to confirm or choose the provider MetaBot.

2. Discover publishable skills for the selected MetaBot.
   - Run `metabot services skills --from <bot-slug> --json`.
   - Present only skills returned by that command.
   - Explain runtime availability errors directly when the command fails.
   - Do not manually scan skill folders or include fallback runtime skills.

3. Collect service metadata through short questions.
   - `providerSkill`: selected from primary runtime skills.
   - `displayName`: human-facing service name.
   - `serviceName`: stable service identifier. Offer a default like `<providerSkill>-service`.
   - `description`: buyer-facing description of the service result.
   - `price`: non-negative decimal string.
   - `currency`: one of `BTC`, `SPACE`, `DOGE`, or `BTC-OPCAT`.
   - `outputType`: one of `text`, `image`, `video`, `audio`, or `other`.

4. Resolve the service icon.
   - If the user provides an existing `metafile://...` URI, put it directly in `serviceIconUri`.
   - If the user provides a local image path, use `metabot-upload-file` to upload it first, then put the returned `metafile://<pinid>` in `serviceIconUri`.
   - If no icon is requested, omit `serviceIconUri`.

5. Resolve the write chain.
   - If the user explicitly names MVC, BTC, DOGE, or OPCAT for the service record, pass the matching `--chain` flag.
   - Otherwise omit `--chain` and use the selected profile's configured default write network.
   - Use `metabot config get chain.defaultWriteNetwork` only when the user asks what the default is or when the agent wants to clarify the preview.

6. Preview before publishing.
   - Write the payload JSON to a temporary or task-local file.
   - Show the final JSON and exact command:
     `metabot services publish --from <bot-slug> --payload-file <path> [--chain <chain>]`
   - Ask for explicit confirmation before running the command.
   - Treat anything other than clear confirmation as a pause or request for edits.

7. Publish and report.
   - Run the publish command only after confirmation.
   - On success, report `servicePinId`, `sourceServicePinId`, `txids`, `network`, and `displayName` when present.
   - On failure, stop and surface the exact failure code and message.
   - On `manual_action_required`, surface the local UI URL and wait.

## Existing Lifecycle Commands

The current provider-owned service lifecycle instructions should remain available, but they should be secondary to the guided publish flow:

- `metabot services owned list --from <bot-slug>`
- `metabot services owned orders --from <bot-slug> --service-id <service-pin-id>`
- `metabot services owned modify --from <bot-slug> --payload-file <file>`
- `metabot services owned revoke --from <bot-slug> --service-id <service-pin-id>`
- `metabot services refunds list --from <bot-slug> --received`
- `metabot services orders inspect --from <bot-slug> --order-id <order-id>`
- `metabot services refunds settle --from <bot-slug> --order-id <order-id>`

## Testing

Use focused verification because this is a skill documentation change:

1. Check that both edited skill files contain the conversational flow, confirmation gate, `services skills --from`, and icon handling rules.
2. Run `npm run build:skillpacks` if the source skill is expected to regenerate or validate shared skillpack output.
3. Run the targeted skillpack test that verifies `metabot-post-skillservice` content, currently `tests/skillpacks/buildSkillpacks.test.mjs`.
4. Optionally run a dry conversational walkthrough without executing the final publish command.

