import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  getBaseSkillContract,
  listBaseSkillNames,
} = require('../../dist/core/skills/baseSkillRegistry.js');
const {
  resolveSkillContract,
  renderResolvedSkillContract,
} = require('../../dist/core/skills/skillResolver.js');

function createActiveVariantPatch(scope) {
  return {
    variantId: 'variant-network-directory-fix-1',
    skillName: 'metabot-network-directory',
    status: 'active',
    scope,
    metadata: {
      sameSkill: true,
      sameScope: true,
      scopeHash: 'scope-hash-v1',
    },
    patch: {
      instructionsPatch: 'Read the machine-first online services list before opening UI.',
      commandTemplatePatch: 'metabot network services --online --json',
      outputExpectationPatch: 'Return JSON with services[] entries suitable for remote selection.',
      fallbackPolicyPatch: 'Use UI fallback only after explicit user request or unreadable machine payload.',
    },
  };
}

test('base registry exposes metabot-network-directory', () => {
  const names = listBaseSkillNames();
  assert.ok(names.includes('metabot-network-directory'));

  const contract = getBaseSkillContract('metabot-network-directory');
  assert.equal(contract.skillName, 'metabot-network-directory');
});

test('resolver returns the base contract when the evolution network is disabled', () => {
  const base = getBaseSkillContract('metabot-network-directory');
  const resolved = resolveSkillContract({
    skillName: 'metabot-network-directory',
    evolutionNetworkEnabled: false,
    activeVariant: createActiveVariantPatch(base.scope),
    activeVariantSource: 'local',
  });

  assert.equal(resolved.source, 'base');
  assert.equal(resolved.activeVariantId, null);
  assert.equal(resolved.activeVariantSource, null);
  assert.equal(resolved.instructions, base.instructions);
  assert.equal(resolved.commandTemplate, base.commandTemplate);
});

test('resolver returns a merged contract with local origin when a local active variant exists', () => {
  const base = getBaseSkillContract('metabot-network-directory');
  const variant = createActiveVariantPatch(base.scope);
  const resolved = resolveSkillContract({
    skillName: 'metabot-network-directory',
    evolutionNetworkEnabled: true,
    activeVariant: variant,
    activeVariantSource: 'local',
  });

  assert.equal(resolved.source, 'merged');
  assert.equal(resolved.activeVariantId, variant.variantId);
  assert.equal(resolved.activeVariantSource, 'local');
  assert.equal(resolved.instructions, variant.patch.instructionsPatch);
  assert.equal(resolved.commandTemplate, variant.patch.commandTemplatePatch);
  assert.equal(resolved.outputExpectation, variant.patch.outputExpectationPatch);
  assert.equal(resolved.fallbackPolicy, variant.patch.fallbackPolicyPatch);
});

test('resolver returns a merged contract with remote origin when a remote active variant exists', () => {
  const base = getBaseSkillContract('metabot-network-directory');
  const variant = createActiveVariantPatch(base.scope);
  const resolved = resolveSkillContract({
    skillName: 'metabot-network-directory',
    evolutionNetworkEnabled: true,
    activeVariant: variant,
    activeVariantSource: 'remote',
  });

  assert.equal(resolved.source, 'merged');
  assert.equal(resolved.activeVariantId, variant.variantId);
  assert.equal(resolved.activeVariantSource, 'remote');
});

test('resolver preserves same-scope metadata when merging an active variant', () => {
  const base = getBaseSkillContract('metabot-network-directory');
  const variant = createActiveVariantPatch(base.scope);
  const resolved = resolveSkillContract({
    skillName: 'metabot-network-directory',
    evolutionNetworkEnabled: true,
    activeVariant: variant,
  });

  assert.equal(resolved.scopeMetadata.sameScope, true);
  assert.equal(resolved.scopeMetadata.scopeHash, 'scope-hash-v1');
  assert.deepEqual(resolved.scope, base.scope);
});

test('resolver degrades safely to base when active variant shape is malformed', () => {
  const malformedVariant = {
    variantId: 'variant-malformed',
    skillName: 'metabot-network-directory',
    status: 'active',
    // Intentionally omit patch/metadata/scope to simulate bad persisted data.
  };

  assert.doesNotThrow(() => {
    const resolved = resolveSkillContract({
      skillName: 'metabot-network-directory',
      evolutionNetworkEnabled: true,
      activeVariant: malformedVariant,
      activeVariantSource: 'remote',
    });
    assert.equal(resolved.source, 'base');
    assert.equal(resolved.activeVariantId, null);
    assert.equal(resolved.activeVariantSource, null);
  });
});

test('resolver computes same-scope metadata from actual scopes when metadata is contradictory', () => {
  const base = getBaseSkillContract('metabot-network-directory');
  const broadenedScopeVariant = createActiveVariantPatch({
    ...base.scope,
    chainWrite: true,
  });
  broadenedScopeVariant.metadata.sameScope = true;

  const resolved = resolveSkillContract({
    skillName: 'metabot-network-directory',
    evolutionNetworkEnabled: true,
    activeVariant: broadenedScopeVariant,
  });

  assert.equal(resolved.source, 'merged');
  assert.equal(resolved.scope.chainWrite, true);
  assert.equal(resolved.scopeMetadata.sameScope, false);
  assert.equal(resolved.activeVariantSource, null);
});

test('resolver renders both json and markdown outputs for codex, claude-code, and openclaw shims', () => {
  const hosts = ['codex', 'claude-code', 'openclaw'];

  for (const host of hosts) {
    const jsonOutput = renderResolvedSkillContract({
      skillName: 'metabot-network-directory',
      host,
      format: 'json',
      evolutionNetworkEnabled: true,
    });

    assert.equal(jsonOutput.host, host);
    assert.equal(jsonOutput.format, 'json');
    assert.equal(jsonOutput.contract.skillName, 'metabot-network-directory');
    assert.equal(typeof jsonOutput.contract.commandTemplate, 'string');

    const markdownOutput = renderResolvedSkillContract({
      skillName: 'metabot-network-directory',
      host,
      format: 'markdown',
      evolutionNetworkEnabled: true,
    });

    assert.equal(markdownOutput.host, host);
    assert.equal(markdownOutput.format, 'markdown');
    assert.equal(markdownOutput.contract.skillName, 'metabot-network-directory');
    assert.equal(typeof markdownOutput.markdown, 'string');
    assert.match(markdownOutput.markdown, /# Resolved Skill Contract: metabot-network-directory/);
    assert.equal(markdownOutput.markdown.includes(`Host: \`${host}\``), true);
    assert.match(markdownOutput.markdown, /## Command Template/);
    assert.match(markdownOutput.markdown, /## Scope/);
  }
});

test('resolver markdown rendering preserves command templates with backticks and newlines', () => {
  const base = getBaseSkillContract('metabot-network-directory');
  const variant = createActiveVariantPatch(base.scope);
  variant.patch.commandTemplatePatch = 'metabot network services --online\nprintf "```"';

  const markdownOutput = renderResolvedSkillContract({
    skillName: 'metabot-network-directory',
    host: 'codex',
    format: 'markdown',
    evolutionNetworkEnabled: true,
    activeVariant: variant,
  });

  assert.equal(markdownOutput.format, 'markdown');
  assert.equal(markdownOutput.markdown.includes(variant.patch.commandTemplatePatch), true);
  assert.match(markdownOutput.markdown, /````bash/);
});

test('resolver markdown rendering includes active variant source', () => {
  const base = getBaseSkillContract('metabot-network-directory');
  const variant = createActiveVariantPatch(base.scope);

  const markdownOutput = renderResolvedSkillContract({
    skillName: 'metabot-network-directory',
    host: 'codex',
    format: 'markdown',
    evolutionNetworkEnabled: true,
    activeVariant: variant,
    activeVariantSource: 'remote',
  });

  assert.equal(markdownOutput.format, 'markdown');
  assert.match(markdownOutput.markdown, /Active variant source: `remote`/);
});
