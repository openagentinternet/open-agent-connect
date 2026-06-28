# MetaBot Homepage Contract

> Audience: developers integrating MetaBot homepage selection into another platform.
> Scope: how a local MetaBot publishes and resolves its **public Homepage** ("Bot Page") on-chain, and the three selection modes a platform should expose.

A MetaBot's Homepage is the public page shown when someone opens the Bot's `metaid://<GlobalMetaID>` URL in an Agent Internet Browser. Each platform ships its own **default template**; owners can override it with either a published **Metafile** or a published **MetaApp**.

There are exactly **three selection modes**:

| Mode | What it means | On-chain `/info/homepage` payload |
|---|---|---|
| **Default** | Use the platform's built-in template (no custom homepage). | empty (cleared) |
| **Metafile** | Render a single published file (HTML/PNG/…) referenced by `metafile://`. | `{ uri: "metafile://….html", renderer: "auto", contentType: "text/html" }` |
| **MetaApp** | Render a published MetaApp (interactive app bundle) referenced by `metaapp://`. | `{ uri: "metaapp://…", renderer: "metaapp", contentType: "application/vnd.metaapp" }` |

---

## 1. The homepage pointer object

The homepage is a small JSON object persisted locally and mirrored on-chain:

```json
{
  "uri": "metaapp://b8f…pin-id",
  "renderer": "metaapp",
  "contentType": "application/vnd.metaapp"
}
```

Fields:

- **`uri`** *(required, string)* — Homepage resource URI. Must start with one of:
  - `metafile://<pinId>.<ext>` — a file published on-chain (the Metafile protocol). `metafile://<pinId>` is also protocol-valid when the extension is unknown, but official integrations should preserve or add the extension when the content type is known.
  - `metaapp://<metaAppPinId>` — a published MetaApp bundle (the MetaApp protocol).
  - Must not contain whitespace.
- **`renderer`** *(string)* — Rendering hint.
  - `metaapp` — the URI targets a MetaApp and must be rendered by the MetaApp runtime.
  - `auto` — the reader infers the renderer from the URI scheme / content type (used for Metafile homepages).
  - If omitted, readers infer `metaapp` when the URI starts with `metaapp://`, otherwise `auto`.
- **`contentType`** *(string)* — MIME type of the target resource. Defaults:
  - `application/vnd.metaapp` for MetaApp homepages.
  - `application/octet-stream` for Metafile homepages when no type is known (use the real type, e.g. `text/html` or `image/png`, if you know it).

> A **Default** homepage is represented by the *absence* of this object (or an empty payload on-chain). There is no `uri` for the default mode.

---

## 2. On-chain write: the `/info/homepage` path

The homepage pointer is published as a **Bot Info** record under the path `/info/homepage` for the Bot's MetaID. This follows the standard MetaID Pin tuple.

**Tuple**

```
metaid create /info/homepage 0 1.0 application/json <payload>
```

- `operation`: `create` (always use `create` for both initial publish and updates — do **not** use `modify`).
- `encryption`: `0`
- `version`: `1.0`
- `contentType`: `application/json`
- `payload`: the homepage object serialized to a compact JSON string (see §3), UTF-8.

**Readers** resolve `/info/homepage` to the *latest valid* record for the MetaID and parse the payload as the homepage object.

### Setting a custom homepage (Metafile or MetaApp)

Write the homepage object JSON as the payload:

```
payload = {"uri":"metafile://abc123….html","renderer":"auto","contentType":"text/html"}
```

Example MetaApp:

```json
{
  "uri": "metaapp://b8f…pin-id",
  "renderer": "metaapp",
  "contentType": "application/vnd.metaapp"
}
```

### Resetting back to Default

Clear the homepage by writing the **same `/info/homepage` path with an empty payload** (do not use `revoke`):

```
metaid create /info/homepage 0 1.0 application/json ""
```

When the latest payload is empty (or the path has no record), readers fall back to their **default** Bot homepage template.

### Update ordering note

If multiple Bot Info fields are written in one sync, add a short delay (a few seconds) between Pin writes. Each `/info/*` field is its own on-chain record; indexers resolve them independently by path.

---

## 3. The three modes — exact payloads

### Mode 1 — Default (platform template)

No homepage object. On-chain payload is **empty**.

- UI selection: "Default".
- Result: the browser renders the built-in Bot Page template using the Bot's `/info/name`, `/info/avatar`, `/info/bio`, `/info/llm`, `/info/persona` records.

### Mode 2 — Metafile (custom single file)

The owner uploads a local file (e.g. an `index.html`), it is published on-chain via the Metafile protocol and gets a `pinId`. The homepage object points at it:

```json
{
  "uri": "metafile://3a9f…pinId.html",
  "renderer": "auto",
  "contentType": "text/html"
}
```

- The `metafile://` URI is preferably `metafile://<pinId>.<ext>` when `contentType` is known. The bare `metafile://<pinId>` form remains valid for unknown types.
- `renderer` is `auto` — the reader renders the file according to its content type (render HTML, display an image, etc.).
- `contentType` should match the uploaded file's MIME type.

### Mode 3 — MetaApp (custom interactive app)

The owner packages and publishes a MetaApp via the MetaApp protocol and gets a `metaAppPinId`. The homepage object points at it:

```json
{
  "uri": "metaapp://b8f…metaAppPinId",
  "renderer": "metaapp",
  "contentType": "application/vnd.metaapp"
}
```

- The URI must start with `metaapp://`.
- `renderer` **must** be `metaapp` so the reader loads the MetaApp runtime.
- `contentType` is `application/vnd.metaapp`.

---

## 4. Recommended local persistence

Mirror the selected homepage locally so the platform can show the current selection without a chain read, and so it knows when to push an on-chain update.

- Store the homepage object as JSON (e.g. a `homepage.json` file under the Bot's runtime state directory).
- Storing `null`/absent = Default mode.
- On "Save", compare the new object to the stored one; if the homepage field changed, write `/info/homepage` on-chain (custom object as payload, or empty payload to reset to Default).

---

## 5. Reader / rendering rules (summary)

1. Read the latest valid `/info/homepage` record for the MetaID.
2. If the payload is **empty or missing** → render the platform **default** Bot homepage template. Stop.
3. Parse the JSON payload into the homepage object.
4. Branch on the URI scheme:
   - `metaapp://<pinId>` (or `renderer === "metaapp"`) → resolve the MetaApp pin and render it with the MetaApp runtime.
   - `metafile://<pinId>[.<ext>]` → resolve the Metafile content and render by content type (`text/html` → iframe/render, `image/*` → image, etc.).
5. If the URI is malformed or cannot be resolved, fall back to the default template.

---

## 6. Minimal checklist for the integrating platform

- [ ] Expose a homepage source selector with three options: **Default / Metafile / MetaApp**.
- [ ] For **Metafile**: upload the file, publish it on-chain, capture the returned `pinId`, build `metafile://<pinId>.<ext>` when the content type or file name is known, and store/publish the homepage object with `renderer: "auto"`.
- [ ] For **MetaApp**: accept a MetaApp pin ID input, build `metaapp://<pinId>`, store/publish with `renderer: "metaapp"`, `contentType: "application/vnd.metaapp"`.
- [ ] For **Default**: clear the local homepage object and publish an **empty** `/info/homepage` payload.
- [ ] Always publish `/info/homepage` as `metaid create /info/homepage 0 1.0 application/json <payload>`.
- [ ] On read, an empty/missing payload means "use the default template".
