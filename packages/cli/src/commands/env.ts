import { isCancel, password } from '@clack/prompts';
import { ENV_SHARE_PRIVACY_NOTE } from '@moxxy/sdk/questions';
import { envShareNameSchema } from '@moxxy/sdk';
import { buildVaultPlugin } from '@moxxy/plugin-vault';
import type { ParsedArgv } from '../argv.js';
import { loadRawConfig } from '../setup/load-config.js';

export async function runEnvCommand(argv: ParsedArgv): Promise<number> {
  const [action, name] = argv.positional;
  const usage = 'Usage: moxxy env share <NAME>\nEnter the value in the private prompt.\n';
  if (argv.flags.help || argv.flags.h) {
    process.stdout.write(usage);
    return 0;
  }
  if (action !== 'share' || argv.positional.length !== 2 || !name || !envShareNameSchema.safeParse(name).success) {
    process.stderr.write(usage);
    return 2;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write('Env Share requires an interactive terminal.\n');
    return 1;
  }
  const { rawConfig } = await loadRawConfig({
    cwd: process.cwd(),
    configPath: typeof argv.flags.config === 'string' ? argv.flags.config : undefined,
  });
  const { vault } = buildVaultPlugin({
    requirePassphrase: rawConfig.vault?.requirePassphrase === true,
    passphrasePrompt: async () => {
      const phrase = await password({ message: 'Vault passphrase' });
      if (isCancel(phrase) || !phrase) throw new Error('Vault unlock cancelled.');
      return phrase;
    },
  });
  try {
    process.stdout.write(ENV_SHARE_PRIVACY_NOTE + '\n');
    const value = await password({
      message: 'Save or replace ' + name + ' in your Moxxy vault',
      validate: (v) => v && v.length <= 65536 ? undefined : 'Enter 1 to 65536 characters.',
    });
    if (isCancel(value) || !value) return 1;
    await vault.setShared(name, value);
    process.stdout.write('Saved. Reference: ${vault:' + name + '}\n');
    return 0;
  } finally {
    vault.close();
  }
}
