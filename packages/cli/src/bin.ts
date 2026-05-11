#!/usr/bin/env node
import { parseArgv } from './argv.js';
import { runPromptCommand } from './commands/prompt.js';
import { runTuiCommand } from './commands/tui.js';
import { runSkillsCommand } from './commands/skills.js';
import { runPluginsCommand } from './commands/plugins.js';
import { runChannelsCommand } from './commands/channels.js';
import { runChannelByName } from './commands/run-channel.js';
import { runInitCommand } from './commands/init.js';
import { runPermsCommand } from './commands/perms.js';
import { runMemoryCommand } from './commands/memory.js';
import { runDoctorCommand } from './commands/doctor.js';
import { setupSessionWithConfig } from './setup.js';
import { renderLogo } from './logo.js';
import { colors } from './colors.js';

const KNOWN_COMMANDS = new Set([
  'help',
  'version',
  'prompt',
  'tui',
  'skills',
  'plugins',
  'channels',
  'init',
  'perms',
  'memory',
  'doctor',
]);

const HELP = `usage:
  moxxy init                         interactive first-time setup (provider keys → vault)
  moxxy                              start interactive TUI (default channel)
  moxxy tui                          start the Ink TUI channel
  moxxy <channel-name>               start any registered channel by name
                                       (e.g. moxxy slack — once such a channel is installed)
  moxxy -p "..."                     one-shot prompt to stdout
  moxxy --prompt "..." [flags]       same; flags: --allow-tools, --allow-all,
                                                  --output-format text|json|stream-json,
                                                  --model <model-id>
  moxxy channels                     list registered channels + their subcommands
  moxxy channels <name>              start a channel by name (same as 'moxxy <name>')
  moxxy channels <name> <sub> [...]  invoke a channel-defined subcommand
                                     (e.g. 'moxxy channels telegram pair|unpair|status')
  moxxy skills list|new <name>       manage skill files
  moxxy plugins list|reload          manage plugin host
  moxxy perms list|allow|deny|remove|clear|path  view/edit the permission policy
  moxxy memory list|audit|show|revert|prune-stale|path  curate long-term memory
  moxxy doctor [--check-keys]        diagnose config, vault, providers, channels, memory
  moxxy --help                       this help
  moxxy --version                    print version

provider API keys are resolved in order:  vault → env var → interactive prompt
(the prompt only runs in a TTY; prompted values are saved back to the vault).

env:
  ANTHROPIC_API_KEY                  default Anthropic provider key
  OPENAI_API_KEY                     OpenAI provider key (and openai embeddings)
  MOXXY_FIXTURES=record|replay       provider fixture mode (used by tests)
  MOXXY_VAULT_PASSPHRASE             headless vault passphrase (alt to keychain)
  MOXXY_TELEGRAM_TOKEN               override the vault-stored Telegram token
`;

async function main(): Promise<number> {
  const argv = parseArgv(process.argv.slice(2));

  switch (argv.command) {
    case 'help':
      process.stdout.write(renderLogo() + HELP);
      return 0;
    case 'version':
      process.stdout.write(renderLogo() + 'moxxy 0.0.0\n');
      return 0;
    case 'init':
      return await runInitCommand(argv);
    case 'perms':
      return await runPermsCommand(argv);
    case 'memory':
      return await runMemoryCommand(argv);
    case 'doctor':
      return await runDoctorCommand(argv);
    case 'prompt':
      return await runPromptCommand(argv);
    case 'tui':
      return await runTuiCommand(argv);
    case 'skills':
      return await runSkillsCommand(argv);
    case 'plugins':
      return await runPluginsCommand(argv);
    case 'channels':
      return await runChannelsCommand(argv);
    default:
      // Not a built-in command? Check if it names a registered channel.
      // Skip the API-key prompt so an unknown command doesn't accidentally
      // boot the provider.
      if (!KNOWN_COMMANDS.has(argv.command)) {
        try {
          const { session } = await setupSessionWithConfig({
            cwd: process.cwd(),
            skipKeyPrompt: true,
          });
          if (session.channels.has(argv.command)) {
            return await runChannelByName(argv.command, argv);
          }
        } catch {
          // Provider key missing etc. — fall through to "unknown command".
        }
      }
      process.stderr.write(
        colors.red(`unknown command: ${argv.command}`) + '\n' + HELP,
      );
      return 2;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(
      colors.red('fatal: ') + (err instanceof Error ? err.message : String(err)) + '\n',
    );
    process.exit(1);
  },
);
