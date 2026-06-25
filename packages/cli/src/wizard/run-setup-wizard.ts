import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  multiselect,
  note,
  outro,
  password,
  select,
  spinner,
} from '@clack/prompts';
import { renderYaml, type ProviderAuthKind, type SetupChoice } from '@moxxy/plugin-cli';
import { colors } from '../colors.js';

export interface EnsureProviderResult {
  readonly models: ReadonlyArray<SetupChoice>;
  readonly authKind: ProviderAuthKind;
}

export interface SetupWizardController {
  saveApiKey(providerId: string, key: string): Promise<void>;
  writeConfig(yaml: string): Promise<string>;
  /**
   * Make the picked provider available before collecting credentials: a bundled
   * provider resolves instantly; a catalog-only one is installed from npm +
   * enabled here, then its real models + auth kind are returned. Throw on a
   * failed install (the wizard bails). When absent, the wizard uses the
   * upfront `models`/`authKinds` maps (the all-bundled case).
   */
  ensureProvider?(providerId: string): Promise<EnsureProviderResult | null>;
  testKey?(
    providerId: string,
    key: string,
  ): Promise<{ ok: true } | { ok: false; message: string }>;
  /**
   * Drive the OAuth sign-in flow for a provider whose `authKind` is `'oauth'`.
   * Implementations should print their own progress (browser URL, device code,
   * etc.) and persist credentials to the vault. Throw on failure / user
   * cancellation; the wizard offers a retry.
   */
  loginOAuth?(providerId: string): Promise<void>;
  /**
   * Install + enable the chosen optional plugins (by catalog id / package name).
   * Best-effort: implementations should report per-plugin failures and continue.
   */
  installPlugins?(ids: ReadonlyArray<string>): Promise<void>;
}

export interface RunSetupWizardOptions {
  readonly providers: ReadonlyArray<SetupChoice>;
  readonly models: Record<string, ReadonlyArray<SetupChoice>>;
  readonly modes: ReadonlyArray<SetupChoice>;
  readonly embedders: ReadonlyArray<SetupChoice>;
  readonly controller: SetupWizardController;
  readonly version?: string;
  /** Per-provider auth kind. Providers absent here are treated as `'apiKey'`. */
  readonly authKinds?: Record<string, ProviderAuthKind>;
  /** Optional extra plugins the user may install during setup (skippable step). */
  readonly availablePlugins?: ReadonlyArray<SetupChoice>;
}

interface Selections {
  readonly providers: ReadonlyArray<string>;
  readonly apiKeys: Record<string, string>;
  readonly oauthCompleted: ReadonlyArray<string>;
  readonly primary: string;
  readonly model: string | null;
  readonly mode: string;
  readonly embedder: string;
  readonly authKinds?: Record<string, ProviderAuthKind>;
  readonly security?: { readonly enabled: boolean; readonly isolator?: string };
}

function authKind(
  authKinds: Record<string, ProviderAuthKind> | undefined,
  providerId: string,
): ProviderAuthKind {
  return authKinds?.[providerId] ?? 'apiKey';
}

function bail(): never {
  cancel('Setup cancelled. Run `moxxy init` again when you are ready.');
  process.exit(1);
}

function guard<T>(value: T): Exclude<T, symbol> {
  if (isCancel(value)) bail();
  return value as Exclude<T, symbol>;
}

function toOptions(
  choices: ReadonlyArray<SetupChoice>,
): Array<{ value: string; label: string; hint?: string }> {
  return choices.map((c) => {
    const hint = c.description ?? (c.disabled ? c.disabled : undefined);
    return hint === undefined
      ? { value: c.id, label: c.label }
      : { value: c.id, label: c.label, hint };
  });
}

export async function runSetupWizard(opts: RunSetupWizardOptions): Promise<string> {
  const version = opts.version ? colors.dim(` v${opts.version}`) : '';
  intro(`${colors.bold('moxxy')}${version} ${colors.dim('— first-time setup')}`);

  note(
    [
      `${colors.bold('1.')} Pick an LLM provider`,
      `${colors.bold('2.')} Paste your API key (stored encrypted in the vault)`,
      `${colors.bold('3.')} Choose a default model, mode, and memory embedder`,
      `${colors.bold('4.')} Review and write ${colors.bold('moxxy.config.yaml')} into the project`,
    ].join('\n'),
    'What this will do',
  );

  // Step 1 — providers
  const providerOptions = opts.providers
    .filter((p) => !p.disabled)
    .map((p) => {
      const hint = p.description;
      return hint === undefined
        ? { value: p.id, label: p.label }
        : { value: p.id, label: p.label, hint };
    });
  if (providerOptions.length === 0) {
    cancel('No selectable providers are registered. Install a provider plugin and try again.');
    process.exit(1);
  }

  const providerRaw = await select({
    message: 'Step 1 — Which provider do you want to use?',
    options: providerOptions,
    initialValue: providerOptions[0]!.value,
  });
  const provider = guard(providerRaw);

  // Ensure the provider is available (install + enable a catalog-only one) BEFORE
  // collecting credentials, so its real models + auth kind are known. A bundled
  // provider resolves instantly. Falls back to the upfront maps when no
  // ensureProvider hook is wired (the all-bundled path).
  let modelChoices = opts.models[provider] ?? [];
  let providerKind = authKind(opts.authKinds, provider);
  if (opts.controller.ensureProvider) {
    const prep = spinner();
    prep.start(`Preparing ${provider}`);
    try {
      const resolved = await opts.controller.ensureProvider(provider);
      prep.stop(`${colors.bold('✓')} ${provider} ready`);
      if (resolved) {
        modelChoices = resolved.models;
        providerKind = resolved.authKind;
      }
    } catch (err) {
      prep.stop(
        `${colors.red('✗')} could not prepare ${provider}: ${err instanceof Error ? err.message : String(err)}`,
      );
      bail();
    }
  }

  // Step 2 — credentials. An API-key provider prompts for a key (with optional
  // live validation); an OAuth provider runs its full sign-in flow inline.
  const apiKeys: Record<string, string> = {};
  const oauthCompleted: string[] = [];
  if (providerKind === 'oauth') {
    if (!opts.controller.loginOAuth) {
      cancel(
        `Provider ${provider} requires OAuth but the wizard has no loginOAuth handler wired up.`,
      );
      process.exit(1);
    }
    await collectOAuth(provider, opts.controller.loginOAuth);
    oauthCompleted.push(provider);
  } else {
    apiKeys[provider] = await collectKey(provider, opts.controller);
  }

  // Step 3 — model (from the resolved provider's real models)
  let model: string | null = null;
  if (modelChoices.length > 0) {
    const modelRaw = await select({
      message: `Step 3 — Default model for ${colors.bold(provider)}`,
      options: toOptions(modelChoices),
      initialValue: modelChoices[0]!.id,
    });
    model = guard(modelRaw);
  }

  // Step 4 — mode
  const modeRaw = await select({
    message: 'Step 4 — Mode',
    options: toOptions(opts.modes),
    initialValue: opts.modes[0]?.id ?? 'default',
  });
  const mode = guard(modeRaw);

  // Step 5 — embedder
  const embedderRaw = await select({
    message: 'Step 5 — Memory embedder',
    options: toOptions(opts.embedders),
    initialValue: opts.embedders[0]?.id ?? 'tfidf',
  });
  const embedder = guard(embedderRaw);

  // Step 6 — plugin-security opt-in. Default off — declared
  // capabilities on individual tools remain advisory unless the user
  // turns this on. See `@moxxy/plugin-security` for what enabling buys.
  const securityRaw = await confirm({
    message:
      'Step 6 — Enable plugin-security? ' +
      colors.dim('(per-tool capability isolation; off by default)'),
    initialValue: false,
  });
  const securityEnabled = guard(securityRaw);

  // Step 7 — optional extra plugins. Skippable: offer a multiselect of
  // installable plugins (telegram, browser, …); chosen ones are installed +
  // enabled at persist time. Only shown when the host wired a catalog + handler.
  let extraPlugins: ReadonlyArray<string> = [];
  if (
    opts.availablePlugins &&
    opts.availablePlugins.length > 0 &&
    opts.controller.installPlugins
  ) {
    const wantRaw = await confirm({
      message: `Step 7 — Install extra plugins? ${colors.dim('(optional)')}`,
      initialValue: false,
    });
    if (guard(wantRaw)) {
      const pickedRaw = await multiselect({
        message: 'Pick plugins to install + enable (space to toggle, enter to confirm)',
        options: opts.availablePlugins.map((p) =>
          p.description
            ? { value: p.id, label: p.label, hint: p.description }
            : { value: p.id, label: p.label },
        ),
        required: false,
      });
      extraPlugins = guard(pickedRaw) as string[];
    }
  }

  const selections: Selections = {
    providers: [provider],
    apiKeys,
    oauthCompleted,
    primary: provider,
    model,
    mode,
    embedder,
    ...(opts.authKinds ? { authKinds: opts.authKinds } : {}),
    ...(securityEnabled ? { security: { enabled: true, isolator: 'inproc' } } : {}),
  };

  // Step 8 — review
  const yaml = renderYaml(selections);
  note(yaml, 'Step 8 — Review (moxxy.config.yaml)');

  const confirmedRaw = await confirm({
    message: 'Save config and store keys in the vault?',
    initialValue: true,
  });
  const confirmed = guard(confirmedRaw);
  if (!confirmed) bail();

  // Persist. An OAuth provider's tokens were stored inline in step 2 (the
  // OAuth flow is interactive and can't be reduced to a fire-and-forget write
  // here), so this stage only needs to persist the API key and rendered YAML.
  const persist = spinner();
  persist.start('Writing config and storing keys');
  if (providerKind !== 'oauth') {
    const key = apiKeys[provider];
    if (key) await opts.controller.saveApiKey(provider, key);
  }
  const configPath = await opts.controller.writeConfig(yaml);
  persist.stop(`Wrote ${colors.bold(configPath)}`);

  // Install any optional plugins the user picked (best-effort; the controller
  // reports per-plugin outcomes).
  if (extraPlugins.length > 0 && opts.controller.installPlugins) {
    const ps = spinner();
    ps.start(`Installing ${extraPlugins.length} plugin(s)`);
    try {
      await opts.controller.installPlugins(extraPlugins);
      ps.stop(`${colors.bold('✓')} installed ${extraPlugins.join(', ')}`);
    } catch (err) {
      ps.stop(
        `${colors.yellow('!')} some plugins failed to install: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  outro(
    `${colors.bold('✓')} Setup complete. Try ${colors.bold('moxxy -p "hello"')} to verify, ` +
      `or just run ${colors.bold('moxxy')} for the interactive TUI.`,
  );
  return configPath;
}

async function collectOAuth(
  providerId: string,
  loginOAuth: (providerId: string) => Promise<void>,
): Promise<void> {
  while (true) {
    log.step(`Step 2 — Sign in to ${colors.bold(providerId)} (OAuth)`);
    try {
      await loginOAuth(providerId);
      log.success(`${providerId} sign-in complete`);
      return;
    } catch (err) {
      log.error(`${providerId} sign-in failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const retryRaw = await confirm({
      message: `Retry ${providerId} sign-in?`,
      initialValue: true,
    });
    const retry = guard(retryRaw);
    if (!retry) bail();
  }
}

async function collectKey(providerId: string, controller: SetupWizardController): Promise<string> {
  while (true) {
    const valueRaw = await password({
      message: `Step 2 — API key for ${colors.bold(providerId)}`,
      // Reject empty so users don't accidentally skip — esc cancels the wizard.
      validate: (v) => (v && v.trim().length > 0 ? undefined : 'Paste your API key (esc to cancel).'),
    });
    const value = guard(valueRaw).trim();

    if (!controller.testKey) return value;

    const s = spinner();
    s.start(`Validating ${providerId} key`);
    // Distinguish an explicit provider rejection (the key is known-bad) from a
    // validator-unreachable error (the key might be fine — the network failed).
    let rejected = false;
    try {
      const result = await controller.testKey(providerId, value);
      if (result.ok) {
        s.stop(`${colors.bold('✓')} ${providerId} key looks good`);
        return value;
      }
      // Key was rejected by the provider — fatal-flavored, keep red.
      rejected = true;
      s.stop(`${colors.red('✗')} ${providerId} rejected the key: ${result.message}`);
    } catch (err) {
      // Couldn't reach the validator — warn-flavored, keep yellow.
      s.stop(
        `${colors.yellow('!')} could not validate ${providerId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const retryRaw = await confirm({
      message: 'Try a different key?',
      initialValue: true,
    });
    const retry = guard(retryRaw);
    if (!retry) {
      // Decline-after-rejection must NOT persist a key the provider already
      // said is bad — bail out instead. Only the validator-unreachable case
      // falls through to accept the unvalidated value, since there the network
      // (not the key) may be the problem.
      if (rejected) bail();
      return value;
    }
  }
}
