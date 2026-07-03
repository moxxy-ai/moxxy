import { confirm, isCancel, log, password, select, text } from '@clack/prompts';
import { setPluginEnabled } from '@moxxy/config';
import {
  applySetupValues,
  listPluginSetups,
  setupFieldVaultKey,
  type PluginSetupField,
  type PluginSetupSpec,
  type SetupFieldValue,
} from '@moxxy/plugin-plugins-admin';
import { colors } from '../colors.js';

/** The vault slice plugin setup needs (mirrors ProviderVault). */
export interface SetupVault {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, tags?: ReadonlyArray<string>): Promise<void>;
}

export interface PluginSetupStepsOptions {
  readonly vault: SetupVault;
  readonly cwd: string;
  /** Restrict to these packages (post-install); omit = every installed plugin. */
  readonly only?: ReadonlyArray<string>;
  /** Injectable for tests. */
  readonly list?: () => Promise<ReadonlyArray<{ packageName: string; setup: PluginSetupSpec }>>;
}

/**
 * Walk the declarative setup steps of installed plugins (`moxxy.setup`) —
 * the plugin author's hook into `moxxy init`. Secrets go to the VAULT and
 * the plugin's `options.<key>` gets a `${vault:<name>}` ref (resolved at
 * boot); other kinds persist at `plugins.packages.<pkg>.options.<key>`.
 * Re-runs prefill: an already-set secret offers "enter to keep". Skipping a
 * `required: true` setup DISABLES the package (floor-safe: kernel packages
 * never declare setup) so it can't half-run unconfigured.
 */
export async function runPluginSetupSteps(opts: PluginSetupStepsOptions): Promise<void> {
  const all = await (opts.list ?? listPluginSetups)();
  const targets = opts.only ? all.filter((e) => opts.only!.includes(e.packageName)) : all;
  if (targets.length === 0) return;

  for (const { packageName, setup } of targets) {
    log.step(`${setup.title} ${colors.dim(`(${packageName})`)}`);
    if (setup.description) log.message(colors.dim(setup.description));

    if (!setup.required) {
      const want = await confirm({ message: 'Configure it now?', initialValue: true });
      if (isCancel(want) || !want) continue;
    }

    const values: Record<string, SetupFieldValue> = {};
    for (const field of setup.fields) {
      const v = await collectField(packageName, field, opts);
      if (v !== undefined) values[field.key] = v;
    }
    // ONE write implementation for every frontend (TUI dialog included):
    // secrets → vault + ${vault:NAME} ref; the rest → options.<key>.
    const result = await applySetupValues({
      vault: opts.vault,
      cwd: opts.cwd,
      packageName,
      setup,
      values,
    });

    if (!result.complete && setup.required) {
      await setPluginEnabled(packageName, false);
      log.warn(
        `${packageName} left DISABLED — its required setup is incomplete. ` +
          `Re-run \`moxxy init\` (or \`moxxy plugins enable ${packageName}\` after configuring by hand).`,
      );
    }
  }
}

/** Collect one field's value (undefined = skipped / keep-existing). */
async function collectField(
  packageName: string,
  field: PluginSetupField,
  opts: PluginSetupStepsOptions,
): Promise<SetupFieldValue | undefined> {
  if (field.kind === 'secret') {
    const vaultKey = setupFieldVaultKey(packageName, field);
    const existing = await opts.vault.get(vaultKey).catch(() => null);
    const answer = await password({
      message: `${field.label}${existing ? colors.dim(' (already set — enter to keep)') : ''}`,
    });
    if (isCancel(answer)) return undefined;
    const value = typeof answer === 'string' ? answer.trim() : '';
    return value.length > 0 ? value : undefined;
  }

  if (field.kind === 'boolean') {
    const answer = await confirm({ message: field.label, initialValue: true });
    return isCancel(answer) ? undefined : answer;
  }

  if (field.kind === 'select') {
    const choices = field.options ?? [];
    if (choices.length === 0) return undefined;
    const answer = await select({
      message: field.label,
      options: choices.map((c) => ({ value: c, label: c })),
    });
    return isCancel(answer) ? undefined : (answer as string);
  }

  const answer = await text({
    message: field.label,
    ...(field.placeholder ? { placeholder: field.placeholder } : {}),
  });
  if (isCancel(answer)) return undefined;
  const value = typeof answer === 'string' ? answer.trim() : '';
  return value.length > 0 ? value : undefined;
}
