# MetaID Protocols: Social and Interaction

**Scope**: Lightweight social interactions, including buzz posts, likes, comments, and donations.

## 1. SimpleBuzz

- **Intro**: A lightweight protocol for publishing microblog posts, activity updates, or status updates. It can also quote or repost another buzz. It supports arbitrary text length and attachments.
- **Path**: `/protocols/simplebuzz`
- **Version**: `1.0.0`
- **Content-Type**: `application/json`
- **Payload Schema**:

```json5
{
  "content": "This is a buzz. It supports arbitrary length.",
  "contentType": "text/plain;utf-8",
  /** Attachments related to this buzz, such as images or videos. Prefer metafile:// references to PINIDs. */
  "attachments": [],
  /** Referenced PINID for quote or repost behavior. */
  "quotePin": "9f995b4f978b...i0"
}
```

## 2. PayLike

- **Intro**: A simple like protocol. It currently supports likes and dislikes for on-chain PIN content.
- **Path**: `/protocols/paylike`
- **Version**: `1.0.0`
- **Content-Type**: `application/json`
- **Payload Schema**:

```json5
{
  /** -1 means dislike, 0 means cancel like or dislike, and 1 means like. */
  "isLike": 1,
  /** PINID of the liked content. */
  "likeTo": "9f995b4f978b...i0"
}
```

## 3. PayComment

- **Intro**: A simple comment protocol for commenting on any on-chain PIN.
- **Path**: `/protocols/paycomment`
- **Version**: `1.0.0`
- **Content-Type**: `application/json`
- **Payload Schema**:

```json5
{
  "content": "This is a comment. It supports arbitrary length.",
  "contentType": "text/plain;utf-8",
  /** PINID of the commented content. */
  "commentTo": "9f995b4f978b...i0"
}
```

## 4. SimpleDonate

- **Intro**: A lightweight donation protocol. The transaction builder must include the corresponding asset output.
- **Path**: `/protocols/simpledonate`
- **Version**: `1.0.0`
- **Content-Type**: `application/json`
- **Payload Schema**:

```json5
{
  /** Donation timestamp. */
  "createTime": "1768284841944",
  /** Donation recipient address. */
  "to": "1PefP7Wo8koYDdWTKCNSKgaN2J9SrVGHW5",
  /** Asset type, such as btc or mvc. */
  "coinType": "btc",
  /** Total donation amount. */
  "amount": "0.01",
  /** Optional PINID that this donation targets. */
  "toPin": "9f995b4f978b...i0",
  /** Donation message. */
  "message": "Good job."
}
```
