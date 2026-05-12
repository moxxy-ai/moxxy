import type { ParsedArgv } from '../argv.js';
import { bootSessionWithConfig, hasBoolFlag } from '../argv-helpers.js';
import { colors } from '../colors.js';
import { buildProviderAuthContext } from '../wizard/auth-context.js';
import type { ProviderDef } from '@moxxy/sdk';
import type { Session } from '@moxxy/core';

/**
 * `moxxy login` — generic OAuth driver. Walks the session's provider
 * registry; any provider plugin that declares `auth: { kind: 'oauth', … }`
 * is automatically loggable via `moxxy login <name>`. There is no
 * provider-specific code in this command — the plugin owns the dance.
 */

function buildHelp(session: Session | null): string {
  const oauthLines = session
    ? session.providers
        .list()
        .filter((d) => d.auth?.kind === 'oauth')
        .map((d) => {
          const service = d.auth?.kind === 'oauth' ? d.auth.serviceName : undefined;
          return service
            ? `  moxxy login ${d.name.padEnd(22)} Sign in with ${service}`
            : `  moxxy login ${d.name}`;
        })
    : ['  (no providers loaded — run inside a moxxy project)'];

  return (
    `moxxy login — OAuth sign-in for providers that don't use API keys\n\n` +
    `${oauthLines.join('\n')}\n` +
    `                                    Flags:\n` +
    `                                      --no-browser   force the headless device-code flow\n` +
    `                                                     (auto-selected when stdin is not a TTY)\n` +
    `  moxxy login status [<provider>]   Show currently-stored OAuth credentials (no secrets printed)\n` +
    `  moxxy login logout <provider>     Remove stored OAuth credentials for a provider\n\n` +
    `After a successful login the credentials live in the encrypted vault\n` +
    `(~/.moxxy/vault.json). Set the active provider via moxxy.config.yaml:\n\n` +
    `  provider:\n` +
    `    name: <provider>\n`
  );
}

export async function runLoginCommand(argv: ParsedArgv): Promise<number> {
  const sub = argv.positional[0];

  if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
    // Best-effort: list OAuth providers known to the current install. If
    // boot fails for any reason fall back to a generic help body.
    let session: Session | null = null;
    try {
      const { session: s } = await bootSessionWithConfig(argv, {
        skipKeyPrompt: true,
        skipProviderActivation: true,
        tolerateNoProvider: true,
      });
      session = s;
    } catch {
      // ignore
    }
    process.stdout.write(buildHelp(session));
    return sub ? 0 : 2;
  }

  if (sub === 'status') return await loginStatus(argv);
  if (sub === 'logout') return await loginLogout(argv);

  // Otherwise, treat `sub` as a provider name.
  return await loginProvider(argv, sub);
}

async function loginProvider(argv: ParsedArgv, providerName: string): Promise<number> {
  const { session, vault } = await bootSessionWithConfig(argv, {
    skipKeyPrompt: true,
    skipProviderActivation: true,
    tolerateNoProvider: true,
  });
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
        `Run \`moxxy init\` to store its key in the vault.\n`,
    );
    return 2;
  }

  // Pre-warm the vault — if a passphrase is needed, prompt for it now
  // (synchronously, under cooked TTY) rather than racing the browser/device
  // flow that's about to start.
  await vault.open();

  // Headless mode triggers when:
  //   - stdin isn't a TTY (CI, ssh -T, docker exec without -t), OR
  //   - the user passes `--no-browser` (e.g. running on a remote box and
  //     wanting to complete the flow from their laptop's browser).
  const headless = hasBoolFlag(argv, 'no-browser') || process.stdin.isTTY !== true;
  const ctx = buildProviderAuthContext(vault, { headless });

  try {
    const result = await def.auth.login(ctx);
    const expiresStr =
      result.expiresAt !== undefined
        ? colors.dim(`token expires ${new Date(result.expiresAt).toLocaleString()}`)
        : colors.dim('credentials stored');
    process.stdout.write(
      `${colors.green('✓ Login successful.')} ` +
        `Account: ${colors.bold(result.accountId ?? '(none)')}  ` +
        expiresStr +
        `\n\n` +
        `Set ${colors.cyan(`provider.name: ${providerName}`)} in moxxy.config.yaml to use it.\n`,
    );
    return 0;
  } catch (err) {
    process.stderr.write(
      `${colors.red('✗ Login failed:')} ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }
}

async function loginStatus(argv: ParsedArgv): Promise<number> {
  const { session, vault } = await bootSessionWithConfig(argv, {
    skipKeyPrompt: true,
    skipProviderActivation: true,
    tolerateNoProvider: true,
  });
  await vault.open();
  const ctx = buildProviderAuthContext(vault, { headless: true });
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
        `${colors.bold(def.name)} ${colors.dim('— status not reported by plugin')}\n`,
      );
      continue;
    }
    const status = await auth.status(ctx);
    if (!status) {
      process.stdout.write(
        `${colors.dim(def.name)}: ${colors.yellow('not logged in')}\n` +
          `  Run \`moxxy login ${def.name}\` to sign in.\n`,
      );
      continue;
    }
    const expired = status.expiresAt !== undefined && status.expiresAt < Date.now();
    process.stdout.write(
      `${colors.bold(def.name)}\n` +
        `  account:        ${status.accountId ?? colors.dim('(none)')}\n` +
        (status.expiresAt !== undefined
          ? `  access expires: ${new Date(status.expiresAt).toLocaleString()}` +
            (expired ? ` ${colors.red('(expired — will refresh on next call)')}` : '') +
            '\n'
          : '') +
        (status.vaultKey ? `  vault key:      ${colors.dim(status.vaultKey)}\n` : ''),
    );
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
  const { session, vault } = await bootSessionWithConfig(argv, {
    skipKeyPrompt: true,
    skipProviderActivation: true,
    tolerateNoProvider: true,
  });
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
  const ctx = buildProviderAuthContext(vault, { headless: true });
  const removed = await def.auth.logout(ctx);
  if (removed) {
    process.stdout.write(`${colors.green('✓ Logged out.')} OAuth credentials removed from the vault.\n`);
    return 0;
  }
  process.stdout.write(`${colors.dim(`No stored credentials for ${providerName}.`)}\n`);
  return 0;
}
