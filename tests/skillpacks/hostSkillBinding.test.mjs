import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  resolveHostSkillSymlinkTarget,
  resolveHostSkillSymlinkType,
} = require('../../dist/core/host/hostSkillBinding.js');

test('host skill binding uses Windows junctions with absolute targets', () => {
  const source = path.resolve('/tmp/oac-home/.metabot/skills/metabot-ask-master');
  const destination = path.resolve('/tmp/oac-home/.agents/skills/metabot-ask-master');

  assert.equal(resolveHostSkillSymlinkType('win32'), 'junction');
  assert.equal(resolveHostSkillSymlinkType('darwin'), 'dir');
  assert.equal(resolveHostSkillSymlinkTarget({ platform: 'win32', destinationPath: destination, sourcePath: source }), source);
  assert.equal(
    resolveHostSkillSymlinkTarget({ platform: 'darwin', destinationPath: destination, sourcePath: source }),
    path.relative(path.dirname(destination), source),
  );
});
