import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { TerminalTabs, type TerminalTabEvent } from './terminal-tabs';

/**
 * Real shells: the person's own terminal tabs of a project, owned by the app
 * (not by a chat's runner), and what closing one stops.
 */
const events: TerminalTabEvent[] = [];
let tabs: TerminalTabs;

function make(): TerminalTabs {
  tabs = new TerminalTabs({ emit: (event) => events.push(event) });
  return tabs;
}

afterEach(async () => {
  await tabs?.closeAll();
  events.length = 0;
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(check: () => boolean, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
}

function output(tabId: string): string {
  return events.flatMap((e) => (e.type === 'data' && e.tabId === tabId ? [e.data] : [])).join('');
}

/**
 * A node server cut loose the way `(nohup npx vite &)` leaves it: its parent
 * shell exits at once, so it is no child of the tab's shell. A node process,
 * as a dev server is: macOS hides the environment of its own system binaries
 * (`/bin/sleep`). No `!` in what is typed: an interactive shell expands it.
 */
function loose(mark: string, tag = 'loose'): string {
  return `(nohup '${process.execPath}' -e 'setInterval(()=>{},1e6)' moxxy-tab-${mark} >/dev/null 2>&1 &); ${found(`moxxy-tab-${mark}`, tag)}`;
}

/** Prints `tag:<pid>` once a process matching `pattern` runs: a loaded machine starts it late. */
function found(pattern: string, tag: string): string {
  return `p=; while [ -z "$p" ]; do p=$(pgrep -n -f ${pattern}); done; echo ${tag}:$p`;
}

/** Types `command` into a tab and reads back the pid it prints after `tag:`. */
async function pidFrom(tabId: string, command: string, tag: string): Promise<number> {
  tabs.input(tabId, `${command}\r`);
  const re = new RegExp(`${tag}:(\\d+)`);
  await until(() => re.test(output(tabId)));
  const match = re.exec(output(tabId));
  if (!match) throw new Error(`no pid for ${tag} in: ${output(tabId)}`);
  return Number(match[1]);
}

describe.skipIf(process.platform === 'win32')('TerminalTabs', { timeout: 30_000 }, () => {
  it("names a project's tabs in order and keeps each project's apart", async () => {
    make();
    const first = await tabs.open('desk-a', os.tmpdir());
    const second = await tabs.open('desk-a', os.tmpdir());
    await tabs.open('desk-b', os.tmpdir());

    expect(tabs.list('desk-a')).toEqual([
      { id: first.id, title: 'Terminal 1' },
      { id: second.id, title: 'Terminal 2' },
    ]);
    expect(tabs.list('desk-b').map((t) => t.title)).toEqual(['Terminal 1']);
    expect(events).toContainEqual({ type: 'changed', projectId: 'desk-a' });
  });

  it('runs what is typed in the shell and replays it to a viewer that attaches later', async () => {
    make();
    const tab = await tabs.open('desk-a', os.tmpdir());
    tabs.input(tab.id, 'echo "sum:$((40+2))"\r');
    await until(() => output(tab.id).includes('sum:42'));

    expect(output(tab.id)).toContain('sum:42');
    expect(tabs.attach(tab.id)?.data).toContain('sum:42');
  });

  it('closing a tab stops everything started from it, a detached server too, and nothing of another tab', async () => {
    make();
    const closing = await tabs.open('desk-a', os.tmpdir());
    const other = await tabs.open('desk-a', os.tmpdir());
    const job = await pidFrom(closing.id, 'sleep 971 & echo job:$!', 'job');
    const detached = await pidFrom(closing.id, loose('972'), 'loose');
    const neighbour = await pidFrom(other.id, 'sleep 973 & echo near:$!', 'near');

    await tabs.close(closing.id);
    await until(() => !alive(job) && !alive(detached));

    expect(alive(job)).toBe(false);
    expect(alive(detached)).toBe(false);
    expect(alive(neighbour)).toBe(true);
    expect(tabs.list('desk-a').map((t) => t.id)).toEqual([other.id]);
  });

  it("closing a tab stops a system program detached in it, whose environment macOS hides", async () => {
    make();
    const tab = await tabs.open('desk-a', os.tmpdir());
    const sleeper = await pidFrom(tab.id, `(nohup sleep 976 >/dev/null 2>&1 &); ${found('"sleep 976"', 'nap')}`, 'nap');

    await tabs.close(tab.id);
    await until(() => !alive(sleeper));

    expect(alive(sleeper)).toBe(false);
  });

  it('quitting stops every tab of every project', async () => {
    make();
    const a = await tabs.open('desk-a', os.tmpdir());
    const b = await tabs.open('desk-b', os.tmpdir());
    const pa = await pidFrom(a.id, loose('974', 'qa'), 'qa');
    const pb = await pidFrom(b.id, 'sleep 975 & echo qb:$!', 'qb');

    await tabs.closeAll();
    await until(() => !alive(pa) && !alive(pb));

    expect(alive(pa)).toBe(false);
    expect(alive(pb)).toBe(false);
    expect(tabs.list('desk-a')).toEqual([]);
  });

  it('drops a tab whose shell exited by itself and says so', async () => {
    make();
    const tab = await tabs.open('desk-a', os.tmpdir());
    tabs.input(tab.id, 'exit\r');
    await until(() => tabs.list('desk-a').length === 0);

    expect(tabs.list('desk-a')).toEqual([]);
    expect(events).toContainEqual(expect.objectContaining({ type: 'exit', tabId: tab.id }));
    expect(tabs.attach(tab.id)).toBeNull();
  });
});
