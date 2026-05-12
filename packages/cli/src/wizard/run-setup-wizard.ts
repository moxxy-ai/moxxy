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

export interface SetupWizardController {
  saveApiKey(providerId: string, key: string): Promise<void>;
  writeConfig(yaml: string): Promise<string>;
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
}

export interface RunSetupWizardOptions {
  readonly providers: ReadonlyArray<SetupChoice>;
  readonly models: Record<string, ReadonlyArray<SetupChoice>>;
  readonly loops: ReadonlyArray<SetupChoice>;
  readonly embedders: ReadonlyArray<SetupChoice>;
  readonly controller: SetupWizardController;
  readonly version?: string;
  /** Per-provider auth kind. Providers absent here are treated as `'apiKey'`. */
  readonly authKinds?: Record<string, ProviderAuthKind>;
}

interface Selections {
  readonly providers: ReadonlyArray<string>;
  readonly apiKeys: Record<string, string>;
  readonly oauthCompleted: ReadonlyArray<string>;
  readonly primary: string;
  readonly model: string | null;
  readonly loop: string;
  readonly embedder: string;
  readonly authKinds?: Record<string, ProviderAuthKind>;
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

function guard<T>(value: T | symbol): T {
  if (isCancel(value)) bail();
  return value as T;
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
  intro(`${colors.bold(colors.magenta('moxxy'))}${version} ${colors.dim('— first-time setup')}`);

  note(
    [
      `${colors.bold('1.')} Pick one or more LLM providers`,
      `${colors.bold('2.')} Paste each API key (stored encrypted in the vault)`,
      `${colors.bold('3.')} Choose a default model, loop strategy, and memory embedder`,
      `${colors.bold('4.')} Review and write ${colors.cyan('moxxy.config.yaml')} into the project`,
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

  const chosenProvidersRaw = await multiselect({
    message: 'Step 1 — Which provider(s) do you want to use?',
    options: providerOptions,
    required: true,
    initialValues: [providerOptions[0]!.value],
  });
  const chosenProviders = guard(chosenProvidersRaw) as string[];

  // Step 2 — credentials per provider. API-key providers prompt for a key
  // (with optional live validation); OAuth providers run their full sign-in
  // flow inline.
  const apiKeys: Record<string, string> = {};
  const oauthCompleted: string[] = [];
  for (const providerId of chosenProviders) {
    if (authKind(opts.authKinds, providerId) === 'oauth') {
      if (!opts.controller.loginOAuth) {
        cancel(
          `Provider ${providerId} requires OAuth but the wizard has no loginOAuth handler wired up.`,
        );
        process.exit(1);
      }
      await collectOAuth(providerId, opts.controller.loginOAuth);
      oauthCompleted.push(providerId);
    } else {
      apiKeys[providerId] = await collectKey(providerId, opts.controller);
    }
  }

  // Step 3 — primary (only if >1)
  let primary = chosenProviders[0]!;
  if (chosenProviders.length > 1) {
    const primaryRaw = await select({
      message: 'Step 3 — Which provider should be primary?',
      options: chosenProviders.map((id) => ({ value: id, label: id })),
      initialValue: primary,
    });
    primary = guard(primaryRaw) as string;
  }

  // Step 4 — model for primary
  const modelChoices = opts.models[primary] ?? [];
  let model: string | null = null;
  if (modelChoices.length > 0) {
    const modelRaw = await select({
      message: `Step 4 — Default model for ${colors.cyan(primary)}`,
      options: toOptions(modelChoices),
      initialValue: modelChoices[0]!.id,
    });
    model = guard(modelRaw) as string;
  }

  // Step 5 — loop
  const loopRaw = await select({
    message: 'Step 5 — Loop strategy',
    options: toOptions(opts.loops),
    initialValue: opts.loops[0]?.id ?? 'tool-use',
  });
  const loop = guard(loopRaw) as string;

  // Step 6 — embedder
  const embedderRaw = await select({
    message: 'Step 6 — Memory embedder',
    options: toOptions(opts.embedders),
    initialValue: opts.embedders[0]?.id ?? 'tfidf',
  });
  const embedder = guard(embedderRaw) as string;

  const selections: Selections = {
    providers: chosenProviders,
    apiKeys,
    oauthCompleted,
    primary,
    model,
    loop,
    embedder,
    ...(opts.authKinds ? { authKinds: opts.authKinds } : {}),
  };

  // Step 7 — review
  const yaml = renderYaml(selections);
  note(yaml, 'Step 7 — Review (moxxy.config.yaml)');

  const confirmedRaw = await confirm({
    message: 'Save config and store keys in the vault?',
    initialValue: true,
  });
  const confirmed = guard(confirmedRaw) as boolean;
  if (!confirmed) bail();

  // Step 8 — persist. OAuth tokens were stored inline in step 2 (the OAuth
  // flow is interactive and can't be reduced to a fire-and-forget write here),
  // so this stage only needs to persist API keys and the rendered YAML.
  const persist = spinner();
  persist.start('Writing config and storing keys');
  for (const providerId of chosenProviders) {
    if (authKind(opts.authKinds, providerId) === 'oauth') continue;
    const key = apiKeys[providerId];
    if (key) await opts.controller.saveApiKey(providerId, key);
  }
  const configPath = await opts.controller.writeConfig(yaml);
  persist.stop(`Wrote ${colors.cyan(configPath)}`);

  outro(
    `${colors.green('✓')} Setup complete. Try ${colors.cyan('moxxy -p "hello"')} to verify, ` +
      `or just run ${colors.cyan('moxxy')} for the interactive TUI.`,
  );
  return configPath;
}

async function collectOAuth(
  providerId: string,
  loginOAuth: (providerId: string) => Promise<void>,
): Promise<void> {
  while (true) {
    log.step(`Step 2 — Sign in to ${colors.cyan(providerId)} (OAuth)`);
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
    const retry = guard(retryRaw) as boolean;
    if (!retry) bail();
  }
}

async function collectKey(providerId: string, controller: SetupWizardController): Promise<string> {
  while (true) {
    const valueRaw = await password({
      message: `Step 2 — API key for ${colors.cyan(providerId)}`,
      // Reject empty so users don't accidentally skip — esc cancels the wizard.
      validate: (v) => (v && v.trim().length > 0 ? undefined : 'Paste your API key (esc to cancel).'),
    });
    const value = (guard(valueRaw) as string).trim();

    if (!controller.testKey) return value;

    const s = spinner();
    s.start(`Validating ${providerId} key`);
    try {
      const result = await controller.testKey(providerId, value);
      if (result.ok) {
        s.stop(`${colors.green('✓')} ${providerId} key looks good`);
        return value;
      }
      s.stop(`${colors.red('✗')} ${providerId} rejected the key: ${result.message}`);
    } catch (err) {
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
    const retry = guard(retryRaw) as boolean;
    if (!retry) {
      // Accept the unvalidated value rather than bailing — sometimes the
      // network is the problem, not the key.
      return value;
    }
  }
}
