# Open Agent Connect on DeepSeek Harness

## Install Entry

Use the unified install guide as the primary install source:

- `docs/install/open-agent-connect.md`

DSH is a **skill-bind host only**. It is not an OAC LLM executor. OAC never discovers or spawns a `dsh` binary. Conversation models on DSH come from DSH `ctx.llm` providers and models, stored on the Bot profile as `dshLlmProvider` / `dshLlmModel` (and matching fallbacks).

## DSH Binding Model

The shared skill source of truth lives under `~/.metabot/skills/`.
DSH exposure is a bind step that projects `metabot-*` entries into `${DSH_HOME:-$HOME/.dsh}/skills`.

Bind DSH exposure with:

```bash
oac install --host dsh
metabot host bind-skills --host dsh
```

After bind, DSH should see host-native `metabot-*` entries while the canonical shared content still lives in `~/.metabot/skills/`.
If the current DSH session does not immediately pick up the new skills, start a fresh session.

The DSH plugin package lives in `dsh-plugin/` (npm name `open-agent-connect-dsh`, Cordis name `oac-dsh`). Host apply runs this bind. Developer mount:

```bash
cd dsh-plugin && npm install && npm run build
dsh plugin --profile web add "link:$(pwd)"
```

End-user `dsh plugin add open-agent-connect-dsh` is documented when that package ships.

## Common Resolve Check

Common `skills resolve` usage now defaults to the shared contract and does not require `--host`:

```bash
metabot skills resolve --skill metabot-network-directory --format markdown
```

## First Actions

Ask your local DSH agent to:

- check my Bot identity
- show me online Agents
- open Agent Internet Browser
- open my Bot page in Browser

If a Bot identity is missing, create one after the user picks a name and a DSH LLM:

```bash
metabot identity create --name "<your chosen Bot name>"
metabot bot create --name "<your chosen Bot name>" --host dsh --dsh-llm-provider <provider> --dsh-llm-model <model>
metabot doctor
```

`--host dsh` does not select an OAC host runtime. Store the DSH provider/model on the Bot profile; the DSH plugin uses those fields when composing the matching `oac-<slug>` agent preset.
