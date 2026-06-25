import { bootSessionWithConfig } from '../argv-helpers.js';
import { closeSession } from '../setup/close-session.js';
import { canonicalKey } from '../provider-keys.js';
import { validateProviderKey } from '../validate-key.js';
import type { ParsedArgv } from '../argv.js';
import { cliVersion } from '../version.js';
import { runSetupWizard } from '../wizard/run-setup-wizard.js';
import { buildProviderAuthContext } from '../wizard/auth-context.js';
import { PROVIDER_CATALOG, resolveProvider } from '../provision/provider-catalog.js';
import {
  installPluginPackage,
  resolveCatalogPackageName,
  INSTALLABLE_PLUGIN_CATALOG,
} from '@moxxy/plugin-plugins-admin';
import { applyInitConfig, setPluginEnabled } from '@moxxy/config';
import { renderLogo } from '../logo.js';
import { cancel, isCancel, note, password } from '@clack/prompts';
import { colors } from '../colors.js';
import type { ProviderAuthKind, SetupSelections } from '@moxxy/plugin-cli';
import { MoxxyError, type ProviderDef } from '@moxxy/sdk';

/**
 * Interactive first-time setup. Renders a @clack/prompts vertical stepper
 * that walks the user through provider selection, credential entry, model +
 * loop + embedder picks, and emits a moxxy.config.yaml.
 *
 * The wizard is fully provider-agnostic — it reads each registered
 * provider's `ProviderDef.auth` descriptor to decide whether to prompt for
 * an API key or to drive that provider's OAuth flow. Installing a new
 * provider plugin (current or future `moxxy provider install <pkg>`) is
 * enough to make it appear here; no CLI-side branch table.
 */
export async function runInitCommand(argv: ParsedArgv): Promise<number> {
  const interactive = Boolean(process.stdin.isTTY);

  // `skipProviderActivation` is critical here: without it, the activation
  // loop calls `vault.get()` for every candidate provider, which opens the
  // vault and would fire the passphrase prompt before the wizard even
  // starts. The init flow is *itself* what populates the vault — running
  // activation pre-mount is both pointless and a UX trap.
  //
  // `passphrasePrompt` (TTY only) swaps the vault's bare readline prompt for
  // a @clack/prompts step, so the first-run passphrase reads as part of the
  // setup wizard rather than an unstyled prompt before it.
  const { session, vault, persistence } = await bootSessionWithConfig(argv, {
    skipKeyPrompt: true,
    skipProviderActivation: true,
    ...(interactive ? { passphrasePrompt: promptVaultPassphrase } : {}),
  });

  // Tear the session down on every NORMAL exit so the boot daemons (scheduler
  // poller, webhooks listener) don't keep the process alive after the wizard
  // returns. The passphrase-cancel path inside `vault.open()` does a hard
  // `process.exit(1)` (preserving the original cancel UX) — that intentionally
  // bypasses this finally, which is fine because the process is terminating and
  // no turn ran, so there is nothing to drain.
  try {
    if (!interactive) {
      return await runHeadlessInit(session, vault);
    }
    return await runInteractiveInit(session, vault);
  } finally {
    await closeSession(session, persistence);
  }
}

async function runInteractiveInit(
  session: import('@moxxy/core').Session,
  vault: import('@moxxy/plugin-vault').VaultStore,
): Promise<number> {
  // Logo first, so the whole flow reads as one screen: the (first-run only)
  // vault passphrase step and the wizard's `intro()` both render beneath it.
  process.stdout.write(renderLogo());

  // Open the vault as the first pre-requirement step. On a first run (no env
  // var, OS keychain, or disk key) this invokes `promptVaultPassphrase`;
  // otherwise it unlocks silently and the wizard starts immediately.
  await vault.open();

  const providerDefs = session.providers.list();
  const loadedNames = new Set(providerDefs.map((d) => d.name));

  const loadedChoices = providerDefs.map((p) => {
    const description = providerDescription(p);
    return description === undefined
      ? { id: p.name, label: titleCase(p.name) }
      : { id: p.name, label: titleCase(p.name), description };
  });
  // Also offer first-party providers that aren't currently registered (a slim
  // build hasn't bundled them). Selecting one installs + enables it on demand
  // via `ensureProvider` below. When every provider is bundled this list is
  // empty and the wizard is unchanged.
  const catalogChoices = PROVIDER_CATALOG.filter((c) => !loadedNames.has(c.slug)).map((c) => ({
    id: c.slug,
    label: c.label,
    description:
      c.auth === 'oauth'
        ? `OAuth · installs on first use`
        : `installs on first use${c.defaultModel ? ` · ${c.defaultModel}` : ''}`,
  }));
  const providers = [...loadedChoices, ...catalogChoices];
  const models = Object.fromEntries(
    providerDefs.map((p) => [p.name, p.models.map((m) => ({ id: m.id, label: m.id }))]),
  );
  const authKinds: Record<string, ProviderAuthKind> = Object.fromEntries(
    providerDefs.map((p) => [p.name, providerAuthKind(p)]),
  );

  const modes = [
    { id: 'default', label: 'default', description: 'Default Claude Code-style mode (recommended)' },
    { id: 'goal', label: 'goal', description: 'Autonomous goal loop — tools auto-approved until done' },
    { id: 'research', label: 'research', description: 'Fan-out research: parallel queries + synthesis' },
  ];

  const embedders = [
    { id: 'tfidf', label: 'TF-IDF', description: 'Built-in, zero deps, no API key (recommended)' },
    { id: 'openai', label: 'OpenAI', description: 'text-embedding-3-small (1536d) via OpenAI API' },
    { id: 'transformers', label: 'Local (transformers.js)', description: 'all-MiniLM-L6-v2, no API key, ~80MB download' },
    { id: 'none', label: 'None', description: 'Keyword recall only' },
  ];

  const controller = {
    async saveApiKey(providerId: string, key: string): Promise<void> {
      await vault.set(canonicalKey(providerId), key, [providerId]);
    },
    async ensureProvider(
      providerId: string,
    ): Promise<{ models: ReadonlyArray<{ id: string; label: string }>; authKind: ProviderAuthKind } | null> {
      let def = session.providers.list().find((p) => p.name === providerId);
      if (!def) {
        // Catalog-only provider (a slim build hasn't bundled it) — install +
        // enable it from npm, then it registers on the host reload.
        const entry = resolveProvider(providerId);
        if (!entry) return null;
        // Install the latest published version. (Pinning to the CLI version is
        // the fixed-changeset-group future state; today providers publish on
        // their own cadence, so latest is what actually resolves.)
        await installPluginPackage({ packageName: entry.packageName });
        await setPluginEnabled(entry.packageName, true);
        await session.pluginHost.reload();
        def = session.providers.list().find((p) => p.name === providerId);
      }
      if (!def) return null;
      return {
        models: def.models.map((m) => ({ id: m.id, label: m.id })),
        authKind: providerAuthKind(def),
      };
    },
    async writeConfig(selections: SetupSelections): Promise<string> {
      // Persist into ~/.moxxy/config.yaml (the unified store), merging with the
      // package ledger ensureProvider/installPlugins already wrote there — no
      // legacy-shaped file dropped in the project cwd. The wizard's
      // single-provider pick means no fallbacks today, but pass them through.
      return applyInitConfig({
        provider: selections.primary,
        model: selections.model,
        fallbacks: selections.providers.filter((p) => p !== selections.primary),
        mode: selections.mode,
        embedder: selections.embedder,
        ...(selections.security?.enabled ? { security: { enabled: true } } : {}),
      });
    },
    async testKey(
      providerId: string,
      key: string,
    ): Promise<{ ok: true } | { ok: false; message: string }> {
      return await validateProviderKey(providerId, key, session.providers);
    },
    async loginOAuth(providerId: string): Promise<void> {
      const def = session.providers.list().find((p) => p.name === providerId);
      if (!def || def.auth?.kind !== 'oauth') {
        throw new MoxxyError({
          code: 'OAUTH_FLOW_NOT_SUPPORTED',
          message: `Provider "${providerId}" does not advertise an OAuth flow.`,
          hint:
            'This provider expects an API key. Re-run `moxxy init` and provide the key when prompted, ' +
            'or set the relevant *_API_KEY environment variable.',
          context: { provider: providerId },
        });
      }
      // We already bailed to runHeadlessInit when stdin wasn't a TTY, so
      // the browser flow is the default here.
      const ctx = buildProviderAuthContext(vault, { headless: false });
      await def.auth.login(ctx);
    },
    async installPlugins(ids: ReadonlyArray<string>): Promise<void> {
      for (const id of ids) {
        const pkg = resolveCatalogPackageName(id);
        await installPluginPackage({ packageName: pkg });
        await setPluginEnabled(pkg, true);
      }
      // One reload after the batch so the new tools/contributions go live.
      await session.pluginHost.reload();
    },
  };

  // Optional extra plugins offered in the wizard (installable catalog).
  const availablePlugins = INSTALLABLE_PLUGIN_CATALOG.map((e) => ({
    id: e.id,
    label: e.label,
    description: e.description,
  }));

  await runSetupWizard({
    providers,
    models,
    modes,
    embedders,
    controller,
    authKinds,
    availablePlugins,
    ...(cliVersion() ? { version: cliVersion()! } : {}),
  });

  return 0;
}

async function runHeadlessInit(
  session: import('@moxxy/core').Session,
  vault: import('@moxxy/plugin-vault').VaultStore,
): Promise<number> {
  process.stderr.write('moxxy init: no TTY — running headless. Reading provider keys from env.\n');
  let saved = 0;
  for (const provider of session.providers.list()) {
    if (providerAuthKind(provider) === 'oauth') {
      // OAuth providers can't auto-bootstrap from an env var; the device-code
      // flow needs a user. Skip silently — the user will run
      // `moxxy login <name>` separately.
      continue;
    }
    const canonical = canonicalKey(provider.name);
    const value = process.env[canonical];
    if (!value) continue;
    try {
      const existing = await vault.get(canonical);
      if (existing) continue;
      await vault.set(canonical, value, [provider.name]);
      saved += 1;
    } catch {
      // skip
    }
  }
  process.stderr.write(`moxxy init: saved ${saved} key(s) to vault.\n`);
  return 0;
}

/**
 * First-run vault passphrase, styled to match the setup wizard. The vault
 * encrypts API keys at rest; on first run a passphrase derives the master key
 * (then cached in the OS keychain / `~/.moxxy/vault.key` so later runs are
 * silent). TTY-only — headless init relies on `MOXXY_VAULT_PASSPHRASE` and the
 * vault's own non-TTY guard, so this is never wired up there.
 */
async function promptVaultPassphrase(): Promise<string> {
  note(
    [
      'moxxy keeps your API keys in a local encrypted vault.',
      "Choose a passphrase to protect it — it's cached in your OS keychain",
      `(or ${colors.dim('~/.moxxy/vault.key')}) so you won't be asked again.`,
      `Tip: set ${colors.bold('MOXXY_VAULT_PASSPHRASE')} to skip this prompt.`,
    ].join('\n'),
    'Step 0 — Vault passphrase',
  );
  const value = await password({
    message: 'Set a vault passphrase',
    validate: (v) => (v && v.trim().length > 0 ? undefined : 'Enter a passphrase (esc to cancel).'),
  });
  if (isCancel(value)) {
    cancel('Setup cancelled. Run `moxxy init` again when you are ready.');
    process.exit(1);
  }
  return (value as string).trim();
}

function providerAuthKind(def: ProviderDef): ProviderAuthKind {
  return def.auth?.kind === 'oauth' ? 'oauth' : 'apiKey';
}

function providerDescription(def: ProviderDef): string | undefined {
  if (def.auth?.kind === 'oauth') {
    const service = def.auth.serviceName;
    return service ? `OAuth · ${service}` : 'OAuth sign-in';
  }
  return def.models[0]?.id ? `default model: ${def.models[0].id}` : undefined;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
