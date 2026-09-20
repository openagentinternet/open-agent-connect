import assert from 'node:assert/strict';
import test from 'node:test';

import { renderSkillHostAdapterNote } from '../../dist/core/skills/skillHostAdapterNotes.js';

test('dsh adapter notes tell the new CLI-backed skills to prefer native tools first', () => {
  const grouptask = renderSkillHostAdapterNote('metabot-grouptask', 'dsh', 'DeepSeek Harness');
  assert.match(grouptask, /### Native Tools First/);
  assert.match(grouptask, /Prefer the native `group_task` tool/);
  assert.match(grouptask, /records the current DSH session as the proposal's source session/);
  assert.match(grouptask, /`--session <id>` explicitly/);

  const qanda = renderSkillHostAdapterNote('metabot-qanda', 'dsh', 'DeepSeek Harness');
  assert.match(qanda, /### Native Tools First/);
  assert.match(qanda, /`search_qa`/);
  assert.match(qanda, /`post_simplequestion`/);
  assert.match(qanda, /Fall back to the CLI `qanda …` verbs/);

  const memory = renderSkillHostAdapterNote('metabot-memory', 'dsh', 'DeepSeek Harness');
  assert.match(memory, /### Native Tools First/);
  assert.match(memory, /memory injection and post-turn capture are automatic/);
  assert.match(memory, /never mirror turns manually here/);
  assert.match(memory, /`oac_session_read_latest`/);

  for (const note of [grouptask, qanda, memory]) {
    assert.match(note, /### MetaWeb URI Links/, 'dsh notes keep the MetaWeb URI link guidance');
    assert.match(note, /metaid:\/\//);
  }
});

test('dsh adapter notes keep the default MetaWeb URI note for skills without native-tool pairs', () => {
  const schedule = renderSkillHostAdapterNote('metabot-schedule', 'dsh', 'DeepSeek Harness');
  assert.doesNotMatch(schedule, /### Native Tools First/);
  assert.match(schedule, /### MetaWeb URI Links/);

  const networkManage = renderSkillHostAdapterNote('metabot-network-manage', 'dsh', 'DeepSeek Harness');
  assert.match(networkManage, /Prefer the native `search_online_bots` tool/);
});

test('non-dsh hosts keep receiving no adapter note for the new skills', () => {
  for (const skillName of ['metabot-grouptask', 'metabot-qanda', 'metabot-memory']) {
    assert.equal(renderSkillHostAdapterNote(skillName, 'codex', 'Codex'), '');
    assert.equal(renderSkillHostAdapterNote(skillName, 'claude-code', 'Claude Code'), '');
    assert.equal(renderSkillHostAdapterNote(skillName, 'openclaw', 'OpenClaw'), '');
  }
});
