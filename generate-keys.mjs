import * as jose from 'jose';

async function generateKeys() {
  // The `extractable: true` option is the important change.
  const { publicKey, privateKey } = await jose.generateKeyPair('RS256', { extractable: true });
  const privateJwk = await jose.exportJWK(privateKey);
  const publicJwk = await jose.exportJWK(publicKey);

  console.log('✅ Your keys have been generated!');
  console.log('\n---');
  console.log('🔴 PRIVATE_JWK (keep this secret!):');
  console.log(JSON.stringify(privateJwk));
  console.log('\n---');
  console.log('🔵 PUBLIC_JWK_JSON (this can be public):');
  console.log(JSON.stringify(publicJwk));
  console.log('\n---');
}

generateKeys();
