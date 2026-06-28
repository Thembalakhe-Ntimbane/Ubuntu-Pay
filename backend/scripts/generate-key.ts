/**
 * Generate a new Ed25519 key pair for the Interledger test wallet.
 *
 * Usage (from repo root):
 *   npm run generate-key --workspace=backend
 *
 * Then upload SPAZA.public.pem at https://wallet.interledger-test.dev/spaza-shop → Keys,
 * copy the key id the wallet assigns into SPAZA_KEY_ID in backend/.env,
 * and keep SPAZA.key (private) out of git.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const backendRoot = path.resolve(__dirname, '..');
const privatePath = path.join(backendRoot, 'SPAZA.key');
const publicPath  = path.join(backendRoot, 'SPAZA.public.pem');

if (fs.existsSync(privatePath)) {
  const existing = fs.readFileSync(privatePath, 'utf8');
  if (/BEGIN PRIVATE KEY/i.test(existing)) {
    console.error(`Refusing to overwrite existing private key at ${privatePath}`);
    console.error('Delete or rename it first if you really want a new key pair.');
    process.exit(1);
  }
}

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const pubPem  = publicKey.export({ type: 'spki', format: 'pem' });

fs.writeFileSync(privatePath, privPem, { mode: 0o600 });
fs.writeFileSync(publicPath, pubPem, { mode: 0o644 });

console.log('\nGenerated new Ed25519 key pair:\n');
console.log(`  Private key → ${privatePath}`);
console.log(`  Public key  → ${publicPath}\n`);
console.log('Next steps:');
console.log('  1. Open https://wallet.interledger-test.dev/spaza-shop → Keys → Add key');
console.log('  2. Upload SPAZA.public.pem (or paste the public key contents)');
console.log('  3. Copy the key id from the wallet into backend/.env as SPAZA_KEY_ID');
console.log('  4. Restart the backend (npm run dev)\n');
