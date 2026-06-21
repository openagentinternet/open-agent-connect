/**
 * ESM Import Test for opcat
 */

console.log('Testing opcat ESM import...\n');

// Test 1: Package import
console.log('Test 1: Importing as package (@opcat-labs/opcat)...');
try {
  const opcat = await import('@opcat-labs/opcat');
  console.log('✓ Package import successful');
  console.log('  Exported keys:', Object.keys(opcat).slice(0, 10).join(', '), '...');
} catch (error) {
  console.log('✗ Package import failed:', error.message);
  console.log('  Full error:', error);
}

// Test 2: Named exports
console.log('\nTest 2: Testing named exports from package...');
try {
  const { PrivateKey, PublicKey, Address, Transaction, Script } = await import('@opcat-labs/opcat');
  console.log('✓ Named exports from package successful');
  console.log('  PrivateKey:', typeof PrivateKey);
  console.log('  PublicKey:', typeof PublicKey);
  console.log('  Address:', typeof Address);
  console.log('  Transaction:', typeof Transaction);
  console.log('  Script:', typeof Script);
} catch (error) {
  console.log('✗ Named exports failed:', error.message);
  console.log('  Full error:', error);
}

// Test 3: Direct file import
console.log('\nTest 3: Importing from direct file path...');
try {
  const opcat = await import('../esm/index.js');
  console.log('✓ Direct file import successful');
  console.log('  Exported keys:', Object.keys(opcat).slice(0, 10).join(', '), '...');
} catch (error) {
  console.log('✗ Direct file import failed:', error.message);
  console.log('  Full error:', error);
}

// Test 4: Functionality test
console.log('\nTest 4: Testing actual functionality...');
try {
  const { PrivateKey, Networks } = await import('@opcat-labs/opcat');
  const privKey = new PrivateKey();
  const pubKey = privKey.toPublicKey();
  const address = privKey.toAddress(Networks.testnet);
  console.log('✓ Functionality test passed');
  console.log('  Generated private key:', privKey.toString().slice(0, 20) + '...');
  console.log('  Derived public key:', pubKey.toString().slice(0, 20) + '...');
  console.log('  Derived address:', address.toString());
} catch (error) {
  console.log('✗ Functionality test failed:', error.message);
  console.log('  Full error:', error);
}

console.log('\n=== ESM Import Test Complete ===\n');
