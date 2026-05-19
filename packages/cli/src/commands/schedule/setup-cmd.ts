import * as path from 'node:path';
import * as os from 'node:os';
import { PermissionEngine } from '@moxxy/core';
import type { ParsedArgv } from '../../argv.js';
import { colors } from '../../colors.js';
import { setupSessionWithConfig } from '../../setup.js';
import { installAndStartDaemon } from '../schedule-daemon-svc.js';

const DEFAULT_HEADLESS_ALLOW_TOOLS = ['telegram_send_message', 'web_fetch'];

const tag = (ok: boolean): string => (ok ? colors.bold('ok  ') : colors.red('fail'));

export async function runScheduleSetup(argv: ParsedArgv): Promise<number> {
  // Tools to pre-allow. Default covers the two most common delivery
  // shapes (Telegram push + web_fetch for scraping). Users override
  // with --allow tool1,tool2 — passing --allow '' clears the list so
  // no permissions are touched.
  const allowFlag = argv.flags.allow;
  const tools =
    typeof allowFlag === 'string'
      ? allowFlag.split(',').map((s) => s.trim()).filter(Boolean)
      : DEFAULT_HEADLESS_ALLOW_TOOLS;

  const skipDaemon = argv.flags['no-daemon'] === true;

  process.stdout.write(colors.bold('moxxy scheduler setup') + '\n\n');

  await stepAllowTools(tools);
  await stepInstallDaemon(skipDaemon);
  if (tools.includes('telegram_send_message')) await stepTelegramStatus();

  process.stdout.write(
    '\n' +
      colors.bold('NEXT') + '\n' +
      `  ${colors.dim('· create a schedule from a moxxy chat ("send me HN at 9am via telegram")')}\n` +
      `  ${colors.dim('· moxxy schedule list / moxxy schedule run <id>')}\n`,
  );
  return 0;
}

async function stepAllowTools(tools: ReadonlyArray<string>): Promise<void> {
  if (tools.length === 0) {
    process.stdout.write(`${colors.bold('skip')}  ${colors.dim('tool allowlist (--allow="")')}\n`);
    return;
  }
  const policyPath = path.join(os.homedir(), '.moxxy', 'permissions.json');
  const engine = await PermissionEngine.load(policyPath);
  const before = engine.policySnapshot;
  const existingAllowNames = new Set(before.allow.map((r) => r.name));
  const added: string[] = [];
  const skipped: string[] = [];
  for (const t of tools) {
    if (existingAllowNames.has(t)) {
      skipped.push(t);
      continue;
    }
    await engine.addAllow({ name: t, reason: 'moxxy schedule setup — headless fire' });
    added.push(t);
  }
  process.stdout.write(
    `${tag(true)}  ${colors.bold('allow')}  ` +
      (added.length > 0 ? colors.bold(added.join(', ')) : colors.dim('(none new)')) +
      (skipped.length > 0 ? colors.dim(`  [already allowed: ${skipped.join(', ')}]`) : '') +
      '\n' +
      `        ${colors.dim('→ ' + policyPath)}\n`,
  );
}

async function stepInstallDaemon(skipDaemon: boolean): Promise<void> {
  if (skipDaemon) {
    process.stdout.write(`${colors.bold('skip')}  ${colors.dim('daemon install (--no-daemon)')}\n`);
    return;
  }
  const result = await installAndStartDaemon();
  process.stdout.write(`${tag(result.ok)}  ${colors.bold('daemon')}  ${colors.dim(result.message)}\n`);
  if (result.ok) {
    process.stdout.write(`        ${colors.dim('→ logs: ' + result.logPath)}\n`);
  } else {
    process.stdout.write(
      `        ${colors.dim('→ see `moxxy schedule daemon --status` after fixing the error above')}\n`,
    );
  }
}

async function stepTelegramStatus(): Promise<void> {
  try {
    const { vault } = await setupSessionWithConfig({
      cwd: process.cwd(),
      skipKeyPrompt: true,
      tolerateNoProvider: true,
    });
    const hasToken = await vault.has('telegram_bot_token');
    const chatRaw = await vault.get('telegram_authorized_chat_id');
    const hasChat = !!chatRaw;
    if (hasToken && hasChat) {
      process.stdout.write(
        `${tag(true)}  ${colors.bold('telegram')}  ${colors.dim('token + paired chat ' + Number(chatRaw))}\n`,
      );
    } else {
      const missing: string[] = [];
      if (!hasToken) missing.push('bot token');
      if (!hasChat) missing.push('paired chat');
      process.stdout.write(
        `${tag(false)}  ${colors.bold('telegram')}  ${colors.dim('missing ' + missing.join(' + '))}\n` +
          `          ${colors.dim('→ run `moxxy telegram` to pair')}\n`,
      );
    }
  } catch (err) {
    process.stdout.write(
      `${tag(false)}  ${colors.bold('telegram')}  ${colors.dim('check failed: ' + (err instanceof Error ? err.message : String(err)))}\n`,
    );
  }
}
