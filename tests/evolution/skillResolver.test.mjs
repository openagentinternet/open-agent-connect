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
  });

  assert.equal(resolved.source, 'base');
  assert.equal(resolved.activeVariantId, null);
  assert.equal(resolved.instructions, base.instructions);
  assert.equal(resolved.commandTemplate, base.commandTemplate);
});

test('resolver returns a merged contract when an active variant exists', () => {
  const base = getBaseSkillContract('metabot-network-directory');
  const variant = createActiveVariantPatch(base.scope);
  const resolved = resolveSkillContract({
    skillName: 'metabot-network-directory',
    evolutionNetworkEnabled: true,
    activeVariant: variant,
  });

  assert.equal(resolved.source, 'merged');
  assert.equal(resolved.activeVariantId, variant.variantId);
  assert.equal(resolved.instructions, variant.patch.instructionsPatch);
  assert.equal(resolved.commandTemplate, variant.patch.commandTemplatePatch);
  assert.equal(resolved.outputExpectation, variant.patch.outputExpectationPatch);
  assert.equal(resolved.fallbackPolicy, variant.patch.fallbackPolicyPatch);
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
