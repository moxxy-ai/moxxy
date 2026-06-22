/**
 * Node-only identity persistence for `@moxxy/e2e`. Kept off the `.` export so the
 * RN bundle never pulls `node:fs`. The secret key is stored once per install at
 * `~/.moxxy/proxy-identity.key` (mode 0600, atomic write — same invariant the
 * vault/sessions use), and the public key is derived from it on load.
 */
import { readFile } from 'node:fs/promises';
import { moxxyPath, writeFileAtomic } from '@moxxy/sdk/server';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { generateIdentity, publicKeyFromSecret, type Identity } from './identity.js';

/** Default on-disk location of the agent's proxy identity secret key. */
export function defaultIdentityPath(): string {
  return moxxyPath('proxy-identity.key');
}

/**
 * Load the agent identity from disk, generating and persisting a fresh one on
 * first run. The returned identity is stable across restarts, so the agent keeps
 * the same uuid subdomain and the same pinned fingerprint.
 */
export async function loadOrCreateIdentity(path: string = defaultIdentityPath()): Promise<Identity> {
  let hex: string | null = null;
  try {
    hex = (await readFile(path, 'utf8')).trim();
  } catch (err) {
    // Missing file → first run (generate below). Anything else (e.g. EACCES) is real.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  if (hex !== null) {
    try {
      const secretKey = hexToBytes(hex);
      if (secretKey.length === 32) {
        return { secretKey, publicKey: publicKeyFromSecret(secretKey) };
      }
    } catch {
      // Malformed contents → fall through and regenerate.
    }
  }
  const identity = generateIdentity();
  await writeFileAtomic(path, bytesToHex(identity.secretKey), { mode: 0o600 });
  return identity;
}
