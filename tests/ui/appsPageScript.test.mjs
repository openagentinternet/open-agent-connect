import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { buildAppsPageDefinition } = require('../../dist/ui/pages/apps/app.js');
const {
  METAAPP_CODE_TYPE_OPTIONS,
  METAAPP_CONTENT_TYPE_OPTIONS,
} = require('../../dist/core/metaapp/appsProtocol.js');

const PIN = '6ea8a0bd0bac9a9c6cf4e035e9ce0a18e3a89f390c355dcc43074010fbee7ee7i0';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function waitFor(condition, label) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      if (condition()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > 1000) {
        reject(new Error(`Timed out waiting for ${label}`));
        return;
      }
      setTimeout(check, 5);
    };
    check();
  });
}

class FakeElement {
  constructor(attributes = {}, tagName = 'DIV') {
    this.attributes = new Map(Object.entries(attributes));
    this.listeners = new Map();
    this._innerHTML = '';
    this.textContent = '';
    this.disabled = this.attributes.has('disabled');
    this.hidden = this.attributes.has('hidden');
    this.dataset = {};
    this.children = [];
    this.files = [];
    this.tagName = tagName.toUpperCase();
    this.type = this.attributes.get('type') ?? '';
    this.name = this.attributes.get('name') ?? '';
    this.value = this.attributes.get('value') ?? '';
    this.checked = this.attributes.has('checked');
    this.href = this.attributes.get('href') ?? '';
    this.ownerDocument = null;
    this.parentElement = null;
    this.classList = {
      values: new Set(),
      add: (...tokens) => {
        for (const token of tokens) this.classList.values.add(token);
      },
      remove: (...tokens) => {
        for (const token of tokens) this.classList.values.delete(token);
      },
      contains: (token) => this.classList.values.has(token),
    };
    for (const [name, value] of this.attributes.entries()) {
      if (name.startsWith('data-')) {
        this.dataset[dataAttributeName(name)] = value;
      }
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    if (typeof this.onInnerHTML === 'function') {
      this.onInnerHTML(this._innerHTML);
    }
  }

  addEventListener(eventName, handler) {
    const listeners = this.listeners.get(eventName) ?? [];
    listeners.push(handler);
    this.listeners.set(eventName, listeners);
  }

  async dispatchEvent(eventName, event = {}) {
    for (const handler of this.listeners.get(eventName) ?? []) {
      await handler({ target: this, currentTarget: this, preventDefault() {}, ...event });
    }
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  matches(selector) {
    return selector.split(',').map((part) => part.trim()).some((part) => {
      const selectorPart = part.replace(/:checked/gu, '').trim();
      if (part.includes(':checked') && !this.checked) return false;
      const tagMatch = selectorPart.match(/^[a-z][a-z0-9-]*/iu);
      if (tagMatch && this.tagName.toLowerCase() !== tagMatch[0].toLowerCase()) {
        return false;
      }
      const attrMatches = [...selectorPart.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/gu)];
      if (!attrMatches.length && tagMatch) return true;
      if (!attrMatches.length) return false;
      return attrMatches.every((match) => {
        const actual = this.getAttribute(match[1]);
        return match[2] === undefined ? actual !== null : actual === match[2];
      });
    });
  }

  closest(selector) {
    for (let element = this; element; element = element.parentElement ?? null) {
      if (element.matches(selector)) return element;
    }
    return null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'href') this.href = String(value);
    if (name === 'value') this.value = String(value);
    if (name === 'name') this.name = String(value);
    if (name === 'type') this.type = String(value);
    if (name === 'checked') this.checked = true;
    if (name === 'disabled') this.disabled = true;
    if (name === 'hidden') this.hidden = true;
    if (name.startsWith('data-')) this.dataset[dataAttributeName(name)] = String(value);
  }

  appendChild(child) {
    child.parentElement = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (element) => {
      if (element.matches(selector)) matches.push(element);
      for (const child of element.children) visit(child);
    };
    for (const child of this.children) visit(child);
    return matches;
  }

  focus() {
    if (this.ownerDocument) {
      this.ownerDocument.activeElement = this;
    }
  }
}

function dataAttributeName(attributeName) {
  return attributeName.slice('data-'.length).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
}

function decodeAttributeValue(value) {
  return String(value ?? '')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&amp;/gu, '&');
}

function parseAttributes(rawAttributes) {
  const attributes = {};
  for (const match of rawAttributes.matchAll(/([a-zA-Z0-9:-]+)(?:="([^"]*)")?/gu)) {
    attributes[match[1]] = decodeAttributeValue(match[2] ?? '');
  }
  return attributes;
}

function makeFormField(attributes, tagName = 'INPUT') {
  const field = new FakeElement(attributes, tagName);
  field.type = attributes.type ?? (tagName === 'TEXTAREA' ? 'textarea' : tagName.toLowerCase());
  field.name = attributes.name ?? '';
  field.value = attributes.value ?? '';
  field.checked = Object.prototype.hasOwnProperty.call(attributes, 'checked');
  return field;
}

function buildFakeModalTree(html, ownerDocument) {
  const formMatch = html.match(/<form\b([^>]*)>([\s\S]*?)<\/form>/iu);
  if (!formMatch) return buildFakeElementsFromHtml(html, ownerDocument);
  const formAttributes = parseAttributes(formMatch[1]);
  const form = new FakeElement(formAttributes, 'FORM');
  form.ownerDocument = ownerDocument;
  form.dataset.mode = formAttributes['data-apps-form-mode'] ?? '';
  form.dataset.targetPinId = formAttributes['data-apps-target-pin-id'] ?? '';
  const body = formMatch[2];

  for (const match of body.matchAll(/<(input|textarea|select)\b([^>]*)>([\s\S]*?)<\/\1>|<(input)\b([^>]*)>/giu)) {
    const tagName = (match[1] || match[4]).toUpperCase();
    const rawAttributes = match[2] || match[5] || '';
    const attributes = parseAttributes(rawAttributes);
    if (tagName === 'TEXTAREA') {
      attributes.value = decodeAttributeValue(match[3] ?? '');
    }
    if (tagName === 'SELECT') {
      const selected = [...(match[3] ?? '').matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/giu)]
        .map((optionMatch) => parseAttributes(optionMatch[1]))
        .find((optionAttributes) => Object.prototype.hasOwnProperty.call(optionAttributes, 'selected'));
      attributes.value = selected?.value ?? '';
    }
    const field = makeFormField(attributes, tagName);
    field.ownerDocument = ownerDocument;
    form.appendChild(field);
  }

  for (const match of body.matchAll(/<[^>]+\bdata-apps-field-error="([^"]+)"[^>]*>/giu)) {
    const error = new FakeElement({ 'data-apps-field-error': decodeAttributeValue(match[1]) });
    error.ownerDocument = ownerDocument;
    form.appendChild(error);
  }
  if (/\bdata-apps-form-error\b/iu.test(body)) {
    const formError = new FakeElement({ 'data-apps-form-error': '' });
    formError.ownerDocument = ownerDocument;
    form.appendChild(formError);
  }
  if (/\bdata-apps-delete-error\b/iu.test(body)) {
    const deleteError = new FakeElement({ 'data-apps-delete-error': '' });
    deleteError.ownerDocument = ownerDocument;
    form.appendChild(deleteError);
  }
  for (const match of body.matchAll(/<[^>]+\bdata-apps-content-hash-source\b([^>]*)>([\s\S]*?)<\/[^>]+>/giu)) {
    const source = new FakeElement({ 'data-apps-content-hash-source': '', ...parseAttributes(match[1] || '') });
    source.ownerDocument = ownerDocument;
    source.textContent = decodeAttributeValue((match[2] || '').replace(/<[^>]+>/gu, '').trim());
    form.appendChild(source);
  }

  return [form];
}

function buildFakeElementsFromHtml(html, ownerDocument) {
  const elements = [];
  const stack = [];
  for (const match of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>|<\/([a-z][a-z0-9-]*)>/giu)) {
    if (match[3]) {
      stack.pop();
      continue;
    }
    const tagName = match[1].toUpperCase();
    const attributes = parseAttributes(match[2] || '');
    const element = new FakeElement(attributes, tagName);
    element.ownerDocument = ownerDocument;
    if (tagName === 'INPUT') {
      element.type = attributes.type ?? '';
      element.name = attributes.name ?? '';
      element.value = attributes.value ?? '';
      element.checked = Object.prototype.hasOwnProperty.call(attributes, 'checked');
    }
    const parent = stack[stack.length - 1] ?? null;
    if (parent) {
      parent.appendChild(element);
    } else {
      elements.push(element);
    }
    if (!/\/\s*>$/u.test(match[0]) && !['INPUT', 'BR', 'HR', 'IMG', 'META', 'LINK'].includes(tagName)) {
      stack.push(element);
    }
  }
  return elements;
}

class FakeFormData {
  constructor(form) {
    this.entriesList = [];
    for (const field of form.querySelectorAll('[name]')) {
      if (field.disabled || field.type === 'file') continue;
      if ((field.type === 'checkbox' || field.type === 'radio') && !field.checked) continue;
      this.entriesList.push([field.name, field.type === 'checkbox' ? (field.value || 'on') : field.value]);
    }
  }

  get(name) {
    const entry = this.entriesList.find(([entryName]) => entryName === name);
    return entry ? entry[1] : null;
  }

  getAll(name) {
    return this.entriesList.filter(([entryName]) => entryName === name).map(([, value]) => value);
  }
}

function response(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  };
}

function appsPayload(overrides = {}) {
  return {
    ok: true,
    state: 'success',
    data: {
      records: [],
      nextCursor: '',
      total: 0,
      ...overrides,
    },
  };
}

function profilesPayload(profiles = [
  {
    slug: 'alice',
    name: 'Alice',
    globalMetaId: 'idq1alice',
    avatar: null,
    homeDir: '/tmp/alice',
    isActive: true,
  },
]) {
  return {
    ok: true,
    state: 'success',
    data: {
      activeSlug: 'alice',
      profiles,
    },
  };
}

function createAppsPageContext(options = {}) {
  const documentListeners = new Map();
  const windowListeners = new Map();
  const locationUrl = new URL(options.url ?? 'http://localhost/ui/apps');
  const body = new FakeElement();
  const elements = {
    '[data-apps-shell]': new FakeElement({ 'data-apps-shell': '' }),
    '[data-apps-notice]': new FakeElement({ 'data-apps-notice': '' }),
    '[data-apps-grid]': new FakeElement({ 'data-apps-grid': '' }),
    '[data-apps-grid-count]': new FakeElement({ 'data-apps-grid-count': '' }),
    '[data-apps-refresh]': new FakeElement({ 'data-apps-refresh': '' }),
    '[data-apps-page-prev]': new FakeElement({ 'data-apps-page-prev': '' }),
    '[data-apps-page-next]': new FakeElement({ 'data-apps-page-next': '' }),
    '[data-apps-page-label]': new FakeElement({ 'data-apps-page-label': '' }),
    '[data-apps-bot-picker]': new FakeElement({ 'data-apps-bot-picker': '' }),
    '[data-apps-publish-open]': new FakeElement({ 'data-apps-publish-open': '' }),
    '[data-apps-modal-root]': new FakeElement({ 'data-apps-modal-root': '' }),
  };
  const document = {
    body,
    activeElement: body,
    querySelector: (selector) => elements[selector] ?? elements['[data-apps-modal-root]'].querySelector(selector) ?? null,
    addEventListener: (eventName, handler) => {
      const listeners = documentListeners.get(eventName) ?? [];
      listeners.push(handler);
      documentListeners.set(eventName, listeners);
    },
  };
  for (const element of [body, ...Object.values(elements)]) {
    element.ownerDocument = document;
  }
  elements['[data-apps-modal-root]'].onInnerHTML = (html) => {
    elements['[data-apps-modal-root]'].children = buildFakeModalTree(html, document);
  };
  elements['[data-apps-grid]'].onInnerHTML = (html) => {
    elements['[data-apps-grid]'].children = buildFakeElementsFromHtml(html, document);
  };

  const fetchUrls = [];
  const fetchBodies = [];
  const clipboardWrites = [];
  const context = {
    Element: FakeElement,
    FormData: FakeFormData,
    URL,
    URLSearchParams,
    document,
    fetch: (url, fetchOptions = {}) => {
      const urlText = String(url);
      fetchUrls.push(urlText);
      if ((fetchOptions.method || '').toUpperCase() === 'POST') {
        const isFileUpload = urlText.startsWith('/api/file/upload') || urlText.startsWith('/api/file/upload-large');
        const bodyPayload = isFileUpload && typeof fetchOptions.body !== 'string'
          ? fetchOptions.body ?? null
          : fetchOptions.body ? JSON.parse(fetchOptions.body) : null;
        fetchBodies.push({ url: urlText, body: bodyPayload, headers: fetchOptions.headers ?? {} });
        if (String(url) === '/api/metaapp/publish' || String(url) === '/api/metaapp/update' || String(url) === '/api/metaapp/delete') {
          if (!bodyPayload || bodyPayload.confirm !== true) {
            return Promise.resolve(response({
              ok: false,
              state: 'failed',
              message: 'confirmation required',
            }));
          }
          const mutationPayload = typeof options.mutationResponse === 'function'
            ? options.mutationResponse(urlText, bodyPayload)
            : options.mutationResponse;
          return Promise.resolve(mutationPayload ?? {
            ok: true,
            state: 'success',
            data: { pinId: `${'b'.repeat(64)}i0` },
          }).then((payload) => response(payload));
        }
        if (isFileUpload) {
          const uploadPayload = typeof options.uploadResponse === 'function'
            ? options.uploadResponse(urlText, bodyPayload, fetchBodies.filter((entry) => entry.url.startsWith('/api/file/upload') || entry.url.startsWith('/api/file/upload-large')).length)
            : options.uploadResponse;
          return Promise.resolve(response(uploadPayload ?? {
            ok: true,
            state: 'success',
            data: { metafileUri: 'metafile://uploaded-file-pin' },
          }));
        }
      }
      if (String(url) === '/api/bot/profiles') {
        return Promise.resolve(response(options.profiles ?? profilesPayload()));
      }
      if (String(url).startsWith('/api/metaapp/list?')) {
        if (typeof options.fetchApps === 'function') {
          return Promise.resolve(options.fetchApps(String(url))).then((payload) => response(payload));
        }
        return Promise.resolve(response(options.apps ?? appsPayload()));
      }
      throw new Error(`Unexpected fetch ${url}`);
    },
    history: {
      replaceState: (state, title, url) => {
        locationUrl.href = new URL(String(url), locationUrl).href;
      },
    },
    location: locationUrl,
    window: null,
    navigator: {
      clipboard: {
        writeText: async (value) => {
          clipboardWrites.push(value);
        },
      },
    },
    addEventListener: (eventName, handler) => {
      const listeners = windowListeners.get(eventName) ?? [];
      listeners.push(handler);
      windowListeners.set(eventName, listeners);
    },
    dispatchEvent: (event) => {
      for (const handler of windowListeners.get(event.type) ?? []) {
        handler(event);
      }
    },
    setTimeout,
    clearTimeout,
    crypto: {
      subtle: {
        digest: async (algorithm, data) => {
          assert.equal(String(algorithm).toUpperCase(), 'SHA-256');
          const digest = createHash('sha256').update(Buffer.from(data)).digest();
          return digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength);
        },
      },
    },
  };
  context.window = context;

  const dispatchDocumentEvent = async (eventName, event) => {
    for (const listener of documentListeners.get(eventName) ?? []) {
      await listener(event);
    }
  };

  return {
    context,
    elements,
    fetchUrls,
    fetchBodies,
    clipboardWrites,
    locationUrl,
    waitFor: (condition, label) => waitFor(condition, label),
    run: () => vm.runInNewContext(buildAppsPageDefinition().script, context),
    dispatchWindowEvent: (eventName) => {
      context.dispatchEvent({ type: eventName });
    },
    clickElement: async (selector) => {
      const element = elements[selector];
      await element.dispatchEvent('click', { target: element });
      await dispatchDocumentEvent('click', { target: element });
    },
    clickFake: (attributes) => dispatchDocumentEvent('click', { target: new FakeElement(attributes) }),
    clickModalAction: async (selector) => {
      const element = elements['[data-apps-modal-root]'].querySelector(selector);
      assert.ok(element, `${selector} rendered modal action missing`);
      await elements['[data-apps-modal-root]'].dispatchEvent('click', { target: element });
      await dispatchDocumentEvent('click', { target: element });
    },
    keydownGridAction: async (selector, key) => {
      const element = elements['[data-apps-grid]'].querySelector(selector);
      assert.ok(element, `${selector} rendered grid element missing`);
      await dispatchDocumentEvent('keydown', { target: element, key, preventDefault() {} });
    },
    modalForm: () => elements['[data-apps-modal-root]'].querySelector('[data-apps-form]'),
    setField: (name, value) => {
      const field = elements['[data-apps-modal-root]'].querySelector(`[name="${name}"]`);
      assert.ok(field, `${name} field missing`);
      field.value = value;
    },
    setChecked: (name, value, checked) => {
      const field = elements['[data-apps-modal-root]'].querySelector(`input[name="${name}"][value="${value}"]`);
      assert.ok(field, `${name}:${value} field missing`);
      field.checked = checked;
    },
    submitModalForm: async () => {
      const form = elements['[data-apps-modal-root]'].querySelector('[data-apps-form]');
      assert.ok(form, 'apps form missing');
      await elements['[data-apps-modal-root]'].dispatchEvent('submit', { target: form });
    },
    submitDeleteForm: async () => {
      const form = elements['[data-apps-modal-root]'].querySelector('[data-apps-delete-form]');
      assert.ok(form, 'apps delete form missing');
      await elements['[data-apps-modal-root]'].dispatchEvent('submit', { target: form });
    },
    uploadAssetFile: async (fieldName, file) => {
      const input = new FakeElement({ 'data-apps-asset-file': fieldName }, 'INPUT');
      input.type = 'file';
      input.files = Array.isArray(file) ? file : [file];
      await elements['[data-apps-modal-root]'].dispatchEvent('change', { target: input });
    },
    clickGridAction: async (selector) => {
      const element = elements['[data-apps-grid]'].querySelector(selector);
      assert.ok(element, `${selector} rendered action missing`);
      await dispatchDocumentEvent('click', { target: element });
    },
  };
}

test('apps page loads active Bot and requests first Apps page with page size 12', async () => {
  const context = createAppsPageContext({
    profiles: profilesPayload([{
      slug: 'alice',
      name: 'Alice',
      globalMetaId: 'idq1alice',
      avatar: null,
      homeDir: '/tmp/alice',
      isActive: true,
    }]),
    apps: appsPayload(),
  });

  context.run();

  await context.waitFor(() => context.fetchUrls.some((url) => url.startsWith('/api/metaapp/list?')), 'apps request');
  const url = new URL(context.fetchUrls.find((item) => item.startsWith('/api/metaapp/list?')), 'http://localhost');
  assert.equal(url.searchParams.get('from'), 'alice');
  assert.equal(url.searchParams.get('size'), '12');
});

test('apps page renders records and disables Run for disabled apps', async () => {
  const context = createAppsPageContext({
    apps: appsPayload({
      records: [{
        pinId: PIN,
        title: 'Disabled App',
        appName: 'Disabled App',
        runtime: 'browser',
        version: 'v1',
        intro: 'Disabled',
        tags: ['tool'],
        disabled: true,
      }],
      total: 1,
    }),
  });

  context.run();

  await context.waitFor(() => context.elements['[data-apps-grid]'].innerHTML.includes('Disabled App'), 'render disabled app');
  assert.match(context.elements['[data-apps-grid]'].innerHTML, /Disabled/);
  assert.match(context.elements['[data-apps-grid]'].innerHTML, /data-apps-run/);
  assert.match(context.elements['[data-apps-grid]'].innerHTML, /disabled/);
});

test('apps page renders http cover and icon images on record cards', async () => {
  const context = createAppsPageContext({
    apps: appsPayload({
      records: [{
        pinId: PIN,
        title: 'Image App',
        appName: 'Image App',
        iconImg: 'https://cdn.example.test/icon.png',
        coverImg: 'http://cdn.example.test/cover.png',
        disabled: false,
      }],
      total: 1,
    }),
  });

  context.run();

  await context.waitFor(() => context.elements['[data-apps-grid]'].innerHTML.includes('Image App'), 'render image app');
  const html = context.elements['[data-apps-grid]'].innerHTML;
  assert.match(html, /class="apps-card-cover-img" src="http:\/\/cdn\.example\.test\/cover\.png"/);
  assert.match(html, /class="apps-card-icon" src="https:\/\/cdn\.example\.test\/icon\.png"/);
});

test('apps page resolves metafile card cover and icon images', async () => {
  const context = createAppsPageContext({
    apps: appsPayload({
      records: [{
        pinId: PIN,
        title: 'Metafile Image App',
        appName: 'Metafile Image App',
        iconImg: `metafile://${PIN}`,
        coverImg: PIN,
        disabled: false,
      }],
      total: 1,
    }),
  });

  context.run();

  await context.waitFor(() => context.elements['[data-apps-grid]'].innerHTML.includes('Metafile Image App'), 'render metafile image app');
  const html = context.elements['[data-apps-grid]'].innerHTML;
  assert.match(html, new RegExp(`class="apps-card-cover-img" src="/api/file/avatar\\?ref=${PIN}"`, 'u'));
  assert.match(html, new RegExp(`class="apps-card-icon" src="/api/file/avatar\\?ref=${PIN}"`, 'u'));
});

test('apps page resolves extension-bearing metafile images on cards and detail shots', async () => {
  const context = createAppsPageContext({
    apps: appsPayload({
      records: [{
        pinId: PIN,
        title: 'Extension Metafile Image App',
        appName: 'Extension Metafile Image App',
        icon: `metafile://${PIN}.png`,
        coverImg: `metafile://${PIN}.jpg`,
        introImgs: [`metafile://${PIN}.webp`],
        disabled: false,
      }],
      total: 1,
    }),
  });

  context.run();

  await context.waitFor(() => context.elements['[data-apps-grid]'].innerHTML.includes('Extension Metafile Image App'), 'render extension metafile image app');
  let html = context.elements['[data-apps-grid]'].innerHTML;
  assert.match(html, new RegExp(`class="apps-card-cover-img" src="/api/file/avatar\\?ref=${PIN}"`, 'u'));
  assert.match(html, new RegExp(`class="apps-card-icon" src="/api/file/avatar\\?ref=${PIN}"`, 'u'));
  assert.doesNotMatch(html, /ref=[^"]+\.png/u);
  assert.doesNotMatch(html, /ref=[^"]+\.jpg/u);

  await context.clickGridAction(`[data-apps-detail="${PIN}"]`);
  html = context.elements['[data-apps-modal-root]'].innerHTML;
  assert.match(html, /apps-detail-shots/);
  assert.match(html, new RegExp(`src="/api/file/avatar\\?ref=${PIN}"`, 'u'));
  assert.doesNotMatch(html, /ref=[^"]+\.webp/u);
});

test('apps page Bot picker renders profile avatars when available', async () => {
  const avatarDataUrl = 'data:image/png;base64,aW1hZ2U=';
  const context = createAppsPageContext({
    profiles: profilesPayload([{
      slug: 'alice',
      name: 'Alice',
      globalMetaId: 'idq1alice',
      avatarDataUrl,
      homeDir: '/tmp/alice',
      isActive: true,
    }]),
    apps: appsPayload(),
  });

  context.run();

  await context.waitFor(() => context.elements['[data-apps-bot-picker]'].innerHTML.includes(avatarDataUrl), 'render bot avatar');
  assert.match(context.elements['[data-apps-bot-picker]'].innerHTML, /class="apps-bot-avatar" src="data:image\/png;base64,aW1hZ2U="/);
});

test('apps page Bot picker resolves metafile avatar pin fields', async () => {
  const context = createAppsPageContext({
    profiles: profilesPayload([{
      slug: 'alice',
      name: 'Alice',
      globalMetaId: 'idq1alice',
      avatarPinId: PIN,
      homeDir: '/tmp/alice',
      isActive: true,
    }]),
    apps: appsPayload(),
  });

  context.run();

  await context.waitFor(() => context.elements['[data-apps-bot-picker]'].innerHTML.includes('/api/file/avatar?ref='), 'render bot metafile avatar');
  assert.match(context.elements['[data-apps-bot-picker]'].innerHTML, new RegExp(`/api/file/avatar\\?ref=${PIN}`, 'u'));
});

test('apps page copy pin action writes the pin id to clipboard', async () => {
  const context = createAppsPageContext({
    apps: appsPayload({
      records: [{
        pinId: PIN,
        title: 'Copyable App',
        appName: 'Copyable App',
        disabled: false,
      }],
      total: 1,
    }),
  });

  context.run();

  await context.waitFor(() => context.elements['[data-apps-grid]'].innerHTML.includes(PIN), 'render pin');
  await context.clickFake({ 'data-apps-copy-pin': PIN });

  assert.deepEqual(context.clipboardWrites, [PIN]);
});

test('apps page Run opens enabled MetaAPP and ignores disabled records', async () => {
  const enabled = createAppsPageContext({
    apps: appsPayload({
      records: [{
        pinId: PIN,
        title: 'Runnable App',
        appName: 'Runnable App',
        disabled: false,
      }],
      total: 1,
    }),
  });

  enabled.run();
  await enabled.waitFor(() => enabled.elements['[data-apps-grid]'].innerHTML.includes('Runnable App'), 'render runnable app');
  await enabled.clickGridAction(`[data-apps-run="${PIN}"]`);
  assert.equal(enabled.locationUrl.pathname, `/browser/metaapp/${PIN}`);

  const disabled = createAppsPageContext({
    apps: appsPayload({
      records: [{
        pinId: PIN,
        title: 'Stopped App',
        appName: 'Stopped App',
        disabled: true,
      }],
      total: 1,
    }),
  });

  disabled.run();
  await disabled.waitFor(() => disabled.elements['[data-apps-grid]'].innerHTML.includes('Stopped App'), 'render stopped app');
  await disabled.clickGridAction(`[data-apps-run="${PIN}"]`);
  assert.equal(disabled.locationUrl.pathname, '/ui/apps');
});

test('apps page detail modal displays MetaAPP protocol and MAN data', async () => {
  const context = createAppsPageContext({
    apps: appsPayload({
      records: [{
        pinId: PIN,
        firstPinId: PIN,
        operation: 'modify',
        title: 'Protocol Detail App',
        appName: 'Protocol Detail App',
        prompt: 'Show protocol fields.',
        intro: 'A chain detail view.',
        iconImg: 'https://cdn.example.test/icon.png',
        coverImg: 'https://cdn.example.test/cover.png',
        introImgs: ['https://cdn.example.test/intro.png'],
        tags: ['detail', 'metaapp'],
        runtime: 'browser/android',
        version: 'v2.0.0',
        contentType: 'application/zip',
        content: `metafile://${PIN}`,
        codeType: 'application/javascript',
        ownerAddress: '12ghVWG1yAgNjzXj4mr3qK9DgyornMUikZ',
        timestamp: 1710000000,
        txid: 'tx-detail',
        txids: ['tx-detail', 'tx-create'],
        metadata: { scope: 'detail' },
        raw: {
          path: '/protocols/metaapp',
          content: { title: 'Protocol Detail App' },
          txid: 'tx-detail',
        },
      }],
      total: 1,
    }),
  });

  context.run();
  await context.waitFor(() => context.elements['[data-apps-grid]'].innerHTML.includes('Protocol Detail App'), 'render detail app');
  await context.clickGridAction(`[data-apps-detail="${PIN}"]`);

  const html = context.elements['[data-apps-modal-root]'].innerHTML;
  assert.match(html, /MetaAPP details/);
  assert.match(html, /apps-protocol-detail/);
  assert.match(html, /apps-detail-top/);
  assert.match(html, /apps-detail-shots/);
  assert.match(html, /apps-detail-fields/);
  assert.match(html, /Details/);
  assert.match(html, /AI/);
  assert.match(html, /Raw/);
  assert.match(html, /Raw MAN record/);
  assert.match(html, /src="https:\/\/cdn\.example\.test\/icon\.png"/);
  assert.match(html, /src="https:\/\/cdn\.example\.test\/cover\.png"/);
  assert.match(html, /Protocol Detail App/);
  assert.match(html, /12ghVWG1yAgNjzXj4mr3qK9DgyornMUikZ/);
  assert.match(html, /\/protocols\/metaapp/);
});

test('apps page share modal exposes and copies MetaAPP protocol links', async () => {
  const context = createAppsPageContext({
    apps: appsPayload({
      records: [{
        pinId: PIN,
        title: 'Shareable App',
        appName: 'Shareable App',
        disabled: false,
      }],
      total: 1,
    }),
  });

  context.run();
  await context.waitFor(() => context.elements['[data-apps-grid]'].innerHTML.includes('Shareable App'), 'render shareable app');
  await context.clickGridAction(`[data-apps-share="${PIN}"]`);

  const metaappUri = `metaapp://${PIN}`;
  const metawebUrl = `https://metaweb.world/metaapp/${PIN}`;
  const html = context.elements['[data-apps-modal-root]'].innerHTML;
  assert.match(html, new RegExp(metaappUri.replace(/\//gu, '\\/')));
  assert.match(html, new RegExp(metawebUrl.replace(/\//gu, '\\/')));

  await context.clickModalAction(`[data-apps-copy-value="${metaappUri}"]`);
  await context.clickModalAction(`[data-apps-copy-value="${metawebUrl}"]`);
  assert.deepEqual(context.clipboardWrites, [metaappUri, metawebUrl]);
});

test('apps page delete flow posts revoke request and hides the record', async () => {
  const context = createAppsPageContext({
    apps: appsPayload({
      records: [{
        pinId: PIN,
        title: 'Delete Me',
        appName: 'Delete Me',
        disabled: false,
      }],
      total: 1,
    }),
  });

  context.run();
  await context.waitFor(() => context.elements['[data-apps-grid]'].innerHTML.includes('Delete Me'), 'render deletable app');
  await context.clickGridAction(`[data-apps-detail="${PIN}"]`);
  await context.clickModalAction(`[data-apps-delete-open="${PIN}"]`);

  assert.match(context.elements['[data-apps-modal-root]'].innerHTML, /Delete revokes this MetaAPP PIN/);
  await context.submitDeleteForm();

  await context.waitFor(() => context.fetchBodies.some((entry) => entry.url === '/api/metaapp/delete'), 'delete request');
  const request = context.fetchBodies.find((entry) => entry.url === '/api/metaapp/delete').body;
  assert.deepEqual(request, {
    from: 'alice',
    targetPinId: PIN,
    confirm: true,
  });
  assert.doesNotMatch(context.elements['[data-apps-grid]'].innerHTML, /Delete Me/);
  assert.match(context.elements['[data-apps-grid]'].innerHTML, /No apps yet/);
});

test('apps page focusable card opens details with keyboard activation', async () => {
  const context = createAppsPageContext({
    apps: appsPayload({
      records: [{
        pinId: PIN,
        title: 'Keyboard App',
        appName: 'Keyboard App',
        disabled: false,
      }],
      total: 1,
    }),
  });

  context.run();
  await context.waitFor(() => context.elements['[data-apps-grid]'].innerHTML.includes('Keyboard App'), 'render keyboard app');
  await context.keydownGridAction(`[data-apps-card="${PIN}"]`, 'Enter');

  assert.match(context.elements['[data-apps-modal-root]'].innerHTML, /MetaAPP details/);
  assert.match(context.elements['[data-apps-modal-root]'].innerHTML, /Keyboard App/);
});

test('apps page next pagination requests the next cursor', async () => {
  const context = createAppsPageContext({
    fetchApps: (url) => {
      const cursor = new URL(url, 'http://localhost').searchParams.get('cursor');
      return cursor === 'cursor-2'
        ? appsPayload({ records: [], nextCursor: '', total: 12 })
        : appsPayload({ records: [], nextCursor: 'cursor-2', total: 24 });
    },
  });

  context.run();

  await context.waitFor(() => context.elements['[data-apps-page-next]'].hidden === false, 'next button visible');
  await context.clickElement('[data-apps-page-next]');

  await context.waitFor(
    () => context.fetchUrls.some((url) => url.startsWith('/api/metaapp/list?') && new URL(url, 'http://localhost').searchParams.get('cursor') === 'cursor-2'),
    'next cursor request',
  );
});

test('apps page changing Bot reloads first Apps page for the new Bot', async () => {
  const context = createAppsPageContext({
    profiles: profilesPayload([
      { slug: 'alice', name: 'Alice', globalMetaId: 'idq1alice', avatar: null, isActive: true },
      { slug: 'bob', name: 'Bob', globalMetaId: 'idq1bob', avatar: null, isActive: false },
    ]),
    apps: appsPayload({ nextCursor: 'cursor-2' }),
  });

  context.run();

  await context.waitFor(() => context.fetchUrls.some((url) => url.startsWith('/api/metaapp/list?')), 'initial apps request');
  await context.clickFake({ 'data-apps-bot-option': 'bob' });

  await context.waitFor(
    () => context.fetchUrls.filter((url) => url.startsWith('/api/metaapp/list?') && new URL(url, 'http://localhost').searchParams.get('from') === 'bob').length === 1,
    'bob apps reload',
  );

  const bobUrl = context.fetchUrls.findLast((url) => url.startsWith('/api/metaapp/list?'));
  const params = new URL(bobUrl, 'http://localhost').searchParams;
  assert.equal(params.get('from'), 'bob');
  assert.equal(params.get('size'), '12');
  assert.equal(params.get('cursor'), null);
});

test('apps page ignores rapid duplicate Next clicks and Previous returns to the first page', async () => {
  const pageTwo = deferred();
  const context = createAppsPageContext({
    fetchApps: (url) => {
      const cursor = new URL(url, 'http://localhost').searchParams.get('cursor');
      if (cursor === 'cursor-2') {
        return pageTwo.promise;
      }
      return appsPayload({
        records: [{
          pinId: PIN,
          title: 'Page One',
          appName: 'Page One',
          disabled: false,
        }],
        nextCursor: 'cursor-2',
        total: 24,
      });
    },
  });

  context.run();

  await context.waitFor(() => context.elements['[data-apps-page-next]'].hidden === false, 'next button visible');
  const firstNext = context.clickElement('[data-apps-page-next]');
  const secondNext = context.clickElement('[data-apps-page-next]');

  await context.waitFor(
    () => context.fetchUrls.filter((url) => new URL(url, 'http://localhost').searchParams.get('cursor') === 'cursor-2').length >= 1,
    'first next-cursor request',
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(
    context.fetchUrls.filter((url) => new URL(url, 'http://localhost').searchParams.get('cursor') === 'cursor-2').length,
    1,
  );

  pageTwo.resolve(appsPayload({
    records: [{
      pinId: PIN,
      title: 'Page Two',
      appName: 'Page Two',
      disabled: false,
    }],
    nextCursor: '',
    total: 24,
  }));
  await Promise.all([firstNext, secondNext]);
  await context.waitFor(() => context.elements['[data-apps-page-prev]'].hidden === false, 'previous button visible');

  const requestCountBeforePrevious = context.fetchUrls.filter((url) => url.startsWith('/api/metaapp/list?')).length;
  await context.clickElement('[data-apps-page-prev]');

  await context.waitFor(
    () => context.fetchUrls.filter((url) => url.startsWith('/api/metaapp/list?')).length > requestCountBeforePrevious,
    'previous page request',
  );
  const previousUrl = context.fetchUrls.findLast((url) => url.startsWith('/api/metaapp/list?'));
  assert.equal(new URL(previousUrl, 'http://localhost').searchParams.get('cursor'), null);
});

test('apps page re-renders dynamic labels after local UI language changes', async () => {
  const context = createAppsPageContext({
    apps: appsPayload({
      records: [{
        pinId: PIN,
        title: 'Dynamic Labels',
        appName: 'Dynamic Labels',
        disabled: false,
      }],
      total: 1,
    }),
  });

  context.run();

  await context.waitFor(() => context.elements['[data-apps-grid]'].innerHTML.includes('Dynamic Labels'), 'render app card');
  assert.match(context.elements['[data-apps-grid]'].innerHTML, /Runnable/);
  assert.match(context.elements['[data-apps-grid]'].innerHTML, />Run</);

  context.context.__oacLocalUiI18n = {
    t: (key) => ({
      'apps.runnable': 'Runnable translated',
      'apps.run': 'Run translated',
      'apps.share': 'Share translated',
      'apps.details': 'Details translated',
      'apps.copyPinId': 'Copy translated',
      'apps.pageSizeLabel': 'Size translated',
    })[key] || key,
  };
  context.dispatchWindowEvent('oac:i18n-changed');

  await context.waitFor(() => context.elements['[data-apps-grid]'].innerHTML.includes('Run translated'), 'rerender translated run label');
  assert.match(context.elements['[data-apps-grid]'].innerHTML, /Runnable translated/);
  assert.match(context.elements['[data-apps-grid]'].innerHTML, /Copy translated/);
  assert.match(context.elements['[data-apps-grid]'].innerHTML, /Share translated/);
  assert.match(context.elements['[data-apps-grid]'].innerHTML, /Details translated/);
  assert.equal(context.elements['[data-apps-page-label]'].textContent, 'Size translated');
});

test('publish and edit modals expose matching MetaAPP form groups and edit save copy', async () => {
  assert.match(buildAppsPageDefinition().contentHtml, /data-apps-modal-root/);

  const context = createAppsPageContext({
    apps: appsPayload({
      records: [{
        pinId: PIN,
        title: 'Editable App',
        appName: 'Editable App',
        prompt: 'Use the selected Bot.',
        icon: `metafile://${PIN}`,
        coverImg: `metafile://${PIN}`,
        introImgs: [`metafile://${PIN}`],
        intro: 'Editable intro',
        runtime: 'browser/android',
        version: 'v1.2.3',
        contentType: 'application/zip',
        content: `metafile://${PIN}`,
        indexFile: 'index.html',
        code: `metafile://${PIN}`,
        codeType: 'application/javascript',
        tags: ['tool'],
        metadata: { scope: 'edit' },
        disabled: true,
      }],
      total: 1,
    }),
  });

  context.run();
  await context.waitFor(() => context.elements['[data-apps-grid]'].innerHTML.includes('Editable App'), 'render editable app');

  await context.clickElement('[data-apps-publish-open]');
  const publishHtml = context.elements['[data-apps-modal-root]'].innerHTML;
  const publishGroups = [...publishHtml.matchAll(/data-apps-form-section="([^"]+)"/gu)].map((match) => match[1]);
  assert.deepEqual(publishGroups, ['basic', 'assets', 'technical']);
  assert.match(publishHtml, /Basic information/);
  assert.match(publishHtml, /Assets/);
  assert.match(publishHtml, /Technical information/);
  assert.match(publishHtml, /metafile:\/\//);

  await context.clickGridAction(`[data-apps-edit="${PIN}"]`);
  const editHtml = context.elements['[data-apps-modal-root]'].innerHTML;
  const editGroups = [...editHtml.matchAll(/data-apps-form-section="([^"]+)"/gu)].map((match) => match[1]);
  assert.deepEqual(editGroups, publishGroups);
  assert.match(editHtml, /Save changes/);
  assert.equal(context.modalForm().dataset.mode, 'edit');
  assert.equal(context.elements['[data-apps-modal-root]'].querySelector('[name="title"]').value, 'Editable App');
});

test('publish modal shows the selected Bot as publisher', async () => {
  const avatarDataUrl = 'data:image/png;base64,cHVibGlzaGVy';
  const context = createAppsPageContext({
    url: 'http://localhost/ui/apps?from=bob',
    profiles: profilesPayload([
      { slug: 'alice', name: 'Alice', globalMetaId: 'idq1alice', avatar: null, isActive: true },
      { slug: 'bob', name: 'Builder Bot', globalMetaId: 'idq1bob', avatarDataUrl, isActive: false },
    ]),
  });

  context.run();
  await context.waitFor(() => context.elements['[data-apps-bot-picker]'].innerHTML.includes('Builder Bot'), 'selected bot render');
  await context.clickElement('[data-apps-publish-open]');

  const publishHtml = context.elements['[data-apps-modal-root]'].innerHTML;
  assert.match(publishHtml, /data-apps-publisher-badge/);
  assert.match(publishHtml, /Published by/);
  assert.match(publishHtml, /Builder Bot/);
  assert.match(publishHtml, /aria-label="Published by Builder Bot"/);
  assert.match(publishHtml, /class="apps-bot-avatar" src="data:image\/png;base64,cHVibGlzaGVy"/);
  assert.match(publishHtml, /id="apps-modal-title"[\s\S]*data-apps-publisher-badge[\s\S]*apps-modal-close/);
});

test('publish submits normalized form payload to /api/metaapp/publish', async () => {
  const secondPin = `${'a'.repeat(64)}i0`;
  const context = createAppsPageContext();

  context.run();
  await context.waitFor(() => context.fetchUrls.some((url) => url.startsWith('/api/metaapp/list?')), 'apps request');
  await context.clickElement('[data-apps-publish-open]');

  context.setField('appName', 'Agent Wiki Builder');
  context.setField('title', 'Agent Wiki Builder');
  context.setField('prompt', 'Build an index from trusted sources.');
  context.setField('intro', 'Indexes a project knowledge base.');
  context.setField('tags', 'wiki, builder');
  context.setField('icon', `metafile://${PIN}.png`);
  context.setField('coverImg', `${secondPin}.jpg`);
  context.setField('introImgs', `${PIN}.webp\nmetafile://${secondPin}.gif`);
  context.setField('content', `metafile://${PIN}.html`);
  context.setField('code', `${secondPin}.js`);
  context.setChecked('runtime', 'android', true);
  context.setField('contentType', 'text/html');
  context.setField('codeType', 'application/javascript');
  context.setField('metadata', '{"scope":"publish"}');

  await context.submitModalForm();

  await context.waitFor(() => context.fetchBodies.some((entry) => entry.url === '/api/metaapp/publish'), 'publish request');
  const request = context.fetchBodies.find((entry) => entry.url === '/api/metaapp/publish').body;
  assert.equal(request.from, 'alice');
  assert.equal(request.confirm, true);
  assert.equal(request.title, 'Agent Wiki Builder');
  assert.equal(request.appName, 'Agent Wiki Builder');
  assert.equal(request.icon, `metafile://${PIN}.png`);
  assert.equal(request.coverImg, `metafile://${secondPin}.jpg`);
  assert.deepEqual(request.introImgs, [`metafile://${PIN}.webp`, `metafile://${secondPin}.gif`]);
  assert.equal(request.content, `metafile://${PIN}.html`);
  assert.equal(request.code, `metafile://${secondPin}.js`);
  assert.deepEqual(request.runtime, ['browser', 'android']);
  assert.equal(request.contentType, 'text/html');
  assert.equal(request.codeType, 'application/javascript');
  assert.deepEqual(request.metadata, { scope: 'publish' });
  const reload = context.fetchUrls.findLast((url) => url.startsWith('/api/metaapp/list?'));
  assert.equal(new URL(reload, 'http://localhost').searchParams.get('cursor'), null);
});

test('publish keeps the modal open with chain progress and success txids', async () => {
  const publishPin = `${'c'.repeat(64)}i0`;
  const mutation = deferred();
  const context = createAppsPageContext({
    mutationResponse: () => mutation.promise,
  });

  context.run();
  await context.waitFor(() => context.fetchUrls.some((url) => url.startsWith('/api/metaapp/list?')), 'apps request');
  await context.clickElement('[data-apps-publish-open]');

  context.setField('appName', 'Agent Wiki Builder');
  context.setField('title', 'Agent Wiki Builder');
  context.setField('content', `metafile://${PIN}.html`);

  const submit = context.submitModalForm();
  await context.waitFor(() => context.fetchBodies.some((entry) => entry.url === '/api/metaapp/publish'), 'publish request');

  let html = context.elements['[data-apps-modal-root]'].innerHTML;
  assert.equal(context.elements['[data-apps-modal-root]'].hidden, false);
  assert.match(html, /data-apps-chain-status="pending"/);
  assert.match(html, /Writing to chain/);
  assert.match(html, /Agent Wiki Builder/);
  assert.doesNotMatch(html, /data-apps-form/);

  mutation.resolve({
    ok: true,
    state: 'success',
    data: {
      pinId: publishPin,
      metaappUri: `metaapp://${publishPin}`,
      chainWrite: {
        path: '/protocols/metaapp',
        txids: ['tx-publish-1', 'tx-publish-2'],
      },
    },
  });
  await submit;

  html = context.elements['[data-apps-modal-root]'].innerHTML;
  assert.equal(context.elements['[data-apps-modal-root]'].hidden, false);
  assert.match(html, /data-apps-chain-status="success"/);
  assert.match(html, /MetaAPP published on-chain/);
  assert.match(html, /tx-publish-1/);
  assert.match(html, /tx-publish-2/);
  assert.match(html, /1 to 2 minutes/);
  assert.match(html, /data-apps-copy-value="tx-publish-1"/);

  await context.clickModalAction('[data-apps-copy-value="tx-publish-1"]');
  assert.deepEqual(context.clipboardWrites, ['tx-publish-1']);
});

test('publish preserves http image refs while keeping packages as metafile refs', async () => {
  const secondPin = `${'a'.repeat(64)}i0`;
  const context = createAppsPageContext();

  context.run();
  await context.waitFor(() => context.fetchUrls.some((url) => url.startsWith('/api/metaapp/list?')), 'apps request');
  await context.clickElement('[data-apps-publish-open]');

  context.setField('appName', 'HTTP Image App');
  context.setField('title', 'HTTP Image App');
  context.setField('icon', 'https://cdn.example.test/icon.png');
  context.setField('coverImg', 'http://cdn.example.test/cover.png');
  context.setField('introImgs', `https://cdn.example.test/intro.png\n${secondPin}`);
  context.setField('content', PIN);
  context.setField('code', secondPin);

  await context.submitModalForm();

  await context.waitFor(() => context.fetchBodies.some((entry) => entry.url === '/api/metaapp/publish'), 'publish request');
  const request = context.fetchBodies.find((entry) => entry.url === '/api/metaapp/publish').body;
  assert.equal(request.icon, 'https://cdn.example.test/icon.png');
  assert.equal(request.coverImg, 'http://cdn.example.test/cover.png');
  assert.deepEqual(request.introImgs, ['https://cdn.example.test/intro.png', `metafile://${secondPin}`]);
  assert.equal(request.content, `metafile://${PIN}`);
  assert.equal(request.code, `metafile://${secondPin}`);
});

test('edit keeps the modal open with chain progress and update txids', async () => {
  const updatePin = `${'d'.repeat(64)}i0`;
  const mutation = deferred();
  const context = createAppsPageContext({
    apps: appsPayload({
      records: [{
        pinId: PIN,
        title: 'Editable App',
        appName: 'Editable App',
        runtime: 'browser',
        content: `metafile://${PIN}.html`,
        disabled: false,
      }],
      total: 1,
    }),
    mutationResponse: () => mutation.promise,
  });

  context.run();
  await context.waitFor(() => context.elements['[data-apps-grid]'].innerHTML.includes('Editable App'), 'render editable app');
  await context.clickGridAction(`[data-apps-edit="${PIN}"]`);
  context.setField('title', 'Updated Editable App');

  const submit = context.submitModalForm();
  await context.waitFor(() => context.fetchBodies.some((entry) => entry.url === '/api/metaapp/update'), 'update request');

  let html = context.elements['[data-apps-modal-root]'].innerHTML;
  assert.equal(context.elements['[data-apps-modal-root]'].hidden, false);
  assert.match(html, /data-apps-chain-status="pending"/);
  assert.match(html, /Writing to chain/);
  assert.match(html, /Updated Editable App/);
  assert.doesNotMatch(html, /data-apps-form/);

  mutation.resolve({
    ok: true,
    state: 'success',
    data: {
      pinId: updatePin,
      targetPinId: PIN,
      chainWrite: {
        path: `@${PIN}`,
        txids: ['tx-update-1'],
      },
    },
  });
  await submit;

  html = context.elements['[data-apps-modal-root]'].innerHTML;
  assert.equal(context.elements['[data-apps-modal-root]'].hidden, false);
  assert.match(html, /data-apps-chain-status="success"/);
  assert.match(html, /MetaAPP updated on-chain/);
  assert.match(html, /tx-update-1/);
  assert.match(html, /1 to 2 minutes/);

  await context.clickModalAction('[data-apps-copy-value="tx-update-1"]');
  assert.deepEqual(context.clipboardWrites, ['tx-update-1']);
});

test('edit submits to /api/metaapp/update with target pin and changed values', async () => {
  const context = createAppsPageContext({
    apps: appsPayload({
      records: [{
        pinId: PIN,
        title: 'Original Title',
        appName: 'Original App',
        prompt: 'Original prompt',
        icon: `metafile://${PIN}`,
        coverImg: `metafile://${PIN}`,
        introImgs: [`metafile://${PIN}`],
        intro: 'Original intro',
        runtime: 'browser',
        version: 'v1.0.0',
        contentType: 'application/zip',
        content: `metafile://${PIN}`,
        indexFile: 'index.html',
        code: `metafile://${PIN}`,
        codeType: 'application/json',
        tags: ['original'],
        metadata: { current: true },
      }],
      total: 1,
    }),
  });

  context.run();
  await context.waitFor(() => context.elements['[data-apps-grid]'].innerHTML.includes('Original Title'), 'render original app');
  await context.clickGridAction(`[data-apps-edit="${PIN}"]`);

  assert.equal(context.elements['[data-apps-modal-root]'].querySelector('[name="title"]').value, 'Original Title');
  assert.equal(context.elements['[data-apps-modal-root]'].querySelector('[name="version"]').value, 'v1.0.1');
  assert.match(context.elements['[data-apps-modal-root]'].innerHTML, /Previous version: v1\.0\.0/);
  context.setField('title', 'Updated Title');
  context.setField('appName', 'Updated App');
  context.setChecked('runtime', 'ios', true);
  await context.submitModalForm();

  await context.waitFor(() => context.fetchBodies.some((entry) => entry.url === '/api/metaapp/update'), 'update request');
  const request = context.fetchBodies.find((entry) => entry.url === '/api/metaapp/update').body;
  assert.equal(request.from, 'alice');
  assert.equal(request.confirm, true);
  assert.equal(request.targetPinId, PIN);
  assert.equal(request.title, 'Updated Title');
  assert.equal(request.appName, 'Updated App');
  assert.equal(request.version, 'v1.0.1');
  assert.deepEqual(request.runtime, ['browser', 'ios']);
});

test('publish form marks required and optional fields while defaulting optional title to app name', async () => {
  const context = createAppsPageContext();

  context.run();
  await context.waitFor(() => context.fetchUrls.some((url) => url.startsWith('/api/metaapp/list?')), 'apps request');
  await context.clickElement('[data-apps-publish-open]');

  const html = context.elements['[data-apps-modal-root]'].innerHTML;
  assert.match(html, /data-apps-required-field="appName"/);
  assert.match(html, /data-apps-required-field="content"/);
  assert.match(html, /data-apps-optional-field="title"/);
  assert.match(html, /data-apps-optional-field="icon"/);
  assert.match(html, /apps-required-mark[^>]*>\*<\/span>/);
  assert.match(html, /\(optional\)/);

  context.setField('appName', 'Required Fields App');
  context.setField('content', PIN);
  await context.submitModalForm();

  await context.waitFor(() => context.fetchBodies.some((entry) => entry.url === '/api/metaapp/publish'), 'publish request');
  const request = context.fetchBodies.find((entry) => entry.url === '/api/metaapp/publish').body;
  assert.equal(request.appName, 'Required Fields App');
  assert.equal(request.title, 'Required Fields App');
  assert.equal(request.content, `metafile://${PIN}`);
});

test('manual multi asset field normalizes comma and newline PINs into metafile array', async () => {
  const secondPin = `${'c'.repeat(64)}i0`;
  const thirdPin = `${'d'.repeat(64)}i0`;
  const context = createAppsPageContext();

  context.run();
  await context.waitFor(() => context.fetchUrls.some((url) => url.startsWith('/api/metaapp/list?')), 'apps request');
  await context.clickElement('[data-apps-publish-open]');
  context.setField('appName', 'Gallery App');
  context.setField('title', 'Gallery App');
  context.setField('icon', PIN);
  context.setField('coverImg', PIN);
  context.setField('introImgs', `${PIN}, ${secondPin}\nmetafile://${thirdPin}`);
  context.setField('content', PIN);

  await context.submitModalForm();

  await context.waitFor(() => context.fetchBodies.some((entry) => entry.url === '/api/metaapp/publish'), 'publish request');
  const request = context.fetchBodies.find((entry) => entry.url === '/api/metaapp/publish').body;
  assert.deepEqual(request.introImgs, [`metafile://${PIN}`, `metafile://${secondPin}`, `metafile://${thirdPin}`]);
});

test('upload with a browser File posts raw bytes to large upload route and stores returned metafile URI', async () => {
  const uploadedPin = `${'e'.repeat(64)}i0`;
  const fileBytes = Buffer.from('content package bytes');
  const expectedHash = createHash('sha256').update(fileBytes).digest('hex');
  const selectedFile = {
    name: 'bundle.zip',
    size: 5 * 1024 * 1024,
    type: 'application/zip',
    arrayBuffer: async () => fileBytes.buffer.slice(fileBytes.byteOffset, fileBytes.byteOffset + fileBytes.byteLength),
  };
  const context = createAppsPageContext({
    uploadResponse: {
      ok: true,
      state: 'success',
      data: { metafileUri: `metafile://${uploadedPin}.zip` },
    },
  });

  context.run();
  await context.waitFor(() => context.fetchUrls.some((url) => url.startsWith('/api/metaapp/list?')), 'apps request');
  await context.clickElement('[data-apps-publish-open]');
  await context.uploadAssetFile('content', selectedFile);

  await context.waitFor(() => context.fetchBodies.some((entry) => entry.url.startsWith('/api/file/upload-large?')), 'large upload request');
  const upload = context.fetchBodies.find((entry) => entry.url.startsWith('/api/file/upload-large?'));
  assert.equal(upload.body, selectedFile);
  assert.equal(upload.headers['content-type'], 'application/zip');
  const uploadUrl = new URL(upload.url, 'http://localhost');
  assert.equal(uploadUrl.pathname, '/api/file/upload-large');
  assert.equal(uploadUrl.searchParams.get('mode'), 'raw');
  assert.equal(uploadUrl.searchParams.get('from'), 'alice');
  assert.equal(uploadUrl.searchParams.get('fileName'), 'bundle.zip');
  assert.equal(context.elements['[data-apps-modal-root]'].querySelector('[name="content"]').value, `metafile://${uploadedPin}.zip`);
  assert.equal(context.elements['[data-apps-modal-root]'].querySelector('[name="contentHash"]').value, expectedHash);
  const contentHashSource = context.elements['[data-apps-modal-root]'].querySelector('[data-apps-content-hash-source]');
  assert.ok(contentHashSource);
  assert.match(contentHashSource.textContent, new RegExp(`metafile://${uploadedPin}\\.zip`));

  context.setField('appName', 'Uploaded App');
  context.setField('title', 'Uploaded App');
  context.setField('icon', PIN);
  context.setField('coverImg', PIN);
  await context.submitModalForm();

  await context.waitFor(() => context.fetchBodies.some((entry) => entry.url === '/api/metaapp/publish'), 'publish request');
  const request = context.fetchBodies.find((entry) => entry.url === '/api/metaapp/publish').body;
  assert.equal(request.content, `metafile://${uploadedPin}.zip`);
  assert.equal(request.contentHash, expectedHash);
});

test('upload failure after raw browser file upload shows a field-level error and does not fake a URI', async () => {
  const context = createAppsPageContext({
    uploadResponse: {
      ok: false,
      state: 'failed',
      message: 'upload unavailable',
    },
  });

  context.run();
  await context.waitFor(() => context.fetchUrls.some((url) => url.startsWith('/api/metaapp/list?')), 'apps request');
  await context.clickElement('[data-apps-publish-open]');
  await context.uploadAssetFile('content', {
    name: 'bundle.zip',
    size: 128,
    type: 'application/zip',
  });

  await context.waitFor(() => context.fetchBodies.some((entry) => entry.url.startsWith('/api/file/upload?')), 'upload request');
  assert.equal(context.elements['[data-apps-modal-root]'].querySelector('[name="content"]').value, '');
  const error = context.elements['[data-apps-modal-root]'].querySelector('[data-apps-field-error="content"]');
  assert.ok(error);
  assert.match(error.textContent, /upload unavailable/i);
});

test('invalid manual asset PIN blocks publish and marks the field error', async () => {
  const context = createAppsPageContext();

  context.run();
  await context.waitFor(() => context.fetchUrls.some((url) => url.startsWith('/api/metaapp/list?')), 'apps request');
  await context.clickElement('[data-apps-publish-open]');
  context.setField('appName', 'Invalid Asset App');
  context.setField('title', 'Invalid Asset App');
  context.setField('icon', 'not-a-pin');
  context.setField('coverImg', PIN);
  context.setField('content', PIN);

  await context.submitModalForm();

  assert.equal(context.fetchBodies.some((entry) => entry.url === '/api/metaapp/publish'), false);
  const error = context.elements['[data-apps-modal-root]'].querySelector('[data-apps-field-error="icon"]');
  assert.ok(error);
  assert.equal(error.hidden, false);
  assert.match(error.textContent, /PIN/i);
});

test('invalid intro image PIN blocks edit update and marks introImgs', async () => {
  const context = createAppsPageContext({
    apps: appsPayload({
      records: [{
        pinId: PIN,
        title: 'Invalid Intro App',
        appName: 'Invalid Intro App',
        icon: `metafile://${PIN}`,
        coverImg: `metafile://${PIN}`,
        introImgs: [`metafile://${PIN}`],
        content: `metafile://${PIN}`,
        runtime: 'browser',
        contentType: 'application/zip',
        codeType: 'application/zip',
      }],
      total: 1,
    }),
  });

  context.run();
  await context.waitFor(() => context.elements['[data-apps-grid]'].innerHTML.includes('Invalid Intro App'), 'render invalid intro app');
  await context.clickGridAction(`[data-apps-edit="${PIN}"]`);
  context.setField('introImgs', `${PIN}\ninvalid-pin`);

  await context.submitModalForm();

  assert.equal(context.fetchBodies.some((entry) => entry.url === '/api/metaapp/update'), false);
  const error = context.elements['[data-apps-modal-root]'].querySelector('[data-apps-field-error="introImgs"]');
  assert.ok(error);
  assert.equal(error.hidden, false);
  assert.match(error.textContent, /PIN/i);
});

test('content and code type selects mirror server options and preserve legacy values', async () => {
  const context = createAppsPageContext({
    apps: appsPayload({
      records: [{
        pinId: PIN,
        title: 'Legacy Types App',
        appName: 'Legacy Types App',
        icon: `metafile://${PIN}`,
        coverImg: `metafile://${PIN}`,
        introImgs: [`metafile://${PIN}`],
        runtime: 'browser',
        contentType: 'application/vnd.legacy-content',
        codeType: 'application/vnd.legacy-code',
      }],
      total: 1,
    }),
  });

  context.run();
  await context.waitFor(() => context.elements['[data-apps-grid]'].innerHTML.includes('Legacy Types App'), 'render legacy types app');
  await context.clickElement('[data-apps-publish-open]');
  let html = context.elements['[data-apps-modal-root]'].innerHTML;
  for (const value of METAAPP_CONTENT_TYPE_OPTIONS) {
    assert.match(html, new RegExp(`<option value="${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'u'), `${value} missing from contentType options`);
  }
  for (const value of METAAPP_CODE_TYPE_OPTIONS) {
    assert.match(html, new RegExp(`<option value="${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'u'), `${value} missing from codeType options`);
  }
  const codeSelect = html.match(/<select name="codeType">([\s\S]*?)<\/select>/u)?.[1] ?? '';
  assert.doesNotMatch(html, /<option value="text\/plain;utf-8"/);
  assert.doesNotMatch(codeSelect, /text\/plain;utf-8/);
  assert.doesNotMatch(codeSelect, /application\/octet-stream/);

  await context.clickGridAction(`[data-apps-edit="${PIN}"]`);
  html = context.elements['[data-apps-modal-root]'].innerHTML;
  assert.match(html, /<option value="application\/vnd\.legacy-content" selected>application\/vnd\.legacy-content \(current\)<\/option>/);
  assert.match(html, /<option value="application\/vnd\.legacy-code" selected>application\/vnd\.legacy-code \(current\)<\/option>/);
});

test('card renders a real Edit action that opens the edit modal', async () => {
  const context = createAppsPageContext({
    apps: appsPayload({
      records: [{
        pinId: PIN,
        title: 'Real Edit App',
        appName: 'Real Edit App',
        icon: `metafile://${PIN}`,
        coverImg: `metafile://${PIN}`,
        introImgs: [`metafile://${PIN}`],
        runtime: 'browser',
      }],
      total: 1,
    }),
  });

  context.run();
  await context.waitFor(() => context.elements['[data-apps-grid]'].innerHTML.includes('Real Edit App'), 'render real edit app');
  assert.match(context.elements['[data-apps-grid]'].innerHTML, new RegExp(`data-apps-edit="${PIN}"`, 'u'));

  await context.clickGridAction(`[data-apps-edit="${PIN}"]`);

  assert.equal(context.elements['[data-apps-modal-root]'].hidden, false);
  assert.equal(context.modalForm().dataset.mode, 'edit');
  assert.equal(context.elements['[data-apps-modal-root]'].querySelector('[name="title"]').value, 'Real Edit App');
});

test('multiple intro image uploads store returned URIs in order and submit an array payload', async () => {
  const firstUploadedPin = `${'e'.repeat(64)}i0`;
  const secondUploadedPin = `${'f'.repeat(64)}i0`;
  const context = createAppsPageContext({
    uploadResponse: (url, body, count) => ({
      ok: true,
      state: 'success',
      data: { metafileUri: count === 1 ? `metafile://${firstUploadedPin}.png` : `metafile://${secondUploadedPin}.png` },
    }),
  });

  context.run();
  await context.waitFor(() => context.fetchUrls.some((url) => url.startsWith('/api/metaapp/list?')), 'apps request');
  await context.clickElement('[data-apps-publish-open]');
  await context.uploadAssetFile('introImgs', [
    { name: 'one.png', size: 512, type: 'image/png' },
    { name: 'two.png', size: 1024, type: 'image/png' },
  ]);

  await context.waitFor(
    () => context.fetchBodies.filter((entry) => entry.url.startsWith('/api/file/upload?')).length === 2,
    'two upload requests',
  );
  assert.deepEqual(
    context.fetchBodies.filter((entry) => entry.url.startsWith('/api/file/upload?')).map((entry) => entry.body.name),
    ['one.png', 'two.png'],
  );
  assert.deepEqual(
    context.fetchBodies.filter((entry) => entry.url.startsWith('/api/file/upload?')).map((entry) => new URL(entry.url, 'http://localhost').searchParams.get('fileName')),
    ['one.png', 'two.png'],
  );
  assert.equal(
    context.elements['[data-apps-modal-root]'].querySelector('[name="introImgs"]').value,
    `metafile://${firstUploadedPin}.png\nmetafile://${secondUploadedPin}.png`,
  );

  context.setField('appName', 'Uploaded Intro App');
  context.setField('title', 'Uploaded Intro App');
  context.setField('icon', PIN);
  context.setField('coverImg', PIN);
  context.setField('content', PIN);
  await context.submitModalForm();

  await context.waitFor(() => context.fetchBodies.some((entry) => entry.url === '/api/metaapp/publish'), 'publish request');
  const request = context.fetchBodies.find((entry) => entry.url === '/api/metaapp/publish').body;
  assert.deepEqual(request.introImgs, [`metafile://${firstUploadedPin}.png`, `metafile://${secondUploadedPin}.png`]);
});
