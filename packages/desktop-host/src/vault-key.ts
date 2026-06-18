/**
 * Seed a disk-backed vault master key on a FRESH setup so the desktop's vault
 * works without an interactive passphrase prompt — which the desktop can never
 * answer.
 *
 * The desktop saves provider secrets by piping them into `moxxy vault set` over
 * a non-TTY pipe (and uses an in-process vault for transcription). The vault key
 * source resolves in order: `MOXXY_VAULT_PASSPHRASE` → OS keychain
 * (`@napi-rs/keyring`) → on-disk cached key (`~/.moxxy/vault.key`) → interactive
 * passphrase prompt. On a fresh install with no keychain available — notably the
 * packaged Windows app, where the native keyring module isn't present — the
 * first three all miss and it hits the prompt, which throws
 * "vault: passphrase required but no interactive terminal", so the very first
 * provider-key save (and `moxxy login`) fails.
 *
 * Seeding the on-disk key (step 3) ahead of time skips the prompt. We only seed
 * when NO vault exists yet (neither `vault.key` NOR `vault.json`): if the vault
 * is already keyed by the keychain or a passphrase, a random key would mismatch
 * and lock the user out. The seed is the same 32-byte AES-256 master key the
 * passphrase path persists, written 0600 — identical protection to the existing
 * disk-cache fallback, just without the prompt. If the keychain later becomes
 * available the key source backfills it from this file.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { moxxyPath } from '@moxxy/sdk/server';

/** AES-256 master key length, matching the vault's `deriveKey` output. */
const KEY_BYTES = 32;

export function ensureDesktopVaultKey(): void {
  const keyPath = moxxyPath('vault.key');
  const vaultPath = moxxyPath('vault.json');
  // Don't touch an existing vault — only seed a truly fresh setup.
  if (existsSync(keyPath) || existsSync(vaultPath)) return;
  try {
    mkdirSync(path.dirname(keyPath), { recursive: true });
    writeFileSync(keyPath, `${randomBytes(KEY_BYTES).toString('base64')}\n`, { mode: 0o600 });
  } catch {
    // Best effort — if we can't write, the vault falls back to its prompt
    // behaviour (unchanged), so this never makes things worse.
  }
}
