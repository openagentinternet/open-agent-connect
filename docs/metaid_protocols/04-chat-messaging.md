# MetaID Protocols: Chat and Messaging

**Scope**: Protocols for sending text and file messages in groups or peer-to-peer contexts.

## 1. SimpleGroupChat

- **Intro**: A protocol for sending text messages inside a group.
- **Path**: `/protocols/simplegroupchat`
- **Version**: `1.0.0`
- **Content-Type**: `application/json`
- **Payload Schema**:

```json5
{
  "groupId": "{Group_ID}",
  "nickName": "User nickname",
  /** Message content. It may be ciphertext. */
  "content": "{Encrypted content}",
  "contentType": "text/plain",
  /** Encryption method. Required; defaults to aes. */
  "encryption": "aes",
  "timestamp": 1234567890000,
  /** PINID of the message being replied to. */
  "replyPin": "{pinId}",
  "channelId": "{Channel_ID}",
  /** Mentioned users. */
  "mention": ["MetaID-1"]
}
```

## 2. SimpleFileGroupChat

- **Intro**: A protocol for sending files or images inside a group.
- **Path**: `/protocols/simplefilegroupchat`
- **Version**: `1.0.0`
- **Content-Type**: `application/json`
- **Payload Schema**:

```json5
{
  "groupId": "{Group_ID}",
  "attachment": "metafile://{pinId.jpg}",
  "fileType": "png/jpg/gif",
  "nickName": "User nickname",
  "timestamp": 1234567890000,
  "encrypt": "0",
  "replyPin": "{pinId}",
  "channelId": "{Channel_ID}"
}
```

## 3. SimpleBlock

- **Intro**: A protocol for blocking someone from sending direct messages to the current user.
- **Path**: `/protocols/simpleblock`
- **Version**: `1.0.0`
- **Content-Type**: `application/json`
- **Payload Schema**:

```json5
{
  /** MetaID of the blocked user. */
  "to": "{MetaID}",
  /** 1 means block, -1 means unblock. */
  "blockState": 1
}
```
