import { MoxxyError } from '@moxxy/sdk';
import { canonicalKey } from '../provider-keys.js';
import { pinFirstPartySpec } from './pin.js';
import { PROVIDER_CATALOG, resolveProvider } from './provider-catalog.js';

/**
 * Shared, headless provisioner — the single code path that turns "I want
 * provider X" into an installed + configured moxxy, used by both `moxxy
 * provision` (CLI) and (later) the desktop's first-run over IPC.
 *
 * Steps (all idempotent; config written LAST so a mid-flight failure leaves no
 * half-state): resolve provider → install its package unless it's already
 * registered (bundled) → install accepted basics → store the key in the vault →
 * write the unified `plugins:` config (enable the package, set the provider
 * default + model). The bundled-skip is what keeps it safe today: installing a
 * still-bundled provider on demand would duplicate-register it.
 */
export interface ProvisionSpec {
  /** Provider slug (e.g. `anthropic`) or its package name. */
  readonly provider: string;
  /** Model to set as the provider's default (else the catalog's defaultModel). */
  readonly model?: string;
  /** API key for a key-auth provider → stored in the vault. */
  readonly key?: string;
  /** Override the vault key name (default `canonicalKey(slug)`). */
  readonly keyName?: string;
  /** Extra packages to install (catalog ids or npm names) — the recommended basics. */
  readonly basics?: ReadonlyArray<string>;
}

export interface ProvisionConfigWrite {
  readonly providerSlug: string;
  readonly providerPackage: string;
  readonly model?: string;
  readonly basicsPackages: ReadonlyArray<string>;
  /** True when the provider came from the bundle (no on-demand install happened). */
  readonly providerBundled: boolean;
}

export interface ProvisionEffects {
  /** Providers already registered in the session — installing these is skipped. */
  readonly loadedProviderNames: ReadonlySet<string>;
  /** Install a package spec into `~/.moxxy/plugins`. */
  readonly install: (spec: string) => Promise<void>;
  /** Persist the unified config (enable package + provider default + model). */
  readonly writeConfig: (write: ProvisionConfigWrite) => Promise<void>;
  /** Store a secret in the vault (required when a key is supplied). */
  readonly storeSecret?: (name: string, value: string, tags: ReadonlyArray<string>) => Promise<void>;
  /** Resolve a basic id/name → npm package (catalog-aware). Identity by default. */
  readonly resolveBasicPackage?: (idOrName: string) => string;
  /** CLI version, for pinning first-party installs. */
  readonly cliVersion?: string;
  readonly log?: (message: string) => void;
}

export interface ProvisionResult {
  readonly provider: string;
  readonly installed: ReadonlyArray<string>;
  readonly skipped: ReadonlyArray<string>;
  readonly keyStored: boolean;
}

export async function provision(
  spec: ProvisionSpec,
  effects: ProvisionEffects,
): Promise<ProvisionResult> {
  const entry = resolveProvider(spec.provider);
  if (!entry) {
    throw new MoxxyError({
      code: 'CONFIG_INVALID',
      message: `provision: unknown provider "${spec.provider}". Known: ${PROVIDER_CATALOG.map((p) => p.slug).join(', ')}.`,
    });
  }

  const installed: string[] = [];
  const skipped: string[] = [];

  // Provider: skip the install when it's already registered (bundled) —
  // installing a still-bundled provider would duplicate-register it.
  const providerBundled = effects.loadedProviderNames.has(entry.slug);
  if (providerBundled) {
    skipped.push(entry.packageName);
    effects.log?.(`provider "${entry.slug}" already available — skipping install`);
  } else {
    effects.log?.(`installing ${entry.packageName}…`);
    await effects.install(pinFirstPartySpec(entry.packageName, undefined, effects.cliVersion));
    installed.push(entry.packageName);
  }

  // Basics: install each (npm install is idempotent).
  const basicsPackages: string[] = [];
  for (const b of spec.basics ?? []) {
    const pkg = effects.resolveBasicPackage?.(b) ?? b;
    basicsPackages.push(pkg);
    effects.log?.(`installing ${pkg}…`);
    await effects.install(pinFirstPartySpec(pkg, undefined, effects.cliVersion));
    installed.push(pkg);
  }

  // Key → vault (key-auth providers only; oauth/none collect creds elsewhere).
  let keyStored = false;
  if (spec.key && entry.auth === 'key') {
    if (!effects.storeSecret) {
      throw new MoxxyError({
        code: 'CONFIG_INVALID',
        message: 'provision: a key was supplied but no vault is available to store it.',
      });
    }
    const keyName = spec.keyName ?? canonicalKey(entry.slug);
    await effects.storeSecret(keyName, spec.key, [entry.slug]);
    keyStored = true;
    effects.log?.(`stored "${entry.slug}" key in the vault as ${keyName}`);
  }

  // Config LAST — only after installs + key succeed, so a failure leaves no
  // half-written config pointing at a provider that isn't there.
  const model = spec.model ?? entry.defaultModel;
  await effects.writeConfig({
    providerSlug: entry.slug,
    providerPackage: entry.packageName,
    ...(model ? { model } : {}),
    basicsPackages,
    providerBundled,
  });
  effects.log?.(`set provider default → ${entry.slug}${model ? ` (${model})` : ''}`);

  return { provider: entry.slug, installed, skipped, keyStored };
}
