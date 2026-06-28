import fs from 'node:fs';
import path from 'node:path';

/** Backend package root (parent of src/ or dist/). */
export const backendRoot = path.resolve(__dirname, '../..');

export function resolvePrivateKeyPath(keyPath: string): string {
  return path.isAbsolute(keyPath)
    ? keyPath
    : path.resolve(backendRoot, keyPath);
}

export function assertPrivateKeyFile(keyPath: string, envVar = 'SPAZA_KEY_PATH'): void {
  const resolved = resolvePrivateKeyPath(keyPath);

  if (!fs.existsSync(resolved)) {
    throw new Error(
      `Private key file not found: ${resolved}\n` +
      `Set ${envVar} in backend/.env (e.g. ./SPAZA.key) and place your wallet private key there.`
    );
  }

  const pem = fs.readFileSync(resolved, 'utf8');

  if (/BEGIN PUBLIC KEY/i.test(pem)) {
    throw new Error(
      `${resolved} contains a PUBLIC key, but Open Payments needs the PRIVATE key file.\n` +
      `At https://wallet.interledger-test.dev/spaza-shop → Keys → create/download a key pair,\n` +
      `save the file that starts with "-----BEGIN PRIVATE KEY-----" as backend/SPAZA.key,\n` +
      `and set SPAZA_KEY_ID in backend/.env to the key id shown on the wallet.`
    );
  }

  if (!/BEGIN (?:EC |RSA )?PRIVATE KEY/i.test(pem)) {
    throw new Error(
      `${resolved} is not a valid PEM private key.\n` +
      `Expected "-----BEGIN PRIVATE KEY-----" (Ed25519 PKCS#8 from the Interledger test wallet).`
    );
  }
}
