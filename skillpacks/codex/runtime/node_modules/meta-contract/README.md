# Meta-Contract SDK

This sdk helps you to interact with [MVC meta contracts][mvc]

Please read the [documentation](https://meta-contract-doc.vercel.app/) for more.

## How to install

npm install meta-contract --save

## How to use(FT)

### Init

```js
import { FtManager, API_TARGET } from 'meta-contract'

const ft = new FtManager({
  network: 'testnet',
  apiTarget: API_TARGET.MVC,
  purse: '', //the wif of a mvc address to offer transaction fees
  feeb: 0.5,
  apiHost,
})
```

### Genesis

Define a token with name,symbol,decimal number.
You should save the returned values.(genesis、codehash、sensibleId)

```js
let { txHex, txid, tx, genesis, codehash, sensibleId } = await ft.genesis({
  version: 2,
  tokenName: 'COFFEE COIN',
  tokenSymbol: 'CC',
  decimalNum: 3,
  genesisWif: CoffeeShop.wif,
})
```

### Mint

Mint 1000000000000 tokens

```js
let { txid, txHex, tx } = await ft.mint({
  version: 2,
  sensibleId: sensibleId,
  genesisWif: CoffeeShop.wif,
  receiverAddress: CoffeeShop.address,
  tokenAmount: '1000000000000',
  allowIncreaseMints: false, //if true then you can mint again
})
```

### Transfer

Transfer from CoffeShop to Alice and Bob

```js
let { txid } = await ft.transfer({
  codehash: codehash,
  genesis: genesis,
  receivers: [
    {
      address: Alice.address,
      amount: '5000000',
    },
    {
      address: Bob.address,
      amount: '5000000',
    },
  ],
  senderWif: CoffeeShop.wif,
  ftUtxos: ParamFtUtxo[],
  ftChangeAddress: string | mvc.Address,

  utxos: ParamUtxo[],
  changeAddress: string | mvc.Address

})
```

### Query Balance

Query token's balance

```js
let { balance, pendingBalance, utxoCount, decimal } = await ft.getBalanceDetail({
  codehash,
  genesis,
  address: Alice.address,
})
```

## How to use(NFT)

### Init

```ts
import { API_NET, API_TARGET, mvc, NftManager } from 'meta-contract'

// Generate new seed , need to memorize this mnemonic or use your own
// let mnemonic = mvc.Mnemonic.fromString(cute siren parrot merit swamp plate federal buddy sing tourist family tragic)
let mnemonic = mvc.Mnemonic.fromRandom()
console.log(mnemonic.toString())
let hdPrivateKey = mnemonic.toHDPrivateKey('', 'testnet').deriveChild("m/44'/0'/0'")
console.log(hdPrivateKey.publicKey.toAddress('testnet').toString())
console.log(mnemonic.toHDPrivateKey('', 'testnet').deriveChild("m/44'/0'/0'").privateKey.toString())
// use this private key to sign txs later
const privKey = mnemonic.toHDPrivateKey('', 'testnet').deriveChild("m/44'/0'/0'").privateKey.toString()
const nftManager = new NftManager({ apiTarget: API_TARGET.MVC, network: API_NET.TEST, purse: privKey })
// todo remove authorize in the future
nftManager.api.authorize({ authorization: 'METASV_KEY' })
```

### Genesis

Define the NFT with totalSupply
You should save the returned values.(genesis、codehash、sensibleId)

```ts
const result = await nftManager.genesis({ totalSupply: '10', version: 2 })
console.log(result)
```

### Mint

Mint a NFT to CoffeeShop's address
metaTxId is created by metaid which stands for NFT State

```js
// todo generate metaId tx before mint
const mintResult = await nftManager.mint({
  version: 2,
  metaTxId: '0000000000000000000000000000000000000000000000000000000000000000',
  sensibleId: result.sensibleID,
  metaOutputIndex: 0,
})
console.log(mintResult)
```

### Transfer

Transfer #1 NFT from CoffeShop to Alice

```ts
const result = await nftManager.transfer({
  codehash: '48d6118692b459fabfc2910105f38dda0645fb57',
  genesis: '4920af2eb18493255e662b07d1d80610de7cb2e3',
  receiverAddress: 'mymqKrpZjY31ABhPXfXjfVcUd78L1LCHEv',
  senderWif: privKey,
  tokenIndex: '1',
})
console.log(result)
```

### Sell

Sell #1 NFT

```js
let { sellTx, tx } = await nft.sell({
  genesis,
  codehash,
  tokenIndex: '1',
  sellerWif: Alice.wif,
  price: 2000,
})
```

### Cancel Sell

Cancel Sell #1 NFT

```js
let { unlockCheckTx, tx } = await nft.cancelSell({
  genesis,
  codehash,
  tokenIndex: '1',

  sellerWif: Alice.wif,
})
```

### Buy

Buy #1 NFT

```js
let { unlockCheckTx, tx } = await nft.buy({
  codehash,
  genesis,
  tokenIndex: '1',
  buyerWif: Bob.wif,
  buyerAddress: Bob.Address,
})
```

## Example

<a href="http://gitlab2.showpay.top/front-end/meta-contract/-/tree/master/examples">Go to examples</a>

[docs]: ''
[mvc]: ''
