#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');

const SUPPORTED_HOSTS = new Set(['codex', 'claude-code', 'openclaw']);

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function normalizeString(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeString(item)).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => normalizeString(item))
      .filter(Boolean);
  }
  return [];
}

function uniqueArray(values) {
  return [...new Set(values.filter(Boolean))];
}

function slugify(value) {
  const raw = normalizeString(value);
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function isWithin(parent, child) {
  const rel = path.relative(parent, child);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function isSamePath(left, right) {
  return path.resolve(left) === path.resolve(right);
}

function resolveHomeDir() {
  return normalizeString(process.env.HOME) || normalizeString(process.env.USERPROFILE);
}

function resolveSharedSkillsRoot() {
  const envRoot = normalizeString(process.env.METABOT_SHARED_SKILL_DEST)
    || normalizeString(process.env.METABOT_SKILLS_ROOT)
    || normalizeString(process.env.SKILLS_ROOT);
  if (envRoot) return path.resolve(envRoot);
  const homeDir = resolveHomeDir();
  if (!homeDir) {
    throw new Error('HOME is required when payload.targetRoot is not provided.');
  }
  return path.resolve(homeDir, '.metabot', 'skills');
}

function resolveTemplatePath() {
  return path.join(__dirname, '..', 'assets', 'wiki-skill', 'scripts', 'index.js.template');
}

function resolveRuntimeAssetDir() {
  return path.join(__dirname, '..', 'assets', 'metabot-llm-wiki-runtime');
}

function resolveTemplateSchemaPath() {
  return path.join(resolveRuntimeAssetDir(), 'references', 'payload-schema-v1.json');
}

function resolveSkillDir(root, skillName) {
  return path.join(root, skillName);
}

function resolveHostSkillRoot(hostId) {
  const homeDir = resolveHomeDir();
  if (hostId === 'codex') {
    const hostHome = normalizeString(process.env.CODEX_HOME) || (homeDir ? path.join(homeDir, '.codex') : '');
    return hostHome ? path.resolve(hostHome, 'skills') : '';
  }
  if (hostId === 'claude-code') {
    const hostHome = normalizeString(process.env.CLAUDE_HOME) || (homeDir ? path.join(homeDir, '.claude') : '');
    return hostHome ? path.resolve(hostHome, 'skills') : '';
  }
  if (hostId === 'openclaw') {
    const hostHome = normalizeString(process.env.OPENCLAW_HOME) || (homeDir ? path.join(homeDir, '.openclaw') : '');
    return hostHome ? path.resolve(hostHome, 'skills') : '';
  }
  return '';
}

function hostLooksActive(hostId) {
  const root = resolveHostSkillRoot(hostId);
  if (!root) return false;
  if (hostId === 'codex' && normalizeString(process.env.CODEX_HOME)) return true;
  if (hostId === 'claude-code' && normalizeString(process.env.CLAUDE_HOME)) return true;
  if (hostId === 'openclaw' && normalizeString(process.env.OPENCLAW_HOME)) return true;
  return fs.existsSync(path.dirname(root));
}

function detectCurrentHosts() {
  return ['codex', 'claude-code', 'openclaw'].filter(hostLooksActive);
}

function normalizeBindHosts(payload) {
  if (payload.bindHosts === false || payload.bindCurrentHost === false) {
    return [];
  }
  const explicit = uniqueArray([
    ...normalizeArray(payload.bindHosts),
    ...normalizeArray(payload.host),
  ]);
  if (explicit.length > 0) {
    return explicit;
  }
  return detectCurrentHosts();
}

function assertSupportedHosts(hostIds) {
  for (const hostId of hostIds) {
    if (!SUPPORTED_HOSTS.has(hostId)) {
      throw new Error(`Unsupported host for binding: ${hostId}`);
    }
  }
}

function renderSkillMarkdown(config) {
  return `---
name: ${config.skillName}
description: ${config.description}
---

# ${config.title}

This is a dedicated local Wiki skill for one fixed document source.

- raw source: \`${config.rawSourceDir}\`
- workspace: \`${config.workspaceRoot}\`
- private registry: \`${config.registryHome}\`
- shared skill path: \`${config.skillDir}\`

## Command

\`\`\`bash
node "${path.join(config.skillDir, 'scripts', 'index.js')}" --payload '<JSON>'
\`\`\`

## Actions

- \`init\`
- \`ingest\`
- \`index\`
- \`absorb\`
- \`query\`
- \`wiki_build\`
- \`bundle_zip\`
- \`publish_zip\`
- \`publish_snapshot\`
- \`publish_all\`

## Operating Contract

- \`absorb\`, \`ingest\`, \`index\`, publishing, and build actions mirror \`rawSourceDir\` into the skill workspace before they work.
- Normal \`query\` reads the existing local index and does not mirror raw files or rebuild indexes by default.
- After the source documents change, run \`absorb\` before using \`query\`.
- If a user explicitly needs update-and-query behavior, pass \`autoAbsorb:true\` or \`refresh:true\` to \`query\`.
- The generated HTML wiki, ZIP bundle, and snapshot manifest are handled by the embedded wiki runtime under this skill directory.
`;
}

function renderWikiConfig(config) {
  return {
    skillName: config.skillName,
    title: config.title,
    description: config.description,
    kbId: config.kbId,
    aliases: config.aliases,
    rawSourceDir: config.rawSourceDir,
    workspaceRoot: config.workspaceRoot,
    registryHome: config.registryHome,
    siteTitle: config.siteTitle,
    language: config.language,
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
    queryAutoAbsorb: false,
    embeddingEnabled: config.embeddingEnabled,
    embeddingProvider: config.embeddingProvider,
    embeddingModel: config.embeddingModel,
    embeddingCommand: config.embeddingCommand,
    searchBackend: config.searchBackend,
    lexicalWeight: config.lexicalWeight,
    vectorWeight: config.vectorWeight,
    phraseWeight: config.phraseWeight,
  };
}

function ensureNoOverlap(sourceRawDir, skillDir) {
  const resolvedSource = path.resolve(sourceRawDir);
  const resolvedSkillDir = path.resolve(skillDir);
  if (resolvedSource === resolvedSkillDir) {
    throw new Error('rawSourceDir cannot be the same as the generated skill directory.');
  }
  if (isWithin(resolvedSkillDir, resolvedSource) || isWithin(resolvedSource, resolvedSkillDir)) {
    throw new Error('rawSourceDir must not live inside the generated skill directory tree.');
  }
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Payload must be a JSON object.');
  }

  const rawSourceDir = normalizeString(payload.rawSourceDir);
  if (!rawSourceDir) {
    throw new Error('payload.rawSourceDir is required.');
  }
  if (!fs.existsSync(rawSourceDir) || !fs.statSync(rawSourceDir).isDirectory()) {
    throw new Error(`payload.rawSourceDir must point to an existing directory: ${rawSourceDir}`);
  }

  const rawSkillName = normalizeString(payload.skillName || payload.name);
  if (!rawSkillName) {
    throw new Error('payload.skillName is required.');
  }

  const skillName = slugify(rawSkillName);
  if (!skillName) {
    throw new Error('payload.skillName must contain letters or numbers.');
  }

  const description = normalizeString(payload.description);
  if (!description) {
    throw new Error('payload.description is required.');
  }

  const bindHosts = normalizeBindHosts(payload);
  assertSupportedHosts(bindHosts);

  const title = normalizeString(payload.title) || skillName;
  const aliases = normalizeArray(payload.aliases);
  const kbId = normalizeString(payload.kbId) || skillName;
  const targetRoot = path.resolve(normalizeString(payload.targetRoot) || resolveSharedSkillsRoot());
  const skillDir = resolveSkillDir(targetRoot, skillName);
  const workspaceRoot = path.resolve(normalizeString(payload.workspaceRoot) || path.join(skillDir, 'workspace'));
  const registryHome = path.resolve(normalizeString(payload.registryHome) || path.join(skillDir, '.wiki-home'));
  const siteTitle = normalizeString(payload.siteTitle) || title;
  const language = normalizeString(payload.language) || 'zh-CN';

  ensureNoOverlap(rawSourceDir, skillDir);

  return {
    skillName,
    title,
    description,
    kbId,
    aliases,
    rawSourceDir: path.resolve(rawSourceDir),
    targetRoot,
    skillDir,
    workspaceRoot,
    registryHome,
    siteTitle,
    language,
    bindHosts,
    overwrite: payload.overwrite === true,
    overwriteHostBinding: payload.overwriteHostBinding === true || payload.overwrite === true,
    chunkSize: Number.isFinite(Number(payload.chunkSize)) ? Number(payload.chunkSize) : 1200,
    chunkOverlap: Number.isFinite(Number(payload.chunkOverlap)) ? Number(payload.chunkOverlap) : 180,
    embeddingEnabled: payload.embeddingEnabled !== false,
    embeddingProvider: ['local-hashing-v1', 'command-json-v1'].includes(normalizeString(payload.embeddingProvider).toLowerCase())
      ? normalizeString(payload.embeddingProvider).toLowerCase()
      : 'local-hashing-v1',
    embeddingModel: normalizeString(payload.embeddingModel) || 'local-hashing-v1',
    embeddingCommand: normalizeString(payload.embeddingCommand),
    searchBackend: ['auto', 'hybrid', 'portable', 'sqlite', 'sqlite-fts', 'scan', 'vector'].includes(normalizeString(payload.searchBackend).toLowerCase())
      ? normalizeString(payload.searchBackend).toLowerCase()
      : 'hybrid',
    lexicalWeight: Number.isFinite(Number(payload.lexicalWeight)) ? Number(payload.lexicalWeight) : 0.55,
    vectorWeight: Number.isFinite(Number(payload.vectorWeight)) ? Number(payload.vectorWeight) : 0.35,
    phraseWeight: Number.isFinite(Number(payload.phraseWeight)) ? Number(payload.phraseWeight) : 0.10,
  };
}

function copyTextFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function copyRuntimeAsset(targetDir) {
  const runtimeSource = resolveRuntimeAssetDir();
  if (!fs.existsSync(path.join(runtimeSource, 'scripts', 'index.js'))) {
    throw new Error(`Missing embedded wiki runtime asset: ${runtimeSource}`);
  }

  fs.cpSync(runtimeSource, targetDir, {
    recursive: true,
    force: true,
    dereference: true,
  });
}

function writeGeneratedSkill(config) {
  const skillDir = config.skillDir;
  if (fs.existsSync(skillDir)) {
    if (!config.overwrite) {
      throw new Error(`Skill directory already exists: ${skillDir}`);
    }
    fs.rmSync(skillDir, { recursive: true, force: true });
  }

  fs.mkdirSync(skillDir, { recursive: true });
  fs.mkdirSync(path.join(skillDir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(skillDir, 'references'), { recursive: true });

  const templatePath = resolveTemplatePath();
  const template = fs.readFileSync(templatePath, 'utf8');
  const indexJsPath = path.join(skillDir, 'scripts', 'index.js');
  fs.writeFileSync(indexJsPath, template, 'utf8');
  fs.chmodSync(indexJsPath, 0o755);

  copyRuntimeAsset(path.join(skillDir, 'runtime', 'metabot-llm-wiki'));

  const payloadSchemaPath = resolveTemplateSchemaPath();
  copyTextFile(payloadSchemaPath, path.join(skillDir, 'references', 'payload-schema-v1.json'));

  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), renderSkillMarkdown(config), 'utf8');
  writeJson(path.join(skillDir, 'wiki.config.json'), renderWikiConfig(config));

  return {
    skillDir,
    files: [
      path.join(skillDir, 'SKILL.md'),
      path.join(skillDir, 'wiki.config.json'),
      path.join(skillDir, 'scripts', 'index.js'),
      path.join(skillDir, 'runtime', 'metabot-llm-wiki', 'scripts', 'index.js'),
      path.join(skillDir, 'references', 'payload-schema-v1.json'),
    ],
  };
}

function assertRemovableHostPath(existingPath, sourceDir, overwriteHostBinding) {
  let stat;
  try {
    stat = fs.lstatSync(existingPath);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { action: 'create' };
    }
    throw error;
  }

  if (stat.isSymbolicLink()) {
    const linkValue = fs.readlinkSync(existingPath);
    const resolvedLink = path.resolve(path.dirname(existingPath), linkValue);
    if (isSamePath(resolvedLink, sourceDir)) {
      return { action: 'already_bound' };
    }
    if (overwriteHostBinding) {
      return { action: 'replace' };
    }
    return {
      action: 'conflict',
      reason: `Existing host binding points to ${resolvedLink}.`,
    };
  }

  if (overwriteHostBinding) {
    return { action: 'replace' };
  }
  return {
    action: 'conflict',
    reason: `Existing host path is not a symlink: ${existingPath}`,
  };
}

function bindGeneratedSkill(config) {
  const bindings = [];
  const warnings = [];

  for (const hostId of config.bindHosts) {
    const hostSkillRoot = resolveHostSkillRoot(hostId);
    if (!hostSkillRoot) {
      warnings.push(`Host ${hostId} does not have a resolvable skill root.`);
      continue;
    }

    if (isSamePath(hostSkillRoot, config.targetRoot)) {
      bindings.push({
        host: hostId,
        root: hostSkillRoot,
        skillPath: config.skillDir,
        status: 'skipped_same_root',
      });
      continue;
    }

    const hostSkillPath = path.join(hostSkillRoot, config.skillName);
    const decision = assertRemovableHostPath(hostSkillPath, config.skillDir, config.overwriteHostBinding);
    if (decision.action === 'already_bound') {
      bindings.push({
        host: hostId,
        root: hostSkillRoot,
        skillPath: hostSkillPath,
        target: config.skillDir,
        status: 'already_bound',
      });
      continue;
    }
    if (decision.action === 'conflict') {
      warnings.push(decision.reason);
      bindings.push({
        host: hostId,
        root: hostSkillRoot,
        skillPath: hostSkillPath,
        target: config.skillDir,
        status: 'skipped_conflict',
        reason: decision.reason,
      });
      continue;
    }
    if (decision.action === 'replace') {
      fs.rmSync(hostSkillPath, { recursive: true, force: true });
    }

    fs.mkdirSync(hostSkillRoot, { recursive: true });
    const symlinkTarget = process.platform === 'win32'
      ? config.skillDir
      : path.relative(path.dirname(hostSkillPath), config.skillDir);
    fs.symlinkSync(symlinkTarget, hostSkillPath, process.platform === 'win32' ? 'junction' : 'dir');
    bindings.push({
      host: hostId,
      root: hostSkillRoot,
      skillPath: hostSkillPath,
      target: config.skillDir,
      status: 'bound',
    });
  }

  if (config.bindHosts.length === 0) {
    warnings.push('No active host root detected; the skill was created in the shared root but not host-bound.');
  }

  return { bindings, warnings };
}

function main() {
  const { values, positionals } = parseArgs({
    options: {
      payload: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.help) {
    process.stdout.write(
      'Usage: node scaffold-wiki-skill.js --payload \'<json>\'\n' +
      'Creates a dedicated local Wiki skill from a raw documents directory.\n'
    );
    process.exit(0);
  }

  for (const arg of positionals) {
    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  const payloadRaw = normalizeString(values.payload);
  if (!payloadRaw) {
    throw new Error('--payload is required.');
  }

  let payload;
  try {
    payload = JSON.parse(payloadRaw);
  } catch (error) {
    throw new Error(`--payload must be valid JSON: ${error.message}`);
  }

  const config = validatePayload(payload);
  ensureDir(config.targetRoot);
  const result = writeGeneratedSkill(config);
  const bindingResult = bindGeneratedSkill(config);

  process.stdout.write(
    `${JSON.stringify({
      success: true,
      message: 'Wiki skill scaffolded',
      data: {
        skillDir: result.skillDir,
        targetRoot: config.targetRoot,
        sourceRawDir: config.rawSourceDir,
        workspaceRoot: config.workspaceRoot,
        registryHome: config.registryHome,
        hostBindings: bindingResult.bindings,
        files: result.files,
      },
      warnings: bindingResult.warnings,
    }, null, 2)}\n`
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
