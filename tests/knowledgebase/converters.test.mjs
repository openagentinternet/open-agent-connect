import assert from 'node:assert/strict';
import { mkdtempTempRootSync } from '../helpers/tempRoots.mjs';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { extractKnowledgeBaseTextAsync, SUPPORTED_KB_EXTENSIONS, KnowledgeBaseTextError }
  = require('../../dist/core/knowledgebase/text.js');
const AdmZip = require('adm-zip');
const XLSX = require('xlsx');

function tempFile(name, contents) {
  const dir = mkdtempTempRootSync('metabot-kb-conv-');
  const filePath = path.join(dir, name);
  if (contents !== undefined) writeFileSync(filePath, contents);
  return filePath;
}

test('supported extension set matches the IDBots 19-format list', () => {
  for (const ext of ['.md', '.markdown', '.txt', '.json', '.csv', '.tsv', '.yaml', '.yml',
    '.xml', '.log', '.rst', '.pdf', '.docx', '.pptx', '.xlsx', '.xls', '.html', '.htm', '.epub']) {
    assert.ok(SUPPORTED_KB_EXTENSIONS.has(ext), `${ext} supported`);
  }
  assert.equal(SUPPORTED_KB_EXTENSIONS.size, 19);
  assert.ok(!SUPPORTED_KB_EXTENSIONS.has('.exe'));
});

test('html converts to markdown via turndown', async () => {
  const file = tempFile('page.html', '<html><body><h1>Starter Guide</h1>'
    + '<p>Feed the <strong>starter</strong> daily.</p></body></html>');
  const out = await extractKnowledgeBaseTextAsync(file);
  assert.match(out.text, /# Starter Guide/);
  assert.match(out.text, /\*\*starter\*\*/);
});

test('pptx slide bodies and notes extract paragraph-wise', async () => {
  const zip = new AdmZip();
  zip.addFile('ppt/slides/slide1.xml', Buffer.from(
    '<?xml version="1.0"?><p:sld xmlns:p="x" xmlns:a="y"><p:cSld><p:txBody>'
    + '<a:p><a:r><a:t>第一张幻灯片</a:t></a:r></a:p>'
    + '<a:p><a:r><a:t>Second line</a:t></a:r></a:p>'
    + '</p:txBody></p:cSld></p:sld>',
  ));
  zip.addFile('ppt/notesSlides/notesSlide1.xml', Buffer.from(
    '<?xml version="1.0"?><p:notes xmlns:a="y"><p:txBody>'
    + '<a:p><a:r><a:t>Speaker note</a:t></a:r></a:p></p:txBody></p:notes>',
  ));
  const file = tempFile('deck.pptx');
  zip.writeZip(file);
  const out = await extractKnowledgeBaseTextAsync(file);
  assert.match(out.text, /## Slide 1/);
  assert.match(out.text, /第一张幻灯片/);
  assert.match(out.text, /Second line/);
  assert.match(out.text, /Notes: Speaker note/);
});

test('xlsx workbooks become per-sheet csv sections', async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['item', 'qty'], ['面粉', '500']]), 'Materials');
  const file = tempFile('book.xlsx');
  XLSX.writeFile(workbook, file);
  const out = await extractKnowledgeBaseTextAsync(file);
  assert.match(out.text, /## Sheet: Materials/);
  assert.match(out.text, /item,qty/);
  assert.match(out.text, /面粉,500/);
});

test('epub spine chapters extract with the dc:title', async () => {
  const zip = new AdmZip();
  zip.addFile('META-INF/container.xml', Buffer.from(
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
    + '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  ));
  zip.addFile('OEBPS/content.opf', Buffer.from(
    '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">'
    + '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test Book</dc:title></metadata>'
    + '<manifest><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest>'
    + '<spine><itemref idref="c1"/></spine></package>',
  ));
  zip.addFile('OEBPS/ch1.xhtml', Buffer.from(
    '<html><body><h2>Chapter One</h2><p>你好世界。</p></body></html>',
  ));
  const file = tempFile('book.epub');
  zip.writeZip(file);
  const out = await extractKnowledgeBaseTextAsync(file);
  assert.equal(out.title, 'Test Book');
  assert.match(out.text, /## Chapter One/);
  assert.match(out.text, /你好世界。/);
});

test('failures are typed, never process crashes', async () => {
  await assert.rejects(
    extractKnowledgeBaseTextAsync(tempFile('broken.pdf', Buffer.from('not a pdf'))),
    (error) => error instanceof KnowledgeBaseTextError && error.code === 'extract_failed',
  );
  await assert.rejects(
    extractKnowledgeBaseTextAsync(tempFile('thing.xyz', 'nope')),
    (error) => error instanceof KnowledgeBaseTextError && error.code === 'unsupported_format',
  );
});
