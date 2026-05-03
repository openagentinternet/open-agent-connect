import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const DEFAULT_OUTPUT_ROOT = path.join(DEFAULT_REPO_ROOT, 'skillpacks');
const PRIMARY_CLI_PATH = 'metabot';
const SHARED_PACK = 'shared';
const SHARED_COMPATIBILITY_MANIFEST = 'release/compatibility.json';
const BUNDLED_COMPATIBILITY_MANIFEST = 'runtime/compatibility.json';
const SHARED_BUNDLED_CLI = 'runtime/dist/cli/main.js';
const HOST_WRAPPER_SHARED_INSTALL = 'runtime/shared-install.sh';
const HOST_WRAPPER_SHARED_SKILLS_ROOT = 'runtime/shared-skills';
const METABOT_SKILLS = [
  'metabot-ask-master',
  'metabot-identity-manage',
  'metabot-network-manage',
  'metabot-call-remote-service',
  'metabot-chat-privatechat',
  'metabot-omni-reader',
  'metabot-post-buzz',
  'metabot-post-skillservice',
  'metabot-upload-file',
  'metabot-wallet-manage',
];

const HOSTS = {
  codex: {
    displayName: 'Codex',
    defaultSkillRoot: '${CODEX_HOME:-$HOME/.codex}/skills',
  },
  'claude-code': {
    displayName: 'Claude Code',
    defaultSkillRoot: '${CLAUDE_HOME:-$HOME/.claude}/skills',
  },
  openclaw: {
    displayName: 'OpenClaw',
    defaultSkillRoot: '${OPENCLAW_HOME:-$HOME/.openclaw}/skills',
  },
};

function replaceAll(source, replacements) {
  return Object.entries(replacements).reduce(
    (text, [token, value]) => text.split(token).join(value),
    source
  );
}

function listSkills(skills) {
  return skills.map((skill) => `- \`${skill}\``).join('\n');
}

function renderHostMetadata(hostKey, host) {
  return [
    `Generated for ${host.displayName}.`,
    '',
    `- Default skill root: \`${host.defaultSkillRoot}\``,
    `- Host pack id: \`${hostKey}\``,
    `- Primary CLI path: \`${PRIMARY_CLI_PATH}\``,
  ].join('\n');
}

function renderHostAdapterSection(hostKey, host) {
  return `## Host Adapter\n\n${renderHostMetadata(hostKey, host)}`;
}

function buildSharedReadme({ packageVersion }) {
  return `# Shared MetaBot Skills for Open Agent Connect

This shared pack installs the host-neutral MetaBot skills into \`~/.metabot/skills\` and installs the primary \`${PRIMARY_CLI_PATH}\` shim into \`~/.metabot/bin\`.

## Included MetaBot Skills

${listSkills(METABOT_SKILLS)}

## Install

\`\`\`bash
./install.sh
export PATH="$HOME/.metabot/bin:$PATH"
metabot --help
metabot identity --help
\`\`\`

Override the shared skill destination with \`METABOT_SHARED_SKILL_DEST\` if you need a non-default shared root.
Override the CLI shim directory with \`METABOT_BIN_DIR\` if \`$HOME/.metabot/bin\` is not on PATH.
If you are installing from a source checkout, set \`METABOT_SOURCE_ROOT\` to the repository root.
If you already have a bundled CLI entry, set \`METABOT_CLI_ENTRY\` directly.

## Shared Runtime Contract

- Primary CLI path: \`${PRIMARY_CLI_PATH}\`
- Compatibility manifest: \`${SHARED_COMPATIBILITY_MANIFEST}\`
- Bundled compatibility copy: \`${BUNDLED_COMPATIBILITY_MANIFEST}\`
- Bundled CLI entry: \`${SHARED_BUNDLED_CLI}\`
- Package version: \`${packageVersion}\`
`;
}

function buildHostReadme({ hostKey, host, packageVersion }) {
  return `# Open Agent Connect Skill Pack for ${host.displayName}

Thin host wrapper for Open Agent Connect, the host-facing runtime for Open Agent Internet. This wrapper installs the shared MetaBot skills into \`~/.metabot/skills\`, installs the primary \`${PRIMARY_CLI_PATH}\` CLI shim, and then binds host-native \`metabot-*\` entries into the ${host.displayName} skills root.

## Included MetaBot Skills

${listSkills(METABOT_SKILLS)}

## Install

\`\`\`bash
./install.sh
export PATH="$HOME/.metabot/bin:$PATH"
metabot --help
metabot identity --help
\`\`\`

Compatibility note:

- only the \`metabot\` CLI name is installed
- shared skills land in \`~/.metabot/skills\`
- host-native bindings land in \`${host.defaultSkillRoot}\`

Override the CLI shim directory with \`METABOT_BIN_DIR\` if \`$HOME/.metabot/bin\` is not on PATH.
If you are installing from a source checkout, set \`METABOT_SOURCE_ROOT\` to the repository root.
If the current host uses a custom home, export the matching host home variable before install.

If the current host session does not immediately detect the new skills, start a fresh session.

## First Commands

\`\`\`bash
metabot identity create --name "<your chosen MetaBot name>"
metabot network services --online
metabot ui open --page hub
\`\`\`

For a local smoke test from the repository root:

\`\`\`bash
node e2e/run-local-cross-host-demo.mjs
\`\`\`

## Ask Master Smoke

The Ask Master host contract in this pack publicly supports \`manual / suggest\` lanes.

- \`manual\`: preview first with \`${PRIMARY_CLI_PATH} master ask --request-file ...\`, then confirm with \`${PRIMARY_CLI_PATH} master ask --trace-id ... --confirm\`
- \`suggest\`: ask the runtime to evaluate a stuck/risk observation with \`${PRIMARY_CLI_PATH} master suggest --request-file ...\`, then accepted suggestions follow the same preview/confirm/send path as manual asks

Public Ask Master controls:

- \`metabot config get askMaster.enabled\`
- \`metabot config set askMaster.enabled false\`
- \`metabot config get askMaster.triggerMode\`
- \`metabot config set askMaster.triggerMode suggest\`

Public release expectation:

- keep Ask Master enabled when you want the feature available
- use \`triggerMode=suggest\` when you want proactive suggestions in addition to manual ask
- manual and accepted suggest flows stay on preview/confirm before send

For a single machine dual terminal smoke, keep one provider terminal online with a published Debug Master and run the caller flow separately so you can inspect preview, confirm, and trace behavior end to end.

## Shared Runtime Contract

- Primary CLI path: \`${PRIMARY_CLI_PATH}\`
- Compatibility manifest: \`${SHARED_COMPATIBILITY_MANIFEST}\`
- Bundled compatibility copy: \`${BUNDLED_COMPATIBILITY_MANIFEST}\`
- Bundled shared installer: \`${HOST_WRAPPER_SHARED_INSTALL}\`
- Host pack id: \`${hostKey}\`
- Package version: \`${packageVersion}\`
`;
}

function buildSharedInstallScript({ sourceSkillsRelativePath, bundledCliRelativePath, bundledCompatibilityRelativePath }) {
  return `#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
SHARED_SKILL_DEST="\${METABOT_SHARED_SKILL_DEST:-$HOME/.metabot/skills}"
BIN_DIR="\${METABOT_BIN_DIR:-$HOME/.metabot/bin}"
SOURCE_ROOT="\${METABOT_SOURCE_ROOT:-}"
CLI_ENTRY="\${METABOT_CLI_ENTRY:-}"
SOURCE_SKILLS_ROOT="$SCRIPT_DIR/${sourceSkillsRelativePath}"
BUNDLED_CLI_ENTRY="$SCRIPT_DIR/${bundledCliRelativePath}"
BUNDLED_COMPATIBILITY_COPY="$SCRIPT_DIR/${bundledCompatibilityRelativePath}"

mkdir -p "$SHARED_SKILL_DEST"
mkdir -p "$BIN_DIR"

resolve_cli_entry() {
  if [ -n "$CLI_ENTRY" ] && [ -f "$CLI_ENTRY" ]; then
    return 0
  fi

  if [ -n "$SOURCE_ROOT" ] && [ -f "$SOURCE_ROOT/dist/cli/main.js" ]; then
    CLI_ENTRY="$SOURCE_ROOT/dist/cli/main.js"
    return 0
  fi

  if [ -f "$BUNDLED_CLI_ENTRY" ]; then
    CLI_ENTRY="$BUNDLED_CLI_ENTRY"
    return 0
  fi

  return 1
}

build_cli_from_source() {
  if [ -z "$SOURCE_ROOT" ]; then
    return 1
  fi

  if [ -f "$SOURCE_ROOT/package.json" ] && [ -f "$SOURCE_ROOT/tsconfig.json" ]; then
    command -v npm >/dev/null 2>&1 || {
      echo "npm is required to build the MetaBot CLI from source." >&2
      exit 1
    }
    npm --prefix "$SOURCE_ROOT" run build >/dev/null
    [ -f "$SOURCE_ROOT/dist/cli/main.js" ] || return 1
    CLI_ENTRY="$SOURCE_ROOT/dist/cli/main.js"
    return 0
  fi

  return 1
}

command -v node >/dev/null 2>&1 || {
  echo "node is required to run the MetaBot CLI." >&2
  exit 1
}

[ -d "$SOURCE_SKILLS_ROOT" ] || {
  echo "Shared MetaBot skills not found at $SOURCE_SKILLS_ROOT" >&2
  exit 1
}

if ! resolve_cli_entry; then
  build_cli_from_source || true
  resolve_cli_entry || {
    echo "MetaBot CLI entry not found. Set METABOT_SOURCE_ROOT or METABOT_CLI_ENTRY before running install.sh." >&2
    exit 1
  }
fi

for skill_dir in "$SOURCE_SKILLS_ROOT"/*; do
  [ -d "$skill_dir" ] || continue
  skill_name="$(basename "$skill_dir")"
  target_dir="$SHARED_SKILL_DEST/$skill_name"
  rm -rf "$target_dir"
  mkdir -p "$target_dir"
  cp -R "$skill_dir"/. "$target_dir"/
done

write_cli_shim() {
  local target_name="$1"
  {
    printf '%s\n' '#!/usr/bin/env bash'
    printf '%s\n' 'set -euo pipefail'
    printf 'PREFERRED_CLI_ENTRY="%s"\n' "$CLI_ENTRY"
    printf '%s\n' 'CLI_ENTRY="\${METABOT_CLI_ENTRY:-}"'
    printf '%s\n' 'if [ -n "$CLI_ENTRY" ] && [ ! -f "$CLI_ENTRY" ]; then'
    printf '%s\n' '  CLI_ENTRY=""'
    printf '%s\n' 'fi'
    printf '%s\n' 'if [ -z "$CLI_ENTRY" ] && [ -n "$PREFERRED_CLI_ENTRY" ] && [ -f "$PREFERRED_CLI_ENTRY" ]; then'
    printf '%s\n' '  CLI_ENTRY="$PREFERRED_CLI_ENTRY"'
    printf '%s\n' 'fi'
    printf '%s\n' 'if [ -z "$CLI_ENTRY" ]; then'
    printf '%s\n' '  for _f in "$HOME/.metabot/installpacks"/*/runtime/dist/cli/main.js; do'
    printf '%s\n' '    [ -f "$_f" ] && CLI_ENTRY="$_f" && break'
    printf '%s\n' '  done'
    printf '%s\n' 'fi'
    printf '%s\n' '[ -f "$CLI_ENTRY" ] || {'
    printf '%s\n' '  echo "MetaBot CLI not found. Please reinstall: https://github.com/openagentinternet/open-agent-connect/releases/latest" >&2'
    printf '%s\n' '  exit 1'
    printf '%s\n' '}'
    printf '%s\n' 'exec node "$CLI_ENTRY" "$@"'
  } > "$BIN_DIR/$target_name"
  chmod +x "$BIN_DIR/$target_name"
}

write_cli_shim "${PRIMARY_CLI_PATH}"

echo "Installed shared MetaBot skills to $SHARED_SKILL_DEST"
echo "Installed primary CLI shim to $BIN_DIR/${PRIMARY_CLI_PATH}"
echo "Primary CLI path: ${PRIMARY_CLI_PATH}"
echo "Compatibility manifest: ${SHARED_COMPATIBILITY_MANIFEST}"
echo "Bundled compatibility copy: $BUNDLED_COMPATIBILITY_COPY"
`;
}

function buildHostInstallScript(hostKey) {
  return `#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="\${METABOT_BIN_DIR:-$HOME/.metabot/bin}"
SHARED_INSTALL="$SCRIPT_DIR/${HOST_WRAPPER_SHARED_INSTALL}"

[ -f "$SHARED_INSTALL" ] || {
  echo "Bundled shared installer not found at $SHARED_INSTALL" >&2
  exit 1
}

"$SHARED_INSTALL"

METABOT_BIN="$BIN_DIR/${PRIMARY_CLI_PATH}"
[ -x "$METABOT_BIN" ] || {
  echo "Expected installed CLI shim at $METABOT_BIN" >&2
  exit 1
}

"$METABOT_BIN" host bind-skills --host ${hostKey}

echo "Bound shared MetaBot skills into the ${hostKey} host root"
`;
}

async function readTemplate(repoRoot, relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), 'utf8');
}

async function writeFile(filePath, content, executable = false) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
  if (executable) {
    await fs.chmod(filePath, 0o755);
  }
}

function replaceNarrativeTerms(source) {
  return source;
}

function renderSourceSkill(source, { mode, hostKey, host, templates }) {
  const renderedTemplates = {
    confirmationContract: replaceAll(templates.confirmationContract, {
      '{{METABOT_CLI}}': PRIMARY_CLI_PATH,
    }),
    systemRouting: replaceAll(templates.systemRouting, {
      '{{METABOT_CLI}}': PRIMARY_CLI_PATH,
    }),
  };

  const hostAdapterSection = mode === 'host' && hostKey && host
    ? renderHostAdapterSection(hostKey, host)
    : '';

  return replaceAll(source, {
    '{{METABOT_CLI}}': PRIMARY_CLI_PATH,
    '{{COMPATIBILITY_MANIFEST}}': SHARED_COMPATIBILITY_MANIFEST,
    '{{HOST_ADAPTER_SECTION}}': hostAdapterSection,
    '{{SYSTEM_ROUTING}}': renderedTemplates.systemRouting,
    '{{CONFIRMATION_CONTRACT}}': renderedTemplates.confirmationContract,
  });
}

async function renderSkill({
  repoRoot,
  legacySkillName,
  mode,
  hostKey,
  host,
  templates,
}) {
  const sourcePath = path.join(repoRoot, 'SKILLs', legacySkillName, 'SKILL.md');
  const source = await fs.readFile(sourcePath, 'utf8');
  const renderedSource = replaceNarrativeTerms(source);
  const rendered = renderSourceSkill(renderedSource, {
    mode,
    hostKey,
    host,
    templates,
  });
  return replaceNarrativeTerms(rendered);
}

async function renderSharedSkill(options) {
  return renderSkill({
    ...options,
    mode: 'shared',
  });
}

async function renderHostSkill(options) {
  return renderSkill({
    ...options,
    mode: 'host',
  });
}

async function collectBundledRuntimeDependencies(repoRoot) {
  const packageJson = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  const packageLock = JSON.parse(await fs.readFile(path.join(repoRoot, 'package-lock.json'), 'utf8'));
  const packages = packageLock?.packages ?? {};
  const queue = Object.keys(packageJson.dependencies || {});
  const seen = new Set();

  while (queue.length > 0) {
    const dependencyName = queue.shift();
    if (!dependencyName || seen.has(dependencyName)) {
      continue;
    }

    const packageLockEntry = packages[`node_modules/${dependencyName}`];
    if (!packageLockEntry) {
      throw new Error(`Missing package-lock entry for runtime dependency: ${dependencyName}`);
    }

    seen.add(dependencyName);
    for (const nestedDependencyName of Object.keys(packageLockEntry.dependencies || {})) {
      if (!seen.has(nestedDependencyName)) {
        queue.push(nestedDependencyName);
      }
    }
  }

  return [...seen].sort();
}

async function copyBundledRuntimeDependencies(repoRoot, runtimeRoot, dependencyNames) {
  const bundledNodeModulesRoot = path.join(runtimeRoot, 'node_modules');
  await fs.rm(bundledNodeModulesRoot, { recursive: true, force: true });
  await fs.mkdir(bundledNodeModulesRoot, { recursive: true });

  for (const dependencyName of dependencyNames) {
    const dependencyPathSegments = dependencyName.split('/');
    const sourceDependencyRoot = path.join(repoRoot, 'node_modules', ...dependencyPathSegments);
    try {
      await fs.access(sourceDependencyRoot);
    } catch {
      throw new Error(`Installed runtime dependency missing from node_modules: ${dependencyName}`);
    }
    await fs.cp(
      sourceDependencyRoot,
      path.join(bundledNodeModulesRoot, ...dependencyPathSegments),
      { recursive: true, verbatimSymlinks: true },
    );
  }
}

async function copyIfPresent(sourcePath, targetPath) {
  try {
    await fs.access(sourcePath);
  } catch {
    return false;
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.cp(sourcePath, targetPath, { recursive: true });
  return true;
}

async function copyRuntimeUiAssets(repoRoot, runtimeRoot) {
  // Copy entire src/ui/ tree into dist/ui/. tsc only emits .js/.d.ts files,
  // so static assets (.html, .css, .js in metaapps, etc.) are never written
  // to dist/ by the compiler. Copying the whole tree here ensures nothing is
  // silently omitted when new pages or metaapps are added.
  // tsc-compiled .js files land in the same paths and overwrite any same-named
  // source files — there are currently no naming conflicts.
  const sourceUiRoot = path.join(repoRoot, 'src', 'ui');
  const runtimeUiRoot = path.join(runtimeRoot, 'dist', 'ui');
  await fs.mkdir(runtimeUiRoot, { recursive: true });
  await fs.cp(sourceUiRoot, runtimeUiRoot, { recursive: true });
}

async function ensureBundledRuntime(repoRoot, runtimeRoot, compatibilityManifest, dependencyNames) {
  const builtCliEntry = path.join(repoRoot, 'dist', 'cli', 'main.js');
  try {
    await fs.access(builtCliEntry);
  } catch {
    throw new Error(
      `Expected bundled CLI entry at ${builtCliEntry}. Run \`npm run build\` before building skillpacks.`
    );
  }

  await fs.rm(path.join(runtimeRoot, 'dist'), { recursive: true, force: true });
  await fs.mkdir(runtimeRoot, { recursive: true });
  await fs.cp(path.join(repoRoot, 'dist'), path.join(runtimeRoot, 'dist'), { recursive: true });
  await copyRuntimeUiAssets(repoRoot, runtimeRoot);
  await writeFile(path.join(runtimeRoot, 'compatibility.json'), compatibilityManifest);
  await fs.cp(path.join(repoRoot, 'package.json'), path.join(runtimeRoot, 'package.json'));
  await copyBundledRuntimeDependencies(repoRoot, runtimeRoot, dependencyNames);
}

export async function buildAgentConnectSkillpacks(options = {}) {
  const repoRoot = options.repoRoot ? path.resolve(options.repoRoot) : DEFAULT_REPO_ROOT;
  const outputRoot = options.outputRoot ? path.resolve(options.outputRoot) : DEFAULT_OUTPUT_ROOT;
  const packageJson = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  const compatibilityManifest = await readTemplate(repoRoot, SHARED_COMPATIBILITY_MANIFEST);
  const templates = {
    confirmationContract: await readTemplate(repoRoot, 'skillpacks/common/templates/confirmation-contract.md'),
    systemRouting: await readTemplate(repoRoot, 'skillpacks/common/templates/system-routing.md'),
  };
  const bundledRuntimeDependencies = await collectBundledRuntimeDependencies(repoRoot);

  const hostKeys = Object.keys(HOSTS);
  const sharedRoot = path.join(outputRoot, SHARED_PACK);
  await fs.rm(sharedRoot, { recursive: true, force: true });
  await fs.mkdir(path.join(sharedRoot, 'skills'), { recursive: true });

  await writeFile(
    path.join(sharedRoot, 'README.md'),
    buildSharedReadme({
      packageVersion: packageJson.version,
    })
  );
  await writeFile(
    path.join(sharedRoot, 'install.sh'),
    buildSharedInstallScript({
      sourceSkillsRelativePath: 'skills',
      bundledCliRelativePath: SHARED_BUNDLED_CLI,
      bundledCompatibilityRelativePath: BUNDLED_COMPATIBILITY_MANIFEST,
    }),
    true,
  );
  await ensureBundledRuntime(
    repoRoot,
    path.join(sharedRoot, 'runtime'),
    compatibilityManifest,
    bundledRuntimeDependencies,
  );

  const sharedRenderedSkills = new Map();
  for (const legacySkillName of METABOT_SKILLS) {
    const renderedSharedSkill = await renderSharedSkill({
      repoRoot,
      legacySkillName,
      templates,
    });
    sharedRenderedSkills.set(legacySkillName, renderedSharedSkill);
    await writeFile(path.join(sharedRoot, 'skills', legacySkillName, 'SKILL.md'), renderedSharedSkill);
  }

  for (const hostKey of hostKeys) {
    const host = HOSTS[hostKey];
    const hostRoot = path.join(outputRoot, hostKey);
    await fs.rm(hostRoot, { recursive: true, force: true });
    await fs.mkdir(hostRoot, { recursive: true });

    await writeFile(
      path.join(hostRoot, 'README.md'),
      buildHostReadme({
        hostKey,
        host,
        packageVersion: packageJson.version,
      })
    );
    await writeFile(path.join(hostRoot, 'install.sh'), buildHostInstallScript(hostKey), true);
    await writeFile(
      path.join(hostRoot, HOST_WRAPPER_SHARED_INSTALL),
      buildSharedInstallScript({
        sourceSkillsRelativePath: 'shared-skills',
        bundledCliRelativePath: 'dist/cli/main.js',
        bundledCompatibilityRelativePath: 'compatibility.json',
      }),
      true,
    );
    await ensureBundledRuntime(
      repoRoot,
      path.join(hostRoot, 'runtime'),
      compatibilityManifest,
      bundledRuntimeDependencies,
    );

    for (const legacySkillName of METABOT_SKILLS) {
      await writeFile(
        path.join(hostRoot, HOST_WRAPPER_SHARED_SKILLS_ROOT, legacySkillName, 'SKILL.md'),
        sharedRenderedSkills.get(legacySkillName)
      );
    }

  }

  return {
    outputRoot,
    sharedPack: SHARED_PACK,
    hosts: hostKeys,
    cliPath: PRIMARY_CLI_PATH,
    cliAliases: [],
    compatibilityManifest: SHARED_COMPATIBILITY_MANIFEST,
  };
}

export async function buildMetabotSkillpacks(options = {}) {
  return buildAgentConnectSkillpacks(options);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const result = await buildAgentConnectSkillpacks();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
