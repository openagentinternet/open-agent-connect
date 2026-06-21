[![Test](https://github.com/OPCAT-Labs/ts-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/OPCAT-Labs/ts-tools/actions/workflows/ci.yml)

# scrypt-ts-opcat

`scrypt-ts-opcat` is a Typescript framework to write smart contracts on Opcat blockchains.

## Installation

Use this `npm` to install `scrypt-ts-opcat`:

`npm install @opcat-labs/scrypt-ts-opcat`

## Usage

### Write a Contract

A contract can be written as a class that extends the `SmartContract` base, a simple example could be like this:

```ts
import { SmartContract, method, prop, assert } from "@opcat-labs/scrypt-ts-opcat";

class Demo extends SmartContract {
  @prop()
  x: bigint;

  constructor(x: bigint) {
    super(x);
    this.x = x;
  }

  @method()
  public unlock(x: bigint) {
    assert(this.add(this.x, 1n) === x);
  }

  @method()
  add(x0: bigint, x1:bigint) : bigint {
    return x0 + x1;
  }
}
```

#### Property Decorator: `@prop()`

Use this decorator on class properties to mark them as contract properties, which means the values would be stored on chain.


#### Method Decorator: `@method()`

Use this decorator on class methods to mark them as contract methods. The logic implemented in these methods would be stored and be executed on chain.

The class methods decorated by `@method()` have some special requirements / restrains that should be followed:

* Within these methods, only functions provided as built-ins from `@opcat-labs/scrypt-ts-opcat` or methods also decorated by `@method()` can be called; Similarly, only the properties decorated by `@prop()` can be use.

* With `public` modifier, a method is marked as an entry method that could be called outside the contract class. The main purpose of these methods is to validate / verify / check assertions for its input parameters according to its `@prop()` decorated properties. The return value must be `void`.

* Without a `public` modifier, a method is kind of an inner function usually be called within the contract class. It can return any valid types.

#### Types

The types can be used in `@prop()` and `@method()` are restricted to these kinds:

* Basic types: `boolean` / `ByteString` / `bigint`;

*Note*: the type `number` is not allowed in `@prop()` because it may cause precision issues when representing a floating point number. It can only be used in a few cases like when using `FixedArray` or `Loop`.

* User types can be defined using `type` or `interface`, made of basic types. For example,

```ts
type ST = {
  a: bigint;
  b: boolean;
}

interface ST1 {
  x: ST;
  y: ByteString;
}
```

* Array types **must** be declared using `FixedArray`, whose length must be known at compile time, like:

```ts
let aaa: FixedArray<bigint, 3> = [1n, 3n, 3n];

// 2d array
let abb: FixedArray<FixedArray<bigint, 2>, 3> = [[1n, 3n], [1n, 3n], [1n, 3n]];
```

* Other `SmartContract` subclasses are provided as libraries.

#### Statements

There are also some other restraints / rules on the statemets that could be used within the `@method`s besides the previously mentioned.

##### `for` statement

Because of the underlaying limitation of `loop` implemetion on Bitcoin script, one can only use a compile time const number as the loop iterations.

So currently if you want to build a loop inside `@method`s, there is only one restricted version of `for` statement that could be used. It's looks like:

```ts
for(let $i = 0; $i < $constNum; $i++) {
  ...
}
```

Note that the initial value `0` and the `<` operator and the post unary operator `++` are all unchangeable.

* `$i` can be whatever you named the induction variable;

* `$constNum` should be an expression of a CTC numeric value of the followings:

A number literal like:

```ts
for(let i = 0; i < 5; i++ ) ...
```

Or a `const` variable name like:

```ts
const N = 3;
for(let i = 0; i < N; i++ ) ...
```

Or a `readonly` property name like:

```ts
class X {
static readonly N = 3;
}
for(let i = 0; i < X.N; i++ ) ...
```

##### `console.log` statement

As described before, all Javascript/Typescript built-in functions/global variables are not allowed in `@method`s, with only a few exceptions.

One exceptional statement is `console.log`, which can be used for debugging purpose.
```ts
@method
add(x0: bigint, x1:bigint) : bigint {
  console.log(x0);
  return x0 + x1;
}
```

### Compile a Contract

Just run `npx opcat-cli@latest compile`, the contract will be compiled if there is no any issue and output the contract json file in the `artifact` folder inside the project.

### Test a Contract

You could write tests using tools like `mocha`, for example:

```js
import { use, expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {
  Signer,
  deploy,
  ExtPsbt,
  ChainProvider,
  UtxoProvider,
  call,
} from '@opcat-labs/scrypt-ts-opcat';
import { network } from '../utils/privateKey.js';
import { createLogger, getDefaultProvider, getDefaultSigner } from '../utils/index.js';
import { Demo } from '../contracts/demo.js';

import artifact from '../fixtures/demo.json' with { type: 'json' };

use(chaiAsPromised);

describe('Test Demo onchain', () => {
  let signer: Signer;
  let provider: ChainProvider & UtxoProvider;
  let pubKey: string;
  let demo: Demo;
  const logger = createLogger('Test Demo onchain');

  before(async () => {
    Demo.loadArtifact(artifact);
    signer = getDefaultSigner()
    pubKey = await signer.getPublicKey();
    provider = getDefaultProvider(network)
  });

  it('should deploy successfully', async () => {
    demo = new Demo(1n, 2n);
    const psbt = await deploy(signer, provider, demo);
    expect(psbt.isFinalized).to.be.true;
    logger.info('deployed successfully, txid: ', psbt.extractTransaction().id);
    psbt.getChangeUTXO() && provider.addNewUTXO(psbt.getChangeUTXO()); // add change utxo
  });

  it('should unlock successfully', async () => {
    const psbt = await call(signer, provider, demo, (demo: Demo, psbt: ExtPsbt) => {
      demo.add(3n);
    });
    expect(psbt.isFinalized).to.be.true;

    const txid = await provider.broadcast(psbt.extractTransaction().toHex());
    logger.info('unlocked successfully, txid: ', txid);
  });
});

```

## Documentation

The full version of `Opcat` documentation is available [here](https://docs.opcatlabs.io/overview).
