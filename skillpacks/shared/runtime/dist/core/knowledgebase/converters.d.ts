/**
 * Pure-JS document-to-text converters for the knowledge base — port of the
 * IDBots knowledgeBaseConverters lib. Markitdown-style format coverage
 * (PDF/DOCX/PPTX/XLSX/HTML/EPUB) via lazy-loaded npm packages: no external
 * binaries (the previous OAC pipeline required a user-installed `pdftotext`
 * and macOS-only `textutil`), and app startup is unaffected because every
 * heavy dependency loads inside its own branch, so a broken package only
 * breaks its own format.
 *
 * Each extractor throws KnowledgeBaseTextError('extract_failed', …) when the
 * file cannot be parsed or yields no text; the learn loop records per-file
 * failures instead of aborting the run, so throwing is safe.
 */
import { type KnowledgeBaseExtraction } from './text';
export declare function extractPdfText(filePath: string): Promise<KnowledgeBaseExtraction>;
export declare function extractDocxText(filePath: string): Promise<KnowledgeBaseExtraction>;
export declare function extractPptxText(filePath: string): Promise<KnowledgeBaseExtraction>;
export declare function extractSpreadsheetText(filePath: string): Promise<KnowledgeBaseExtraction>;
export declare function extractHtmlText(filePath: string): Promise<KnowledgeBaseExtraction>;
export declare function extractEpubText(filePath: string): Promise<KnowledgeBaseExtraction>;
