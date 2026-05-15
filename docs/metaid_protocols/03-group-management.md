# MetaID Protocols: Group Management

**Scope**: Group creation, membership, allowlists, blocklists, administrator settings, and related management operations.

## 1. SimpleGroupCreate

- **Intro**: A protocol for creating or modifying the base information of an on-chain group.
- **Path**: `/protocols/simplegroupcreate`
- **Version**: `1.0.0`
- **Content-Type**: `application/json`
- **Payload Schema**:

```json5
{
  /** Empty when creating a group; set to the group ID when modifying a group. */
  "groupId": "{Group_ID}",
  "communityId": "{Community_ID}",
  "groupName": "MetaID developer group",
  "groupNote": "Group announcement text...",
  "groupIcon": "metafile://{pinid}",
  /** Message type: 0 for plaintext, 1 for encrypted AES. */
  "groupType": "0",
  "status": "1",
  /** Join mode: 0 for public, 100 for private. */
  "type": "0",
  "tickId": "{tickId}",
  "collectionId": "{collectionId}",
  /** Chat permission: 0 for everyone, 1 for administrators only. */
  "chatSettingType": 0,
  /** 0 means normal, 1 means dissolved. */
  "deleteStatus": 0,
  "path": "10/1",
  "timestamp": 1234567890000
}
```

## 2. SimpleGroupJoin

- **Intro**: A protocol for recording that a user joins or leaves a group.
- **Path**: `/protocols/simplegroupjoin`
- **Version**: `1.0.1`
- **Content-Type**: `application/json`
- **Payload Schema**:

```json5
{
  "groupId": "{Group_ID}",
  /** 1 means join, -1 means leave. */
  "state": 1,
  /** Referrer MetaID. */
  "referrer": "{MetaID}",
  /** Encrypted key material for private groups. */
  "k": "{Cipher key}"
}
```

## 3. Group membership control protocols

These protocols share similar structures and manage member permissions. Their content type is `application/json` and their version is `1.0.0`.

- **SimpleGroupJoinWhitelist** (`/protocols/simplegroupjoinwhitelist`) - Allowlist for private-group admission:
  `{"groupId": "{ID}", "users": ["MetaID-1"]}`
- **SimpleGroupJoinBlock** (`/protocols/simplegroupjoinblock`) - Admission blocklist:
  `{"groupId": "{ID}", "users": ["MetaID-1"]}`
- **SimpleGroupAdmin** (`/protocols/simplegroupadmin`) - Group administrator assignment:
  `{"groupId": "{ID}", "admins": ["MetaID-1"]}`
- **SimpleGroupBlock** (`/protocols/simplegroupblock`) - Muted-user list:
  `{"groupId": "{ID}", "users": ["MetaID-1"]}`
- **SimpleGroupRemoveUser** (`/protocols/simplegroupremoveuser`) - Remove a user from a group:
  `{"removeMetaid": "{MetaID}", "groupId": "{ID}", "reason": "Policy violation", "timestamp": "0"}`
- **SimpleGroupChannel** (`/protocols/simplegroupchannel`) - Create a group channel:
  `{"groupId": "{ID}", "channelId": "{ID}", "channelName": "News channel", "channelIcon": "metafile://pinid", "channelNote": "Announcement", "channelType": 1}`
