import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { scaffoldMetaAppProject } = require('../../dist/core/metaapp/scaffold.js');
const { inspectMetaAppProject } = require('../../dist/core/metaapp/projectInspector.js');

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

test('scaffoldMetaAppProject writes a publish-ready blank static project', async () => {
  const root = await mkdtempTempRoot('metabot-metaapp-scaffold-blank-');
  const projectDir = path.join(root, 'my-app');

  const result = await scaffoldMetaAppProject({ projectDir, title: 'My App' });

  assert.equal(result.ok, true, result.message);
  assert.equal(result.data.template, 'blank');
  assert.equal(result.data.appName, 'my-app');
  assert.deepEqual([...result.data.files].sort(), ['.metaapp.json', 'APP.md', 'index.html']);

  const manifest = await readJson(path.join(projectDir, '.metaapp.json'));
  assert.equal(manifest.title, 'My App');
  assert.equal(manifest.appName, 'my-app');
  assert.equal(manifest.version, '1.0.0');
  assert.equal(manifest.runtime, 'browser');
  assert.equal(manifest.indexFile, 'index.html');

  const indexHtml = await readFile(path.join(projectDir, 'index.html'), 'utf8');
  assert.ok(indexHtml.includes('<title>My App</title>'));
  assert.ok(!indexHtml.includes('href="/'), 'no site-root asset references');
  assert.ok(!indexHtml.includes('src="/'), 'no site-root asset references');

  const appMd = await readFile(path.join(projectDir, 'APP.md'), 'utf8');
  assert.ok(appMd.startsWith('# My App'));

  // The scaffolded directory passes project inspection as a static MetaApp.
  const plan = await inspectMetaAppProject({ projectDir });
  assert.equal(plan.projectType, 'static');
  assert.equal(plan.artifactDir, path.resolve(projectDir));
  assert.equal(plan.manualAction, undefined);
  assert.equal(plan.manifest.title, 'My App');
});

test('scaffoldMetaAppProject derives title and appName from the directory name', async () => {
  const root = await mkdtempTempRoot('metabot-metaapp-scaffold-slug-');
  const projectDir = path.join(root, 'My Cool App!');

  const result = await scaffoldMetaAppProject({ projectDir });

  assert.equal(result.ok, true, result.message);
  assert.equal(result.data.title, 'My Cool App!');
  assert.equal(result.data.appName, 'my-cool-app');
});

test('scaffoldMetaAppProject refuses a non-empty directory without force and preserves extra files with force', async () => {
  const root = await mkdtempTempRoot('metabot-metaapp-scaffold-force-');
  const projectDir = path.join(root, 'app');
  const first = await scaffoldMetaAppProject({ projectDir });
  assert.equal(first.ok, true, first.message);
  await writeFile(path.join(projectDir, 'keep.txt'), 'do not touch', 'utf8');

  const refused = await scaffoldMetaAppProject({ projectDir });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'metaapp_scaffold_dir_not_empty');

  const forced = await scaffoldMetaAppProject({ projectDir, force: true });
  assert.equal(forced.ok, true, forced.message);
  assert.equal(await readFile(path.join(projectDir, 'keep.txt'), 'utf8'), 'do not touch');
});

test('scaffoldMetaAppProject rejects unknown templates and invalid appName slugs', async () => {
  const root = await mkdtempTempRoot('metabot-metaapp-scaffold-invalid-');

  const badTemplate = await scaffoldMetaAppProject({ projectDir: path.join(root, 'a'), template: 'vue' });
  assert.equal(badTemplate.ok, false);
  assert.equal(badTemplate.code, 'metaapp_scaffold_template_unknown');

  const badAppName = await scaffoldMetaAppProject({ projectDir: path.join(root, 'b'), appName: 'Not A Slug!' });
  assert.equal(badAppName.ok, false);
  assert.equal(badAppName.code, 'metaapp_scaffold_invalid_app_name');
});

test('scaffoldMetaAppProject demo template ships relative-referenced assets and a tagged manifest', async () => {
  const root = await mkdtempTempRoot('metabot-metaapp-scaffold-demo-');
  const projectDir = path.join(root, 'demo-app');

  const result = await scaffoldMetaAppProject({ projectDir, template: 'demo', appName: 'demo-app' });

  assert.equal(result.ok, true, result.message);
  assert.deepEqual(
    [...result.data.files].sort(),
    ['.metaapp.json', 'APP.md', 'app.js', 'index.html', 'style.css'],
  );

  const indexHtml = await readFile(path.join(projectDir, 'index.html'), 'utf8');
  assert.ok(indexHtml.includes('href="./style.css"'));
  assert.ok(indexHtml.includes('src="./app.js"'));

  const manifest = await readJson(path.join(projectDir, '.metaapp.json'));
  assert.deepEqual(manifest.tags, ['demo']);

  const plan = await inspectMetaAppProject({ projectDir });
  assert.equal(plan.projectType, 'static');
  assert.equal(plan.artifactDir, path.resolve(projectDir));
});
