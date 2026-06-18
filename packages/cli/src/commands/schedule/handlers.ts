import { isValidCron, runSchedule } from '@moxxy/plugin-scheduler';
import type { ScheduleStore } from '@moxxy/plugin-scheduler';
import type { ParsedArgv } from '../../argv.js';
import { colors } from '../../colors.js';
import { setupSessionWithConfig } from '../../setup.js';
import { fmtNext, flag } from './format.js';

export async function listSchedules(store: ScheduleStore): Promise<number> {
  const all = await store.list();
  if (all.length === 0) {
    process.stdout.write(colors.dim('(no schedules — add one with `moxxy schedule add` or a tool call)\n'));
    return 0;
  }
  const nameCol = Math.max(8, ...all.map((s) => s.name.length));
  for (const s of all) {
    const status = s.enabled ? 'on' : 'off';
    const src = s.source === 'skill' ? `skill:${s.skillName}` : 'manual';
    const trig = s.cron ? `cron "${s.cron}"` : `at ${new Date(s.runAt!).toISOString()}`;
    process.stdout.write(
      `${colors.bold(s.name.padEnd(nameCol))}  ${colors.dim(status)}  ${colors.dim(trig)}\n` +
        `${' '.repeat(nameCol + 2)}${colors.dim(`id ${s.id} · ${src} · next ${fmtNext(s)}`)}\n` +
        `${' '.repeat(nameCol + 2)}${colors.dim(s.prompt.slice(0, 80).replace(/\n/g, ' ') + (s.prompt.length > 80 ? '…' : ''))}\n`,
    );
  }
  return 0;
}

export async function addSchedule(store: ScheduleStore, argv: ParsedArgv): Promise<number> {
  const name = argv.positional[1];
  const prompt = flag(argv, 'prompt');
  const cron = flag(argv, 'cron');
  const at = flag(argv, 'at');
  if (!name || !prompt || (!cron && !at)) {
    process.stderr.write(
      colors.red('missing required args') +
        '\n  usage: moxxy schedule add <name> --cron "<expr>" --prompt "<text>"\n' +
        '         moxxy schedule add <name> --at "<iso>" --prompt "<text>"\n',
    );
    return 2;
  }
  if (cron && !isValidCron(cron)) {
    process.stderr.write(colors.red(`invalid cron expression: "${cron}"`) + '\n');
    return 2;
  }
  const runAt = at ? Date.parse(at) : undefined;
  if (at && (runAt === undefined || Number.isNaN(runAt))) {
    process.stderr.write(colors.red(`invalid --at timestamp: "${at}"`) + '\n');
    return 2;
  }
  const created = await store.create({
    name,
    prompt,
    ...(cron ? { cron } : {}),
    ...(runAt !== undefined ? { runAt } : {}),
    ...(flag(argv, 'timezone') ? { timeZone: flag(argv, 'timezone')! } : {}),
    ...(flag(argv, 'channel') ? { channel: flag(argv, 'channel')! } : {}),
    ...(flag(argv, 'model') ? { model: flag(argv, 'model')! } : {}),
  });
  process.stdout.write(
    `${colors.bold('created')}  ${colors.bold(created.name)}  ${colors.dim(created.id)}\n` +
      `         ${colors.dim('next: ' + fmtNext(created))}\n`,
  );
  return 0;
}

export async function removeSchedule(store: ScheduleStore, argv: ParsedArgv): Promise<number> {
  const id = argv.positional[1];
  if (!id) {
    process.stderr.write(colors.red('missing id') + '\n  usage: moxxy schedule remove <id>\n');
    return 2;
  }
  const ok = await store.delete(id);
  process.stdout.write(
    ok ? `${colors.bold('removed')}  ${id}\n` : colors.dim(`no schedule with id ${id}`) + '\n',
  );
  return ok ? 0 : 1;
}

export async function toggleSchedule(
  store: ScheduleStore,
  argv: ParsedArgv,
  sub: 'enable' | 'disable',
): Promise<number> {
  const id = argv.positional[1];
  if (!id) {
    process.stderr.write(`${colors.red('missing id')}\n  usage: moxxy schedule ${sub} <id>\n`);
    return 2;
  }
  const updated = await store.update(id, { enabled: sub === 'enable' });
  if (!updated) {
    process.stderr.write(colors.dim(`no schedule with id ${id}`) + '\n');
    return 1;
  }
  process.stdout.write(`${colors.bold(sub === 'enable' ? 'enabled' : 'disabled')}  ${updated.name}\n`);
  return 0;
}

export async function runScheduleNow(argv: ParsedArgv): Promise<number> {
  const id = argv.positional[1];
  if (!id) {
    process.stderr.write(colors.red('missing id') + '\n  usage: moxxy schedule run <id>\n');
    return 2;
  }
  // `run` needs a real (provider-activated) session to dispatch the prompt,
  // but it must NOT start the init-time daemons: the scheduler poller would
  // independently fire a due schedule mid-`run` (double-dispatch), and the
  // webhooks listener would bind its port for an abandoned session. So skip
  // init hooks (provider activation runs before that gate) and close the
  // session in a finally so onShutdown hooks (vault flush, etc.) fire.
  const { session, scheduler: full } = await setupSessionWithConfig({
    cwd: process.cwd(),
    skipInitHooks: true,
  });
  try {
    const entry = await full.store.get(id);
    if (!entry) {
      process.stderr.write(colors.dim(`no schedule with id ${id}`) + '\n');
      return 1;
    }
    process.stdout.write(`${colors.bold('firing')}   ${entry.name}…\n`);
    const outcome = await runSchedule(entry, {
      runPrompt: async ({ prompt, model }) => {
        const { runTurn } = await import('@moxxy/core');
        let text = '';
        for await (const event of runTurn(session, prompt, model ? { model } : {})) {
          if (event.type === 'assistant_message') text = event.content;
        }
        return { text };
      },
    }, full.store);
    const tag = outcome.ok ? colors.bold('done') : colors.red('fail');
    process.stdout.write(
      `${tag}     ${colors.dim('inbox: ' + (outcome.inboxPath ?? '(none)'))}\n` +
        (outcome.error ? `         ${colors.red(outcome.error)}\n` : '') +
        (outcome.text ? `         ${colors.dim(outcome.text.slice(0, 400))}\n` : ''),
    );
    return outcome.ok ? 0 : 1;
  } finally {
    await session.close('schedule-run').catch(() => undefined);
  }
}
