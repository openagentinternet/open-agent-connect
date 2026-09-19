---
name: metabot-media
description: Use when a human or agent needs to understand an image, video, or audio file — describe/OCR a picture, summarize a video, or transcribe an audio recording (看图/识图/转录) — especially when the current model is not multimodal or cannot access the media. Backed by the MetaID free LLM relay with a per-identity daily quota. Do not use this skill for uploading files to the chain.
---

# Media Understanding

Describe images, videos, and audio through the MetaID assist relay
(`/v2/assist/llm/vision/recognize`) — the relay's VLM/ASR reads the media and
the command returns plain text, so it works regardless of whether the current
model is multimodal. This is owner-scoped (no `--from`): the relay key is
bootstrapped by the machine-wide owner identity, like traffic, and cached in
`~/.metabot/owner/llm-relay.json`.

## Host Adapter

Generated for ZCode.

- Default skill root: `$HOME/.zcode/skills`
- Host pack id: `zcode`
- Primary CLI path: `$HOME/.metabot/bin/metabot`

## Routing

Route natural-language intent through `$HOME/.metabot/bin/metabot`, then reason over the returned JSON envelope.

- Prefer JSON and local daemon routes for agent workflows.
- Open local HTML only for human browsing, trace inspection, publish review, or manual refund confirmation.
- Treat MetaWeb as the network layer and the local host as a thin adapter.


## Actor Selection

`media describe` has no `--from` flag — it runs against the machine's owner
identity and its daily quota. Do not pick a Bot actor for this command.

## Trigger Guidance

Should trigger when:

- The user asks what is in an image, a video, or an audio file
  (这张图里有什么/这段音频说了什么).
- A workflow needs OCR text from a screenshot or transcription of a
  recording and the current model cannot see/hear it directly.

Should not trigger when:

- The user wants to upload or publish a file (`metabot-upload-file`,
  `metabot-post-buzz`).

## Command

```bash
$HOME/.metabot/bin/metabot media describe <image|video|audio> --path <file-or-url> [--question <text>]
```

- `--path` (alias `--source`) — **required**. Images and videos need an
  absolute local file path; audio also accepts an `http(s)://` URL or a
  `data:` URI.
- `--question` (alias `--prompt`, audio-flavored) — optional focus for the
  description or transcription instruction; `--question` wins if both are
  given.

Examples:

```bash
$HOME/.metabot/bin/metabot media describe image --path /abs/path/screenshot.png --question "Extract the error code"
$HOME/.metabot/bin/metabot media describe audio --path https://example.com/voicemail.mp3
```

## Behavior Notes

- **Image**: description + OCR text.
- **Video**: summary + timeline + frame text; clips over ~3 minutes are
  truncated; non-mp4/oversized inputs need the system ffmpeg.
- **Audio**: transcription with a spelled-letter stabilization pass —
  letter-by-letter spellings (codes, addresses) are re-confirmed, and
  uncertain runs are flagged `[low-confidence]` instead of silently guessed.
- The result reports `remainingToday` — the separate per-identity daily
  media quota (not the chat token quota). Mention remaining units when the
  quota is nearly exhausted.

## Error Handling

- `media_describe_failed` — the relay refused or failed; the message is the
  stable relay error. Daily quota exhausted means the media was NOT read —
  say so plainly and offer to retry tomorrow. Rate-limited means wait about
  a minute and retry once.
- `invalid_argument` — the kind must be `image`, `video`, or `audio`, and
  image/video paths must be absolute local paths.

## In Scope

- Describe/transcribe local (and for audio, remote) media; OCR; quota-aware
  retry guidance.

## Out of Scope

- File upload/publishing, chain writes, media editing.

## Handoff To

- `metabot-upload-file` to publish the media on-chain afterwards.
- `metabot-knowledge-base` to save a transcription as searchable knowledge.

## Compatibility

- CLI path: `$HOME/.metabot/bin/metabot`
- Compatibility manifest: `release/compatibility.json`
