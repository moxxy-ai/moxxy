import { bootSessionWithConfig, stringFlag } from '../argv-helpers.js';
import { closeSession } from '../setup/close-session.js';
import { cliVersion } from '../version.js';
import type { ParsedArgv } from '../argv.js';
import { provision, type ProvisionSpec } from '../provision/provision.js';
import { installPluginPackage, resolveCatalogPackageName } from '@moxxy/plugin-plugins-admin';
import { setCategoryDefault, setPluginEnabled, setProviderModel } from '@moxxy/config';

/**
 * `moxxy provision` — headless first-run setup. Installs the chosen provider (+
 * accepted basics) on demand, stores its key in the vault, and writes the
 * unified `plugins:` config — the same `provision()` engine the interactive
 * `init` wizard and (later) the desktop's first-run drive. Drive it with flags
 * (`--provider anthropic --key … --model …`) or a JSON spec on stdin (`--spec -`).
 */
export async function runProvisionCommand(argv: ParsedArgv): Promise<number> {
  let spec: ProvisionSpec;
  try {
    spec = await parseSpec(argv);
  } catch (err) {
    process.stderr.write(`moxxy provision: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  const { session, vault, persistence } = await bootSessionWithConfig(argv, {
    skipKeyPrompt: true,
    skipProviderActivation: true,
  });
  try {
    const result = await provision(spec, {
      loadedProviderNames: new Set(session.providers.list().map((p) => p.name)),
      install: async (s) => {
        await installPluginPackage({ packageName: s });
      },
      storeSecret: (name, value, tags) => vault.set(name, value, [...tags]),
      resolveBasicPackage: (idOrName) => resolveCatalogPackageName(idOrName),
      writeConfig: async (w) => {
        // Enable the provider's package (only when it was installed — a bundled
        // provider is already compiled in) + every accepted basic.
        if (!w.providerBundled) await setPluginEnabled(w.providerPackage, true);
        for (const pkg of w.basicsPackages) await setPluginEnabled(pkg, true);
        await setCategoryDefault('provider', w.providerSlug);
        if (w.model) await setProviderModel(w.providerSlug, w.model);
      },
      ...(cliVersion() ? { cliVersion: cliVersion() } : {}),
      log: (m) => process.stderr.write(`moxxy provision: ${m}\n`),
    });

    // Make freshly-installed packages live in this session (best-effort).
    if (result.installed.length > 0) {
      await session.pluginHost.reload().catch(() => undefined);
    }

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`moxxy provision: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  } finally {
    await closeSession(session, persistence);
  }
}

async function parseSpec(argv: ParsedArgv): Promise<ProvisionSpec> {
  // `--spec -` → read a JSON ProvisionSpec from stdin (the automation/desktop path).
  if (stringFlag(argv, 'spec') === '-') {
    const raw = await readStdin();
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || typeof (parsed as { provider?: unknown }).provider !== 'string') {
      throw new Error('--spec JSON must be an object with a string "provider".');
    }
    return parsed as ProvisionSpec;
  }
  // Flag form.
  const provider = stringFlag(argv, 'provider');
  if (!provider) {
    throw new Error('pass --provider <slug> (e.g. anthropic) plus optional --model/--key/--basics, or --spec - for JSON on stdin.');
  }
  const model = stringFlag(argv, 'model');
  const key = stringFlag(argv, 'key');
  const basics = stringFlag(argv, 'basics');
  return {
    provider,
    ...(model ? { model } : {}),
    ...(key ? { key } : {}),
    ...(basics ? { basics: basics.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
  };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}
