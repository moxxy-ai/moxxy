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
import {
  renderYaml,
  type ProviderAuthKind,
  type SetupChoice,
  type SetupSelections,
} from '@moxxy/plugin-cli';
import { colors } from '../colors.js';

export interface EnsureProviderResult {
  readonly models: ReadonlyArray<SetupChoice>;
  readonly authKind: ProviderAuthKind;
}

export interface SetupWizardController {
  saveApiKey(providerId: string, key: string): Promise<void>;
  /**
   * Persist the user's selections. Receives the structured selections (NOT a
   * pre-rendered YAML string) so the implementation can merge them into the
   * unified `~/.moxxy/config.yaml` tree without clobbering the package ledger
   * the wizard already wrote. Returns the path written, for the "Wrote …" line.
   */
  writeConfig(selections: SetupSelections): Promise<string>;
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
   * cancellation; the wizard offers a retry. `opts.headless` requests the
   * no-browser (device-code) flow — only passed when the provider reports
   * {@link oauthSupportsHeadless}.
   */
  loginOAuth?(providerId: string, opts?: { readonly headless?: boolean }): Promise<void>;
  /**
   * Whether this OAuth provider has a real no-browser (device-code / manual-URL)
   * flow. When true the wizard offers the user a browser-vs-no-browser choice
   * before signing in — useful on a headless box where a loopback browser flow
   * can't complete. Absent / false → the wizard just runs the default flow.
   */
  oauthSupportsHeadless?(providerId: string): boolean;
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
  /** Expose runtime choices and YAML review instead of using product defaults. */
  readonly advanced?: boolean;
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
  cancel('Setup cancelled. Run `moxxy` again when you are ready.');
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

function connectionLabel(choices: ReadonlyArray<SetupChoice>, id: string): string {
  return choices.find((choice) => choice.id === id)?.label ?? id;
}

export async function runSetupWizard(opts: RunSetupWizardOptions): Promise<string> {
  const version = opts.version ? colors.dim(` v${opts.version}`) : '';
  intro(`${colors.bold('moxxy')}${version} ${colors.dim('— developer alpha setup')}`);

  note(
    opts.advanced
      ? [
          `${colors.bold('1.')} Connect a model account`,
          `${colors.bold('2.')} Choose advanced runtime defaults`,
          `${colors.bold('3.')} Review ${colors.bold('~/.moxxy/config.yaml')}`,
        ].join('\n')
      : [
          `${colors.bold('1.')} Choose a model account`,
          `${colors.bold('2.')} Sign in or add an API key`,
          `${colors.bold('3.')} Start working — safe defaults are selected for you`,
        ].join('\n'),
    'What this will do',
  );

  // Step 1 — model connection
  const providerOptions = opts.providers
    .filter((p) => !p.disabled)
    .map((p) => {
      const hint = p.description;
      return hint === undefined
        ? { value: p.id, label: p.label }
        : { value: p.id, label: p.label, hint };
    });
  if (providerOptions.length === 0) {
    cancel('No model connections are available. Run `moxxy doctor` for details.');
    process.exit(1);
  }

  const providerRaw = await select({
    message: 'Step 1 — Which model account do you want to connect?',
    options: providerOptions,
    initialValue: providerOptions[0]!.value,
  });
  const provider = guard(providerRaw);
  const selectedConnectionLabel = connectionLabel(opts.providers, provider);

  // Ensure the provider is available (install + enable a catalog-only one) BEFORE
  // collecting credentials, so its real models + auth kind are known. A bundled
  // provider resolves instantly. Falls back to the upfront maps when no
  // ensureProvider hook is wired (the all-bundled path).
  let modelChoices = opts.models[provider] ?? [];
  let providerKind = authKind(opts.authKinds, provider);
  if (opts.controller.ensureProvider) {
    const prep = spinner();
    prep.start(`Preparing ${selectedConnectionLabel}`);
    try {
      const resolved = await opts.controller.ensureProvider(provider);
      prep.stop(`${colors.bold('✓')} ${selectedConnectionLabel} ready`);
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
    const supportsHeadless = opts.controller.oauthSupportsHeadless?.(provider) ?? false;
    await collectOAuth(provider, opts.controller.loginOAuth, supportsHeadless);
    oauthCompleted.push(provider);
  } else {
    apiKeys[provider] = await collectKey(provider, opts.controller);
  }

  // Product defaults keep the personal path to provider + authentication.
  // Advanced setup retains every runtime choice for authors and operators.
  let model = modelChoices[0]?.id ?? null;
  let mode = opts.modes[0]?.id ?? 'default';
  let embedder = opts.embedders[0]?.id ?? 'tfidf';
  let securityEnabled = false;

  if (opts.advanced && modelChoices.length > 0) {
    const modelRaw = await select({
      message: `Step 3 — Default model for ${colors.bold(provider)}`,
      options: toOptions(modelChoices),
      initialValue: model,
    });
    model = guard(modelRaw);
  }

  if (opts.advanced) {
    const modeRaw = await select({
      message: 'Step 4 — Runtime mode',
      options: toOptions(opts.modes),
      initialValue: mode,
    });
    mode = guard(modeRaw);

    const embedderRaw = await select({
      message: 'Step 5 — Memory index',
      options: toOptions(opts.embedders),
      initialValue: embedder,
    });
    embedder = guard(embedderRaw);

    const securityRaw = await confirm({
      message:
        'Step 6 — Enable extension isolation? ' +
        colors.dim('(per-tool capability isolation; off by default)'),
      initialValue: false,
    });
    securityEnabled = guard(securityRaw);
  } else {
    note(
      [
        `Connected  ${colors.bold(selectedConnectionLabel)}`,
        `Model      ${colors.bold(model ?? 'recommended default')}`,
        colors.dim('Safe local defaults are ready. Advanced controls remain optional.'),
      ].join('\n'),
      'Recommended defaults',
    );
  }

  // Step 7 — optional extra plugins. Skippable: offer a multiselect of
  // installable plugins (telegram, browser, …); chosen ones are installed +
  // enabled at persist time. Only shown when the host wired a catalog + handler.
  let extraPlugins: ReadonlyArray<string> = [];
  if (
    opts.advanced &&
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

  if (opts.advanced) {
    const yaml = renderYaml(selections);
    note(yaml, 'Step 8 — Review (~/.moxxy/config.yaml)');

    const confirmedRaw = await confirm({
      message: 'Save config and store keys in the vault?',
      initialValue: true,
    });
    if (!guard(confirmedRaw)) bail();
  }

  // Persist. An OAuth provider's tokens were stored inline in step 2 (the
  // OAuth flow is interactive and can't be reduced to a fire-and-forget write
  // here), so this stage only needs to persist the API key and the selections.
  const persist = spinner();
  persist.start(opts.advanced ? 'Writing config and storing keys' : 'Saving model connection');
  if (providerKind !== 'oauth') {
    const key = apiKeys[provider];
    if (key) await opts.controller.saveApiKey(provider, key);
  }
  const configPath = await opts.controller.writeConfig(selections);
  persist.stop(
    opts.advanced
      ? `Wrote ${colors.bold(configPath)}`
      : `${colors.bold('✓')} Model connection saved`,
  );

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
    opts.advanced
      ? `${colors.bold('✓')} Advanced setup complete. Run ${colors.bold('moxxy')} to start.`
      : `${colors.bold('✓')} Ready. Run ${colors.bold('moxxy')} in a project and ask your first question.`,
  );
  return configPath;
}

async function collectOAuth(
  providerId: string,
  loginOAuth: (providerId: string, opts?: { readonly headless?: boolean }) => Promise<void>,
  supportsHeadless: boolean,
): Promise<void> {
  // Providers with a device-code fallback let the user pick how to sign in. On
  // a headless / remote box the loopback browser flow can't complete, so offer
  // a no-browser path that just prints a URL + code to enter elsewhere.
  let headless: boolean | undefined;
  if (supportsHeadless) {
    const choiceRaw = await select({
      message: `Step 2 — How do you want to sign in to ${colors.bold(providerId)}?`,
      options: [
        {
          value: 'browser',
          label: 'Open a browser on this machine',
          hint: 'loopback callback — for a local desktop',
        },
        {
          value: 'no-browser',
          label: 'No browser — show a URL + code to enter elsewhere',
          hint: 'device-code flow — for a headless / remote box',
        },
      ],
      initialValue: 'browser',
    });
    headless = guard(choiceRaw) === 'no-browser';
  }
  const loginOpts = headless === undefined ? undefined : { headless };
  while (true) {
    log.step(`Step 2 — Sign in to ${colors.bold(providerId)} (OAuth)`);
    try {
      await loginOAuth(providerId, loginOpts);
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
