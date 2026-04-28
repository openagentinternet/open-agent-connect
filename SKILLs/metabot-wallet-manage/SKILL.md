---
name: metabot-wallet-manage
description: Use when a human asks to check wallet balances or send/transfer BTC or SPACE to an address; do not use this skill for on-chain content publishing, remote service delegation, or identity/network management.
---

# MetaBot Wallet Manage

Handle wallet balance checks and BTC/SPACE transfers to a target address.

{{HOST_ADAPTER_SECTION}}

## Routing

{{SYSTEM_ROUTING}}

## Trigger Guidance

Should trigger when:

- The user asks for wallet balance across all chains, MVC only, or BTC only.
- The user asks to send, transfer, or pay BTC or SPACE to an address.
- The user mentions an amount with BTC or SPACE and a recipient address.

Should not trigger when:

- The user asks to publish buzz/service/file content.
- The user asks to delegate paid remote services.
- The user asks to manage network sources or identities.

## Balance Command

For default multi-chain balance (mvc + btc):

```bash
{{METABOT_CLI}} wallet balance
```

When the human explicitly asks BTC-only (for example: `btc`, `比特币`, `bitcoin`):

```bash
{{METABOT_CLI}} wallet balance --chain btc
```

When the human explicitly asks MVC-only (for example: `mvc`, `space`, `SPACE`, `太空币`):

```bash
{{METABOT_CLI}} wallet balance --chain mvc
```

## Transfer Command

**Currency mapping:**
- `BTC` → Bitcoin network
- `SPACE` → MVC network (also recognised as: `mvc`, `space`, `太空币`)

**Amount format:** append the currency unit directly to the number, no space required.
- `0.00001BTC` — send 0.00001 BTC
- `1SPACE` — send 1 SPACE (MVC)
- Amounts are case-insensitive: `1space`, `0.00001btc` are both valid.

### Step 1 — Always preview first (no --confirm)

Run the transfer command **without `--confirm`** to get a preview. Never skip this step.

```bash
{{METABOT_CLI}} wallet transfer --to <address> --amount <amount><UNIT>
```

Example — preview a BTC transfer:
```bash
{{METABOT_CLI}} wallet transfer --to 1EX5NN6npyCp3X6Sv4Yahv6DrBNKRtq4Gw --amount 0.00001BTC
```

Example — preview a SPACE transfer:
```bash
{{METABOT_CLI}} wallet transfer --to 1EX5NN6npyCp3X6Sv4Yahv6DrBNKRtq4Gw --amount 1SPACE
```

The response has `state: "awaiting_confirmation"` and `data` containing:
- `fromAddress` — sender address
- `currentBalance` — current confirmed balance (e.g. `"0.001 BTC"`)
- `toAddress` — recipient address
- `amount` — exact amount to send
- `estimatedFee` — estimated network fee
- `feeRateSatPerVb` — fee rate used
- `currency` / `chain`

Present this information clearly to the human and ask for explicit approval before proceeding.

### Step 2 — Execute only after human confirms

After the human explicitly approves, re-run the same command with `--confirm` appended:

```bash
{{METABOT_CLI}} wallet transfer --to <address> --amount <amount><UNIT> --confirm
```

Example:
```bash
{{METABOT_CLI}} wallet transfer --to 1EX5NN6npyCp3X6Sv4Yahv6DrBNKRtq4Gw --amount 0.00001BTC --confirm
```

On success the response contains:
- `txid` — transaction ID
- `explorerUrl` — clickable link to view the transaction on the block explorer
- `amount` — amount sent
- `toAddress` — recipient

Always show the `explorerUrl` to the human so they can verify the transaction on-chain.

### Natural language → CLI mapping examples

| User says | CLI command |
|---|---|
| "帮我往地址1EX5NN...转账 0.00001 BTC" | `wallet transfer --to 1EX5NN... --amount 0.00001BTC` |
| "给地址1EX5NN...转 1 SPACE" | `wallet transfer --to 1EX5NN... --amount 1SPACE` |
| "send 0.0001 btc to 1EX5NN..." | `wallet transfer --to 1EX5NN... --amount 0.0001BTC` |
| "transfer 5 space to 1EX5NN..." | `wallet transfer --to 1EX5NN... --amount 5SPACE` |

## Error Handling

- **insufficient_balance** — show the current balance and tell the user how much more is needed.
- **invalid_argument** — the address or amount format is wrong; ask the user to correct it.
- **transfer_broadcast_failed** — the network rejected the transaction; show the error message and suggest waiting for UTXO confirmation before retrying.

## In Scope

- Wallet balance checks across all, MVC, or BTC chains.
- BTC and SPACE (MVC) transfers with two-step preview + confirm flow.

## Out of Scope

- On-chain social/service publish writes.
- Remote service order lifecycle.
- Identity or network source management.
- DOGE or other chain transfers.

## Handoff To

- `metabot-post-buzz` / `metabot-upload-file` / `metabot-post-skillservice` for publish flows.
- `metabot-call-remote-service` for service delegation.
- `metabot-network-manage` for network discovery/source operations.

## Compatibility

- CLI path: `{{METABOT_CLI}}`
- Compatibility manifest: `{{COMPATIBILITY_MANIFEST}}`
