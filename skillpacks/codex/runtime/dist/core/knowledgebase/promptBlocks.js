"use strict";
/**
 * Knowledge-base prompt block — the volatile per-turn slice that tells the bot
 * which knowledge bases it owns and how to use them. Port of the IDBots
 * knowledgeBasePromptBlocks lib: pure builder, callers pass already-loaded KB
 * records, so the caller stays the only place that touches the store. Kept
 * bounded (top 5 KBs) and injected into the volatile per-turn tail, never the
 * cacheable system-prompt head.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.KNOWLEDGE_BASES_PROMPT_MAX_ITEMS = void 0;
exports.buildKnowledgeBasesPromptBlock = buildKnowledgeBasesPromptBlock;
exports.KNOWLEDGE_BASES_PROMPT_MAX_ITEMS = 5;
const KB_NAME_MAX_CHARS = 80;
const KB_DESCRIPTION_MAX_CHARS = 200;
const escapeXml = (value) => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
/** Registry strings are host-controlled and length-capped; a hard cut is enough. */
function truncate(value, maxLength) {
    const text = typeof value === 'string' ? value.trim() : '';
    return text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}…` : text;
}
/**
 * Hot layer: a bounded listing of the bot's knowledge bases (name +
 * description + document counts), so the model knows which corpora exist
 * before answering domain questions and where to save new finds. KBs are
 * listed even at 0 documents — the bot may add documents itself. Returns ''
 * when the bot has no knowledge bases at all.
 */
function buildKnowledgeBasesPromptBlock(records, maxItems = exports.KNOWLEDGE_BASES_PROMPT_MAX_ITEMS) {
    const items = (records ?? [])
        .slice(0, Math.max(1, maxItems))
        .map((record) => ({
        name: truncate(record?.name, KB_NAME_MAX_CHARS),
        description: truncate(record?.description ?? '', KB_DESCRIPTION_MAX_CHARS),
        docCount: Number.isFinite(record?.docCount) ? Math.max(0, Math.floor(Number(record.docCount))) : 0,
        chunkCount: Number.isFinite(record?.chunkCount) ? Math.max(0, Math.floor(Number(record.chunkCount))) : 0,
        isDefault: record?.isDefault === true,
    }))
        .filter((record) => record.name);
    if (items.length === 0)
        return '';
    const lines = ['<knowledge_bases>'];
    for (const record of items) {
        const defaultAttr = record.isDefault ? ' default="true"' : '';
        lines.push(`  <kb name="${escapeXml(record.name)}"${defaultAttr} docs="${record.docCount}" chunks="${record.chunkCount}">${escapeXml(record.description)}</kb>`);
    }
    lines.push('</knowledge_bases>');
    lines.push('<instruction>', 'The &lt;knowledge_bases&gt; block lists your local document knowledge bases. Before answering a domain', 'question one of them covers, query it with the knowledge_base_query tool (omit knowledgeBaseId to search', 'all at once). When you come across worthwhile Web2 or MetaWeb content, save it with', 'knowledge_base_add_document — use the default knowledge base when no topical one matches.', '</instruction>');
    return lines.join('\n');
}
