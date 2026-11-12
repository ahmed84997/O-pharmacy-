// Turns a signing secret into a private key PEM file. The owner may paste the key with or without its
// BEGIN / END lines (or with spaces and line breaks lost); the body is the same either way.
// Usage: node pem.cjs <ENV_NAME> <out-file>   -> writes the PEM (never prints it) and exits 1 if it is not an Ed25519 key.
const crypto = require('node:crypto'); const fs = require('node:fs');
const [name, out] = process.argv.slice(2);
const raw = String(process.env[name] || '').replace(/\r/g, '').trim();
const body = raw.replace(/-----(BEGIN|END)[A-Z ]*-----/g, '').replace(/[^A-Za-z0-9+/=]/g, '');
const pem = `-----BEGIN PRIVATE KEY-----\n${(body.match(/.{1,64}/g) || []).join('\n')}\n-----END PRIVATE KEY-----\n`;
try {
  const key = crypto.createPrivateKey(pem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error(`it is a ${key.asymmetricKeyType} key, not ed25519`);
  fs.writeFileSync(out, pem, { mode: 0o600 });
  console.log(`${name}: ok`);
} catch (e) {
  console.log(`::error::${name} is not a valid key (${e.message}). Make it again with: openssl genpkey -algorithm ed25519 -out k.key && cat k.key`);
  process.exit(1);
}
