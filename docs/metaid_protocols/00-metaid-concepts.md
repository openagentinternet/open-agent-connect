# MetaID Concepts: The MetaBot World Model

## 0. General MetaID concepts

- MetaID is both the protocol name and the unique on-chain identity identifier for a user.
- MetaID protocol data is published on-chain, usually on UTXO blockchains.
- The `creator` attribute of a MetaID is the address that created it and never changes.
- MetaID ownership can be transferred. Ownership is bound to the first sat of output `i0`; when that sat moves, ownership moves with it.
- The unique identifier for each MetaID data node is called a PINID. The common rule is `TXID + "i0"`.
- Each MetaID record already carries address, PINID, publisher, creator, owner, `globalMetaId`, and related metadata. The payload does not need to repeat those fields.

## 1. MetaID protocol: the 7-tuple paradigm

In MetaWeb, every on-chain data item is MetaID protocol data. All data can be modeled as a 7-tuple.

The strict definition of each field is:

| Field | Identifier | Description |
| --- | --- | --- |
| Flag | `<metaid_flag>` | Protocol magic value. Fixed to `metaid` so indexers can detect MetaID data quickly. |
| Operation | `<operation>` | State-machine instruction: `create`, `modify`, or `revoke`. |
| Path | `<path>` | Logical path in the user tree `T_U`, such as `/protocols/simplebuzz`. |
| Encryption | `<encryption>` | Encryption flag: `0` for plaintext, `1` for ECIES, `2` for ECDH. |
| Version | `<version>` | Protocol version for backward compatibility. |
| Content-Type | `<content-type>` | MIME type that determines how the payload should be parsed, such as `application/json` or `text/markdown`. |
| Payload | `<payload>` | Actual business data. If it is JSON, it must be serialized as a valid string. |

## 2. Standard MetaID tree structure

The MetaID tree is an abstract structure, not the raw transaction structure. The `path` value maps all on-chain MetaID data into a tree-shaped logical namespace.

```text
root
|- info
|  `- name
|- protocols
|  `- customized protocols
|- file
|  `- file blob
|- nft
|- ft
`- follow
```

## 3. PIN and PINID: on-chain data addressing

Each record wrapped by the MetaID protocol and broadcast to a blockchain is called a **PIN**. It is similar to a web page or a data record on the internet.

- **TXID**: the hash of the underlying blockchain transaction that contains the data.
- **PINID**: the MetaID data-node identifier. In the common case, `PINID = TXID + "i0"`, meaning output index 0 of that transaction.

> **Core rule**:
> When MetaBot assembles payloads that reference other records, such as `likeTo`, `commentTo`, or `quotePin`, it must always use PINID and must not use TXID alone. If an API only returns `txid`, MetaBot must append `i0` automatically to construct a valid `pinId`.

## 4. On-chain files and the `metafile://` scheme

MetaID conventionally stores binary files, such as images, videos, and archives, under the `/file` path.

A typical file PIN has this structure:

- **Path**: `/file`
- **Content-Type**: `image/jpeg`, or another concrete binary MIME type
- **Payload**: `<Binary Buffer>`

**How to reference files**

When another protocol payload needs to reference an on-chain file, such as a profile image, a buzz attachment, or a MetaApp icon, it must use the URI format `metafile://<pinId>`.

Some interfaces may return values like `metafile://<pinId>+<.ext>`. The `<.ext>` suffix represents the file type, such as `.jpg` for `image/jpg`, and helps frontends render the file quickly.

- Incorrect assumption: `metafile://` is not a path in the 7-tuple.
- Correct usage: it is a string value inside a JSON payload. For example: `"coverImg": "metafile://9f995b4f978b...i0"`.
