"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.METAAPP_SCAFFOLD_TEMPLATES = void 0;
exports.scaffoldMetaAppProject = scaffoldMetaAppProject;
/**
 * MetaApp project scaffolding (`metabot metaapp new`). Writes a publish-ready
 * static project — an `index.html` entry with relative asset references, the
 * `APP.md` documentation file agents read first, and a `.metaapp.json`
 * manifest — so a freshly scaffolded directory passes preview and publish
 * without further edits. Templates are embedded; the command runs fully
 * local, no daemon or chain access required.
 */
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const commandResult_1 = require("../contracts/commandResult");
exports.METAAPP_SCAFFOLD_TEMPLATES = ['blank', 'demo'];
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function slugifyAppName(value) {
    const slug = value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    return slug || 'metaapp';
}
function blankIndexHtml(title) {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; }
    main { max-width: 40rem; padding: 2rem; text-align: center; }
    h1 { font-size: 1.75rem; margin-bottom: 0.5rem; }
    p { color: #94a3b8; }
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p>This MetaApp is ready. Edit <code>index.html</code> and describe the app in <code>APP.md</code>.</p>
  </main>
</body>
</html>
`;
}
function blankAppMd(title) {
    return `# ${title}

${title} is a MetaApp. Replace this paragraph with one plain-language paragraph on what the app does and when someone would open it.

## Structure

- \`index.html\` — the only page; markup, styles, and logic live here.
- \`.metaapp.json\` — the publish manifest (title, appName, version, runtime, indexFile).

## Remix notes

- Keep every asset reference relative to the package root; site-root paths such as /assets/... break inside the packaged ZIP.
- Update this APP.md in the same change whenever the app is modified, so the docs stay version-locked with the code.
`;
}
function demoIndexHtml(title) {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <link rel="stylesheet" href="./style.css">
</head>
<body>
  <main class="card">
    <h1>${title}</h1>
    <p class="hint">A tiny counter demo. The count persists in localStorage.</p>
    <p class="count" id="count">0</p>
    <button id="increment" type="button">+1</button>
  </main>
  <script src="./app.js"></script>
</body>
</html>
`;
}
const DEMO_STYLE_CSS = `body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  font-family: system-ui, sans-serif;
  background: #0f172a;
  color: #e2e8f0;
}

.card { text-align: center; padding: 2rem; }
.hint { color: #94a3b8; }
.count { font-size: 3rem; margin: 1rem 0; }

button {
  font: inherit;
  padding: 0.5rem 1.5rem;
  border: none;
  border-radius: 0.5rem;
  background: #38bdf8;
  color: #082f49;
  cursor: pointer;
}

button:hover { background: #7dd3fc; }
`;
const DEMO_APP_JS = `const STORAGE_KEY = 'demo-counter:value';

const countEl = document.getElementById('count');
const button = document.getElementById('increment');

let count = Number.parseInt(localStorage.getItem(STORAGE_KEY) ?? '0', 10) || 0;

function render() {
  countEl.textContent = String(count);
}

button.addEventListener('click', () => {
  count += 1;
  localStorage.setItem(STORAGE_KEY, String(count));
  render();
});

render();
`;
function demoAppMd(title) {
    return `# ${title}

${title} is a minimal counter MetaApp: one button increments a number, and the number survives reloads. It exists as a reference for the MetaApp packaging conventions.

## Structure

- \`index.html\` — the entry page; pulls in the other assets through relative ./ references.
- \`style.css\` — all styling.
- \`app.js\` — the counter logic.
- \`.metaapp.json\` — the publish manifest (title, appName, version, runtime, indexFile).

## Params and outputs

- localStorage key \`demo-counter:value\` holds the current count as a decimal string.

## Remix notes

- Keep every asset reference relative to the package root; site-root paths such as /assets/... break inside the packaged ZIP.
- Replace the counter with your own logic, then update this APP.md in the same change so the docs stay version-locked with the code.
`;
}
function manifestJson(input) {
    return `${JSON.stringify({
        title: input.title,
        appName: input.appName,
        version: '1.0.0',
        runtime: 'browser',
        indexFile: 'index.html',
        ...(input.tags?.length ? { tags: input.tags } : {}),
    }, null, 2)}\n`;
}
const TEMPLATES = {
    blank: {
        files: ({ title, appName }) => ({
            'index.html': blankIndexHtml(title),
            'APP.md': blankAppMd(title),
            '.metaapp.json': manifestJson({ title, appName }),
        }),
    },
    demo: {
        files: ({ title, appName }) => ({
            'index.html': demoIndexHtml(title),
            'style.css': DEMO_STYLE_CSS,
            'app.js': DEMO_APP_JS,
            'APP.md': demoAppMd(title),
            '.metaapp.json': manifestJson({ title, appName, tags: ['demo'] }),
        }),
    },
};
function isMetaAppScaffoldTemplate(value) {
    return exports.METAAPP_SCAFFOLD_TEMPLATES.includes(value);
}
async function scaffoldMetaAppProject(input) {
    const projectDir = node_path_1.default.resolve(input.cwd ?? process.cwd(), normalizeText(input.projectDir) || '.');
    const templateName = normalizeText(input.template) || 'blank';
    if (!isMetaAppScaffoldTemplate(templateName)) {
        return (0, commandResult_1.commandFailed)('metaapp_scaffold_template_unknown', `Unknown MetaApp template "${templateName}". Available templates: ${exports.METAAPP_SCAFFOLD_TEMPLATES.join(', ')}.`);
    }
    const title = normalizeText(input.title) || node_path_1.default.basename(projectDir) || 'My MetaApp';
    const appName = normalizeText(input.appName) || slugifyAppName(title);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(appName)) {
        return (0, commandResult_1.commandFailed)('metaapp_scaffold_invalid_app_name', `MetaApp appName "${appName}" must be a lowercase slug (letters, digits, dashes).`);
    }
    const files = TEMPLATES[templateName].files({ title, appName });
    try {
        const stat = await node_fs_1.promises.stat(projectDir).catch(() => null);
        if (stat) {
            if (!stat.isDirectory()) {
                return (0, commandResult_1.commandFailed)('metaapp_scaffold_dir_not_empty', `${projectDir} exists and is not a directory.`);
            }
            const entries = await node_fs_1.promises.readdir(projectDir);
            if (entries.length > 0 && input.force !== true) {
                return (0, commandResult_1.commandFailed)('metaapp_scaffold_dir_not_empty', `${projectDir} is not empty. Re-run with --force to overwrite the template files in place.`);
            }
        }
        await node_fs_1.promises.mkdir(projectDir, { recursive: true });
        for (const [relativePath, content] of Object.entries(files)) {
            await node_fs_1.promises.writeFile(node_path_1.default.join(projectDir, relativePath), content, 'utf8');
        }
    }
    catch (error) {
        return (0, commandResult_1.commandFailed)('metaapp_scaffold_failed', error instanceof Error ? error.message : String(error));
    }
    return (0, commandResult_1.commandSuccess)({
        projectDir,
        template: templateName,
        title,
        appName,
        files: Object.keys(files),
    });
}
