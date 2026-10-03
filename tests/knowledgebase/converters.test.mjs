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

// ---------------------------------------------------------------------------
// Real-document fixtures, generated inline (no binary blobs in repo) — the
// highest-risk converters get happy-path coverage, IDBots test parity.
// ---------------------------------------------------------------------------

/** Minimal single-page PDF with one Helvetica text object (latin-only text). */
function makePdf(text) {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  objects.push(`5 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`);
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

test('pdf text extraction works on a real document (no external binaries)', async () => {
  const file = tempFile('sample.pdf', makePdf('Hello PDF Knowledge Base'));
  const out = await extractKnowledgeBaseTextAsync(file);
  assert.match(out.text, /Hello PDF Knowledge Base/, out.text);
});

test('docx (OOXML zip) converts through mammoth to markdown', async () => {
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '</Types>',
  ));
  zip.addFile('_rels/.rels', Buffer.from(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '</Relationships>',
  ));
  zip.addFile('word/document.xml', Buffer.from(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
    + '<w:p><w:r><w:t>知识库 DOCX 要点</w:t></w:r></w:p>'
    + '<w:p><w:r><w:t>Docx body paragraph here.</w:t></w:r></w:p>'
    + '</w:body></w:document>',
  ));
  const file = tempFile('sample.docx');
  zip.writeZip(file);
  const out = await extractKnowledgeBaseTextAsync(file);
  assert.match(out.text, /知识库 DOCX 要点/, out.text);
  assert.match(out.text, /Docx body paragraph here/, out.text);
});
