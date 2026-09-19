import type { ParsedArgv } from '../argv.js';
import { bootSessionWithConfig, hasBoolFlag, helpRequested } from '../argv-helpers.js';
import { closeSession } from '../setup/close-session.js';
import { colors } from '../colors.js';
import { buildProviderAuthContext } from '../wizard/auth-context.js';
import { formatHelp } from './help-format.js';
import type { ProviderDef } from '@moxxy/sdk';
import type { Session } from '@moxxy/core';
import type { VaultStore } from '@moxxy/plugin-vault';
import type { MoxxyConfig } from '@moxxy/config';

/**
 * `moxxy login` — generic OAuth driver. Walks the session's provider
 * registry; any provider plugin that declares `auth: { kind: 'oauth', … }`
 * is automatically loggable via `moxxy login <name>`. There is no
 * provider-specific code in this command — the plugin owns the dance.
 */

function buildHelp(session: Session | null): string {
  const oauthRows: Array<[string, string]> = session
    ? session.providers
        .list()
        .filter((d) => d.auth?.kind === 'oauth')
        .map((d) => {
          const service = d.auth?.kind === 'oauth' ? d.auth.serviceName : undefined;
          return [d.name, service ? `sign in with ${service}` : 'OAuth sign-in'] as [string, string];
        })
    : [['(none)', 'no providers loaded — run inside a moxxy project']];

  return formatHelp({
    title: 'moxxy login',
    tagline: "OAuth sign-in for providers that don't use API keys",
    sections: [
      {
        title: 'PROVIDERS',
        rows: oauthRows.length > 0 ? oauthRows : [['(none)', 'no OAuth-capable providers registered']],
      },
      {
        title: 'COMMANDS',
        rows: [
          ['status [<provider>]', 'show currently-stored OAuth credentials (no secrets printed)'],
          ['logout <provider>', 'remove stored OAuth credentials for a provider'],
        ],
      },
      {
        title: 'FLAGS',
        rows: [
          ['--browser', 'force the loopback/browser flow even without a TTY (opens the browser automatically)'],
          ['--no-browser', 'force the headless device-code flow (auto when no TTY)'],
          ['--stdin-prompts', 'GUI-host mode: relay paste prompts over stdout markers + stdin lines (desktop app)'],
        ],
      },
    ],
    footer: [
      'After a successful login the credentials live in the encrypted vault',
      '(~/.moxxy/vault.json). Set the active provider via moxxy.config.yaml:',
      '',
      '  provider:',
      '    name: <provider>',
    ],
  });
}

export async function runLoginCommand(argv: ParsedArgv): Promise<number> {
  const sub = argv.positional[0];
  const wantsHelp = helpRequested(argv) || sub === 'help' || sub === '--help' || sub === '-h';

  if (!sub || wantsHelp) {
    // Best-effort: list OAuth providers known to the current install. If
    // boot fails for any reason fall back to a generic help body.
    let session: Session | null = null;
    try {
      const { session: s, persistence, audit } = await bootSessionWithConfig(argv, {
        skipKeyPrompt: true,
        skipProviderActivation: true,
        tolerateNoProvider: true,
      });
      session = s;
      // Read the registry for the help body, then tear the throwaway session
      // down so its boot daemons don't keep the process alive.
      try {
        process.stdout.write(buildHelp(session));
      } finally {
        await closeSession(s, persistence, audit);
      }
      return wantsHelp ? 0 : 2;
    } catch {
      // ignore — fall through to a generic help body
    }
    process.stdout.write(buildHelp(session));
    return wantsHelp ? 0 : 2;
  }

  if (sub === 'status') return await loginStatus(argv);
  if (sub === 'logout') return await loginLogout(argv);

  // Otherwise, treat `sub` as a provider name.
  return await loginProvider(argv, sub);
}

function providerAuthConfig(
  config: MoxxyConfig,
  providerName: string,
): Readonly<Record<string, unknown>> {
  return config.plugins?.provider?.items?.[providerName]?.config ?? {};
}

async function loginProvider(argv: ParsedArgv, providerName: string): Promise<number> {
  const { session, vault, config, persistence, audit } = await bootSessionWithConfig(argv, {
    skipKeyPrompt: true,
    skipProviderActivation: true,
    tolerateNoProvider: true,
  });
  try {
    return await runLoginProvider(argv, providerName, session, vault, providerAuthConfig(config, providerName));
  } finally {
    await closeSession(session, persistence, audit);
  }
}

export async function runLoginProvider(
  argv: ParsedArgv,
  providerName: string,
  session: Session,
  vault: VaultStore,
  providerConfig: Readonly<Record<string, unknown>> = {},
): Promise<number> {
  const def = session.providers.list().find((d) => d.name === providerName);
  if (!def) {
    process.stderr.write(
      `${colors.red(`unknown provider: ${providerName}`)}\n${buildHelp(session)}`,
    );
    return 2;
  }
  if (def.auth?.kind !== 'oauth') {
    process.stderr.write(
      `${colors.red(`${providerName} uses API-key auth — no \`moxxy login\` flow.`)}\n` +
        `Run \`moxxy onboard\` to store its key in the vault.\n`,
    );
    return 2;
  }

  // Pre-warm the vault — if a passphrase is needed, prompt for it now
  // (synchronously, under cooked TTY) rather than racing the browser/device
  // flow that's about to start.
  await vault.open();

  // `--stdin-prompts` is the desktop GUI's mode: the provider's prompts are
  // relayed to the host over the pipe (markers on stdout, answers as stdin
  // lines) so out-of-band paste flows work without a TTY.
  // It implies an interactive (non-headless) flow — the host IS the terminal.
  const stdinPrompts = hasBoolFlag(argv, 'stdin-prompts');

  // Headless (device-code) mode triggers when:
  //   - the user passes `--no-browser` (e.g. running on a remote box and
  //     wanting to complete the flow from their laptop's browser), OR
  //   - stdin isn't a TTY (CI, ssh -T, docker exec without -t) AND the
  //     caller didn't force the browser flow with `--browser` / drive it over
  //     `--stdin-prompts`.
  // `--browser` lets a standalone non-TTY caller retain process-local browser
  // ownership. Desktop uses `--stdin-prompts` instead: it receives the loopback
  // URL as a marker and opens it through Electron main.
  const headless =
    !stdinPrompts &&
    (hasBoolFlag(argv, 'no-browser') ||
      (!hasBoolFlag(argv, 'browser') && process.stdin.isTTY !== true));
  const ctx = buildProviderAuthContext(vault, {
    headless,
    providerConfig,
    ...(stdinPrompts ? { promptMode: 'stdin' as const } : {}),
  });

  try {
    const result = await def.auth.login(ctx);
    session.requirements.setRuntime(`auth:provider:${providerName}`, 'ready');
    const expires =
      result.expiresAt !== undefined
        ? `token expires ${new Date(result.expiresAt).toLocaleString()}`
        : 'sign-in ready';
    const rows: Array<[string, string]> = [
      ['account', result.accountId ?? '(none)'],
      ['auth', expires],
    ];
    const col = Math.max(...rows.map(([k]) => k.length));
    process.stdout.write(colors.bold('logged in') + '\n');
    for (const [k, v] of rows) {
      process.stdout.write(`  ${colors.bold(k.padEnd(col))}  ${colors.dim(v)}\n`);
    }
    process.stdout.write(
      '\n' + colors.dim(`Set provider.name: ${providerName} in moxxy.config.yaml to use it.`) + '\n',
    );
    return 0;
  } catch (err) {
    process.stderr.write(
      `${colors.red('login failed:')} ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }
}

async function loginStatus(argv: ParsedArgv): Promise<number> {
  const { session, vault, config, persistence, audit } = await bootSessionWithConfig(argv, {
    skipKeyPrompt: true,
    skipProviderActivation: true,
    tolerateNoProvider: true,
  });
  try {
    return await runLoginStatus(argv, session, vault, config);
  } finally {
    await closeSession(session, persistence, audit);
  }
}

export async function runLoginStatus(
  argv: ParsedArgv,
  session: Session,
  vault: VaultStore,
  config: MoxxyConfig,
): Promise<number> {
  await vault.open();
  const filter = argv.positional[1];

  const oauthProviders = session.providers
    .list()
    .filter((d): d is ProviderDef & { auth: { kind: 'oauth' } & ProviderDef['auth'] } =>
      d.auth?.kind === 'oauth',
    )
    .filter((d) => !filter || d.name === filter);

  if (oauthProviders.length === 0) {
    if (filter) {
      process.stderr.write(`${colors.red(`unknown OAuth provider: ${filter}`)}\n`);
      return 2;
    }
    process.stdout.write(`${colors.dim('no OAuth-capable providers are registered.')}\n`);
    return 0;
  }

  for (const def of oauthProviders) {
    const auth = def.auth!;
    if (auth.kind !== 'oauth') continue;
    if (!auth.status) {
      process.stdout.write(
        `${colors.bold(def.name)}  ${colors.dim('status not reported by plugin')}\n`,
      );
      continue;
    }
    const ctx = buildProviderAuthContext(vault, {
      headless: true,
      providerConfig: providerAuthConfig(config, def.name),
    });
    const status = await auth.status(ctx);
    if (status?.authState && status.authState !== 'signed-in') {
      process.stdout.write(
        `${colors.bold(def.name)}  ${colors.dim(status.authState)}\n` +
          `${' '.repeat(def.name.length)}  ${colors.dim(status.message ?? 'authentication is not ready')}\n`,
      );
      continue;
    }
    if (!status) {
      process.stdout.write(
        `${colors.bold(def.name)}  ${colors.dim('not logged in')}\n` +
          `${' '.repeat(def.name.length)}  ${colors.dim('run `moxxy login ' + def.name + '` to sign in')}\n`,
      );
      continue;
    }
    const expired = status.expiresAt !== undefined && status.expiresAt < Date.now();
    const rows: Array<[string, string]> = [['account', status.accountId ?? '(none)']];
    if (status.expiresAt !== undefined) {
      rows.push([
        'expires',
        `${new Date(status.expiresAt).toLocaleString()}${expired ? ' (expired — will refresh on next call)' : ''}`,
      ]);
    }
    if (status.vaultKey) rows.push(['vault', status.vaultKey]);
    const col = Math.max(...rows.map(([k]) => k.length));
    process.stdout.write(colors.bold(def.name) + '\n');
    for (const [k, v] of rows) {
      const isExpired = k === 'expires' && expired;
      process.stdout.write(
        `  ${colors.bold(k.padEnd(col))}  ${isExpired ? colors.red(v) : colors.dim(v)}\n`,
      );
    }
  }
  return 0;
}

async function loginLogout(argv: ParsedArgv): Promise<number> {
  const providerName = argv.positional[1];
  if (!providerName) {
    process.stderr.write(
      `${colors.red(`logout: pass a provider name`)}\n  usage: moxxy login logout <provider>\n`,
    );
    return 2;
  }
  const { session, vault, config, persistence, audit } = await bootSessionWithConfig(argv, {
    skipKeyPrompt: true,
    skipProviderActivation: true,
    tolerateNoProvider: true,
  });
  try {
    return await runLoginLogout(providerName, session, vault, providerAuthConfig(config, providerName));
  } finally {
    await closeSession(session, persistence, audit);
  }
}

export async function runLoginLogout(
  providerName: string,
  session: Session,
  vault: VaultStore,
  providerConfig: Readonly<Record<string, unknown>> = {},
): Promise<number> {
  await vault.open();
  const def = session.providers.list().find((d) => d.name === providerName);
  if (!def || def.auth?.kind !== 'oauth') {
    process.stderr.write(`${colors.red(`unknown OAuth provider: ${providerName}`)}\n`);
    return 2;
  }
  if (!def.auth.logout) {
    process.stderr.write(
      `${colors.dim(`${providerName}: plugin does not expose a logout flow.`)}\n`,
    );
    return 1;
  }
  const ctx = buildProviderAuthContext(vault, { headless: true, providerConfig });
  const loggedOut = await def.auth.logout(ctx);
  if (loggedOut) {
    session.requirements.clearRuntime(`auth:provider:${providerName}`);
    process.stdout.write(
      `${colors.bold('logged out')}  ${colors.dim(`${providerName} sign-out completed`)}\n`,
    );
    return 0;
  }
  process.stdout.write(colors.dim(`${providerName} was not signed in; no sign-out was needed`) + '\n');
  return 0;
}
