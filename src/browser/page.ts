import { promises as fs } from 'node:fs';
import path from 'node:path';
import { buildBrowserPageDefinition, type BrowserPageDefinition } from './app';
import { createI18nContext } from '../ui/i18n';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function loadBrowserPageTemplate(): Promise<string> {
  const candidates = [
    path.resolve(__dirname, 'index.html'),
    path.resolve(__dirname, '../../src/browser/index.html'),
  ];
  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate, 'utf8');
    } catch {
      // Try the next build/source candidate.
    }
  }
  throw new Error('Browser page template not found.');
}

export async function renderBrowserPageHtml(
  definition: BrowserPageDefinition = buildBrowserPageDefinition(),
  languagePreference?: string | null,
): Promise<string> {
  const template = await loadBrowserPageTemplate();
  const content = definition.contentHtml ?? '';
  const i18n = createI18nContext(languagePreference);
  return template
    .replace(/<html lang="en">/g, `<html lang="${escapeHtml(i18n.language)}">`)
    .replace(/__PAGE_TITLE__/g, escapeHtml(definition.title))
    .replace(/__PAGE_EYEBROW__/g, escapeHtml(definition.eyebrow))
    .replace(/__PAGE_HEADING__/g, escapeHtml(definition.heading))
    .replace(/__PAGE_DESCRIPTION__/g, escapeHtml(definition.description))
    .replace(/__PAGE_NAV__/g, '')
    .replace(/__PAGE_PANELS__/g, '')
    .replace(/__PAGE_CONTENT__/g, content)
    .replace(/__PAGE_SCRIPT__/g, definition.script);
}
