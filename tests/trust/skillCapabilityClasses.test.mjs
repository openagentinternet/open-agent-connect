import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  classifySkill,
  DEFAULT_SKILL_CAPABILITY_CLASSES,
  DEFAULT_UNKNOWN_SKILL_CAPABILITY_CLASS,
  normalizeSkillClassOverrides,
} = require('../../dist/core/services/skillCapabilityClasses.js');

const skillsRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'SKILLs');
const shippedSkills = readdirSync(skillsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(path.join(skillsRoot, entry.name, 'SKILL.md')))
  .map((entry) => entry.name)
  .sort();

test('the registry covers every shipped SKILLs/* skill and nothing stale', () => {
  const registryKeys = Object.keys(DEFAULT_SKILL_CAPABILITY_CLASSES).sort();
  assert.deepEqual(registryKeys, shippedSkills, 'every shipped skill has exactly one registry entry');
  assert.equal(shippedSkills.length, 30);
});

test('classification sanity: the deliberately-chosen anchor skills', () => {
  assert.equal(classifySkill('metabot-help'), 'C0', 'purely informational');
  assert.equal(classifySkill('metabot-omni-reader'), 'C1', 'explicitly read-only');
  assert.equal(classifySkill('metabot-metaweb'), 'C1', 'search/read only');
  assert.equal(classifySkill('metabot-post-buzz'), 'C2', 'chain publish');
  assert.equal(classifySkill('metabot-post-skill'), 'C2', 'chain publish of a skill package');
  assert.equal(classifySkill('metabot-grouptask'), 'C2', 'the C2 example par excellence');
  assert.equal(classifySkill('metabot-memory'), 'C2', 'sandboxed local writes');
  assert.equal(classifySkill('metabot-browser'), 'C3', 'drives the real local browser');
  assert.equal(classifySkill('metabot-schedule'), 'C3', 'autonomous local execution');
  assert.equal(classifySkill('metabot-wallet-manage'), 'C4', 'funds — human-only');
  assert.equal(classifySkill('metabot-identity-manage'), 'C4', 'identity ops — human-only');
  assert.equal(classifySkill('metabot-grok-bot'), 'C4', 'identity create/bind');
});

test('unknown skills default to C3 (conservative)', () => {
  assert.equal(DEFAULT_UNKNOWN_SKILL_CAPABILITY_CLASS, 'C3');
  assert.equal(classifySkill('some-custom-skill'), 'C3');
  assert.equal(classifySkill(''), 'C3');
  assert.equal(classifySkill('metabot-wallet-manage '), 'C4', 'names are trimmed');
});

test('per-profile overrides win over defaults; invalid overrides fall back', () => {
  const overrides = { 'metabot-memory': 'C1', 'metabot-help': 'C2' };
  assert.equal(classifySkill('metabot-memory', overrides), 'C1');
  assert.equal(classifySkill('metabot-help', overrides), 'C2');
  assert.equal(classifySkill('metabot-wallet-manage', overrides), 'C4', 'unmentioned skills keep defaults');

  // @ts-expect-error intentionally invalid override type
  assert.equal(classifySkill('metabot-memory', { 'metabot-memory': 'C9' }), 'C2', 'invalid override class ignored');
  assert.equal(classifySkill('custom-skill', { 'custom-skill': 'C0' }), 'C0', 'overrides can relax unknown skills');
});

test('normalizeSkillClassOverrides is defensive', () => {
  assert.deepEqual(normalizeSkillClassOverrides(undefined), {});
  assert.deepEqual(normalizeSkillClassOverrides('nope'), {});
  assert.deepEqual(normalizeSkillClassOverrides([1, 2]), {});
  assert.deepEqual(
    normalizeSkillClassOverrides({ 'metabot-memory': 'C1', 'bogus': 'C9', 'x': 3, ' ': 'C0' }),
    { 'metabot-memory': 'C1' },
  );
});
