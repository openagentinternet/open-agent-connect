"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleBundledMetaAppRoutes = handleBundledMetaAppRoutes;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const BUNDLED_META_APPS = {
    buzz: {
        entryRelativePath: 'app/index.html',
        baseHref: '/ui/buzz/app/',
    },
    chat: {
        entryRelativePath: 'app/chat.html',
        baseHref: '/ui/chat/app/',
    },
};
const MIME_TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
};
const BUZZ_CONTEXT_STYLE = `
<style>
  .oac-buzz-context-banner {
    margin: 16px auto 0;
    max-width: min(960px, calc(100vw - 32px));
    padding: 14px 16px;
    border: 1px solid rgba(15, 118, 110, 0.22);
    border-radius: 18px;
    background: rgba(255, 250, 240, 0.96);
    color: #163036;
    box-shadow: 0 18px 45px rgba(15, 23, 42, 0.08);
  }
  .oac-buzz-context-label {
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #0f766e;
  }
  .oac-buzz-context-pin {
    margin-top: 8px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13px;
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  .oac-buzz-context-note {
    margin-top: 8px;
    color: #475569;
    font-size: 13px;
    line-height: 1.5;
  }
</style>`.trim();
const BUZZ_CONTEXT_SCRIPT = `
<script>
(() => {
  const params = new URLSearchParams(window.location.search);
  const pinId = String(params.get('pinId') || '').trim();
  if (!pinId) {
    return;
  }

  const mount = () => {
    if (!document.body || document.querySelector('[data-oac-buzz-context-banner]')) {
      return;
    }

    const banner = document.createElement('section');
    banner.setAttribute('data-oac-buzz-context-banner', 'true');
    banner.className = 'oac-buzz-context-banner';

    const label = document.createElement('div');
    label.className = 'oac-buzz-context-label';
    label.textContent = 'Posted Buzz Pin';

    const pin = document.createElement('div');
    pin.className = 'oac-buzz-context-pin';
    pin.textContent = pinId;

    const note = document.createElement('div');
    note.className = 'oac-buzz-context-note';
    note.textContent = 'The Buzz app below is running from the same local daemon and is ready for follow-up browsing.';

    banner.appendChild(label);
    banner.appendChild(pin);
    banner.appendChild(note);

    document.body.insertBefore(banner, document.body.firstChild);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
    return;
  }

  mount();
})();
</script>`.trim();
function decodePathSegments(rawPath) {
    const pieces = rawPath.split('/').filter(Boolean);
    const segments = [];
    for (const piece of pieces) {
        let decoded;
        try {
            decoded = decodeURIComponent(piece);
        }
        catch {
            return null;
        }
        if (!decoded || decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\')) {
            return null;
        }
        segments.push(decoded);
    }
    return segments;
}
async function resolveBundledMetaAppRoot(appId) {
    const copiedAssetPath = node_path_1.default.resolve(__dirname, `../../ui/metaapps/${appId}`);
    try {
        await node_fs_1.promises.access(copiedAssetPath);
        return copiedAssetPath;
    }
    catch {
        return node_path_1.default.resolve(__dirname, `../../../src/ui/metaapps/${appId}`);
    }
}
async function readBundledMetaAppFile(appId, relativePath) {
    const root = await resolveBundledMetaAppRoot(appId);
    const segments = decodePathSegments(relativePath);
    if (!segments || segments.length === 0) {
        throw new Error('Invalid meta app asset path.');
    }
    const absolutePath = node_path_1.default.resolve(root, ...segments);
    const relative = node_path_1.default.relative(root, absolutePath);
    if (!relative || relative.startsWith('..') || node_path_1.default.isAbsolute(relative)) {
        throw new Error('Meta app asset path escaped the bundled root.');
    }
    return {
        absolutePath,
        body: await node_fs_1.promises.readFile(absolutePath),
    };
}
function injectBaseHref(html, baseHref) {
    if (/<base\s/i.test(html)) {
        return html.replace(/<base\s+href="[^"]*"\s*\/?>/i, `<base href="${baseHref}">`);
    }
    return html.replace(/<head([^>]*)>/i, `<head$1>\n  <base href="${baseHref}">`);
}
function transformBundledMetaAppEntry(appId, html) {
    const definition = BUNDLED_META_APPS[appId];
    let transformed = injectBaseHref(html, definition.baseHref);
    if (appId === 'buzz') {
        transformed = transformed.replace('</head>', `  ${BUZZ_CONTEXT_STYLE}\n</head>`);
        transformed = transformed.replace('</body>', `  ${BUZZ_CONTEXT_SCRIPT}\n</body>`);
    }
    return transformed;
}
function matchBundledMetaAppPath(pathname) {
    if (pathname === '/ui/buzz' || pathname === '/ui/buzz/') {
        return { appId: 'buzz', relativePath: null };
    }
    if (pathname === '/ui/chat' || pathname === '/ui/chat/') {
        return { appId: 'chat', relativePath: null };
    }
    if (pathname.startsWith('/ui/buzz/')) {
        return { appId: 'buzz', relativePath: pathname.slice('/ui/buzz/'.length) };
    }
    if (pathname.startsWith('/ui/chat/')) {
        return { appId: 'chat', relativePath: pathname.slice('/ui/chat/'.length) };
    }
    return null;
}
async function handleBundledMetaAppRoutes(context) {
    const match = matchBundledMetaAppPath(context.url.pathname);
    if (!match) {
        return false;
    }
    if (context.req.method !== 'GET') {
        context.sendMethodNotAllowed(['GET']);
        return true;
    }
    const definition = BUNDLED_META_APPS[match.appId];
    const relativePath = match.relativePath || definition.entryRelativePath;
    try {
        const { absolutePath, body } = await readBundledMetaAppFile(match.appId, relativePath);
        const contentType = MIME_TYPES[node_path_1.default.extname(absolutePath).toLowerCase()] ?? 'application/octet-stream';
        if (relativePath === definition.entryRelativePath) {
            const html = transformBundledMetaAppEntry(match.appId, body.toString('utf8'));
            context.sendHtml(200, html);
            return true;
        }
        context.sendText(200, body, contentType);
        return true;
    }
    catch (error) {
        const code = error.code;
        if (code === 'ENOENT') {
            context.sendJson(404, {
                ok: false,
                state: 'failed',
                code: 'not_found',
                message: `No bundled MetaApp asset matched ${context.url.pathname}.`,
            });
            return true;
        }
        throw error;
    }
}
