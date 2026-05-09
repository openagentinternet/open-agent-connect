---

## name: metabot-wallet-manage
description: Use when a human asks to check wallet balances or send/transfer BTC, SPACE, DOGE, or OPCAT to an address; do not use this skill for on-chain content publishing, remote service delegation, or identity/network management.

# MetaBot Wallet Manage

Handle wallet balance checks and BTC/SPACE/DOGE/OPCAT transfers to a target address.



## Routing

Route natural-language intent through `metabot`, then reason over the returned JSON envelope.

- Prefer JSON and local daemon routes for agent workflows.
- Open local HTML only for human browsing, trace inspection, publish review, or manual refund confirmation.
- Treat MetaWeb as the network layer and the local host as a thin adapter.


## Trigger Guidance

Should trigger when:

- The user asks for wallet balance across all chains, MVC only, BTC only, DOGE only, or OPCAT only.
- The user asks to send, transfer, or pay BTC, SPACE, DOGE, or OPCAT to an address.
- The user mentions an amount with BTC, SPACE, DOGE, or OPCAT and a recipient address.

Should not trigger when:

- The user asks to publish buzz/service/file content.
- The user asks to delegate paid remote services.
- The user asks to manage network sources or identities.

## Network and Currency Mapping

**This is the authoritative mapping. Do not query any other API or chain for these currencies.**


| User says                 | Network | CLI flag      | Notes                                                                                           |
| ------------------------- | ------- | ------------- | ----------------------------------------------------------------------------------------------- |
| SPACE / space / 太空币       | MVC     | `--chain mvc` | SPACE is the native currency of the MVC network. Querying SPACE balance = querying MVC balance. |
| MVC / mvc                 | MVC     | `--chain mvc` | Same network as SPACE.                                                                          |
| BTC / btc / Bitcoin / 比特币 | Bitcoin | `--chain btc` |                                                                                                 |
| DOGE / doge                 | Dogecoin | `--chain doge` | Use `DOGE` as the transfer amount unit.                                                        |
| OPCAT / opcat               | OPCAT   | `--chain opcat` | Use `OPCAT` as the transfer amount unit.                                                       |


**Never** search for a separate SPACE API, SPACE contract, or FT token endpoint. SPACE is not a token — it is the base currency of the MVC network and is always returned by `wallet balance --chain mvc`.

## Balance Command

For default multi-chain balance (MVC/SPACE + BTC + DOGE + OPCAT):

```bash
metabot wallet balance
```

When the human asks for BTC, Bitcoin, or 比特币:

```bash
metabot wallet balance --chain btc
```

When the human asks for DOGE or Dogecoin:

```bash
metabot wallet balance --chain doge
```

When the human asks for OPCAT:

```bash
metabot wallet balance --chain opcat
```

When the human asks for SPACE, MVC, 太空币, or any MVC-network currency:

```bash
metabot wallet balance --chain mvc
```

The `mvc` balance response includes `balances.mvc.totalMvc` (the SPACE amount) and `balances.mvc.address` (the MVC/SPACE receiving address). DOGE and OPCAT balances are returned under `balances.doge` and `balances.opcat`.

## Default Write Network Config

Wallet balance and transfer do not use the default write-network setting. Balance defaults to all chains, and transfer selects the chain from the amount unit (`BTC`, `SPACE`, `DOGE`, or `OPCAT`).

Use these commands only when the human asks to inspect or change the default chain for on-chain write commands such as buzz, service publish, rating, private chat, or generic chain write:

```bash
metabot config get chain.defaultWriteNetwork
metabot config set chain.defaultWriteNetwork opcat
```

Supported values are `mvc`, `btc`, `doge`, and `opcat`. The setting is scoped to the active local MetaBot profile.

## Transfer Command

**Currency mapping (same as balance — see Network and Currency Mapping above):**

- `BTC` → Bitcoin network (`--amount 0.00001BTC`)
- `SPACE` → MVC network (`--amount 1SPACE`). SPACE is the native currency of MVC; use `SPACE` as the unit, not `MVC`.
- `DOGE` → Dogecoin network (`--amount 0.01DOGE`)
- `OPCAT` → OPCAT network (`--amount 10OPCAT`)

**Amount format:** append the currency unit directly to the number, no space required.

- `0.00001BTC` — send 0.00001 BTC
- `1SPACE` — send 1 SPACE (MVC)
- `0.01DOGE` — send 0.01 DOGE
- `10OPCAT` — send 10 OPCAT
- Amounts are case-insensitive: `1space`, `0.00001btc`, and `10opcat` are all valid.

### Step 1 — Always preview first (no --confirm)

Run the transfer command **without `--confirm`** to get a preview. Never skip this step.

```bash
metabot wallet transfer --to <address> --amount <amount><UNIT>
```

Example — preview a BTC transfer:

```bash
metabot wallet transfer --to 1EX5NN6npyCp3X6Sv4Yahv6DrBNKRtq4Gw --amount 0.00001BTC
```

Example — preview a SPACE transfer:

```bash
metabot wallet transfer --to 1EX5NN6npyCp3X6Sv4Yahv6DrBNKRtq4Gw --amount 1SPACE
```

Example — preview an OPCAT transfer:

```bash
metabot wallet transfer --to o1EX5NN6npyCp3X6Sv4Yahv6DrBNKRtq4Gw --amount 10OPCAT
```

Example — preview a DOGE transfer:

```bash
metabot wallet transfer --to D9UuD6sjdEUNv8hPC8WtUXZapBCsFn67jo --amount 0.01DOGE
```

The response has `state: "awaiting_confirmation"` and `data` containing:

- `fromAddress` — sender address
- `currentBalance` — total spendable balance including both confirmed and unconfirmed UTXOs (e.g. `"0.001 BTC"`)
- `toAddress` — recipient address
- `amount` — exact amount to send
- `estimatedFee` — estimated network fee
- `feeRateSatPerVb` — fee rate used
- `currency` / `chain`

Present this information clearly to the human and ask for explicit approval before proceeding.

### Step 2 — Execute only after human confirms

After the human explicitly approves, re-run the same command with `--confirm` appended:

```bash
metabot wallet transfer --to <address> --amount <amount><UNIT> --confirm
```

Example:

```bash
metabot wallet transfer --to 1EX5NN6npyCp3X6Sv4Yahv6DrBNKRtq4Gw --amount 0.00001BTC --confirm
```

On success the response contains:

- `txid` — transaction ID
- `explorerUrl` — clickable link to view the transaction on the block explorer
- `amount` — amount sent
- `toAddress` — recipient

Always show the `explorerUrl` to the human so they can verify the transaction on-chain.

### Natural language → CLI mapping examples


| User says                       | CLI command                                          |
| ------------------------------- | ---------------------------------------------------- |
| "帮我往地址1EX5NN...转账 0.00001 BTC"  | `wallet transfer --to 1EX5NN... --amount 0.00001BTC` |
| "给地址1EX5NN...转 1 SPACE"         | `wallet transfer --to 1EX5NN... --amount 1SPACE`     |
| "send 0.0001 btc to 1EX5NN..."  | `wallet transfer --to 1EX5NN... --amount 0.0001BTC`  |
| "transfer 5 space to 1EX5NN..." | `wallet transfer --to 1EX5NN... --amount 5SPACE`     |
| "transfer 0.01 doge to D9UuD..." | `wallet transfer --to D9UuD... --amount 0.01DOGE`    |
| "transfer 10 opcat to o1EX5..." | `wallet transfer --to o1EX5... --amount 10OPCAT`     |


## Error Handling

- **insufficient_balance** — show the current balance and tell the user how much more is needed. UTXOs are spendable regardless of confirmation status — the total balance is what determines whether a transfer can proceed.
- **invalid_argument** — the address or amount format is wrong; ask the user to correct it.
- **transfer_broadcast_failed** — the network rejected the transaction; show the error message. If the error mentions mempool conflict, wait a few seconds and retry — the conflict usually resolves on its own.

## In Scope

- Wallet balance checks across all, MVC, BTC, DOGE, or OPCAT chains.
- BTC, SPACE (MVC), DOGE, and OPCAT transfers with two-step preview + confirm flow.

## Out of Scope

- On-chain social/service publish writes.
- Remote service order lifecycle.
- Identity or network source management.
- Other chain transfers.

## Handoff To

- `metabot-post-buzz` / `metabot-upload-file` / `metabot-post-skillservice` for publish flows.
- `metabot-call-remote-service` for service delegation.
- `metabot-network-manage` for network discovery/source operations.

## Compatibility

- CLI path: `metabot`
- Compatibility manifest: `release/compatibility.json`
