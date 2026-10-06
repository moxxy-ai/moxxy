import type { EventLogReader, MoxxyEvent } from '@moxxy/sdk';
import { describe, expect, it } from 'vitest';
import { ALLOW_SITE_TOOL, siteAllows, siteOf, siteRefusal, sitesFromLog } from './site-access.js';

function memoryLog(events: MoxxyEvent[]): EventLogReader {
  return {
    get length() {
      return events.length;
    },
    at: (index) => events[index],
    slice: (from, to) => events.slice(from, to),
    ofType: ((type: MoxxyEvent['type']) => events.filter((event) => event.type === type)) as EventLogReader['ofType'],
    byTurn: (turnId) => events.filter((event) => event.turnId === turnId),
    toJSON: () => events,
  };
}

let seq = 0;
const base = () => ({ id: `e${seq}`, seq: seq++, ts: 0, sessionId: 's', turnId: 't1', source: 'system' }) as const;

const record = (callId: string, output: unknown, opts: { name?: string; approved?: boolean; ok?: boolean } = {}) =>
  [
    { ...base(), type: 'tool_call_requested', callId, name: opts.name ?? ALLOW_SITE_TOOL, input: {} },
    opts.approved === false
      ? { ...base(), type: 'tool_call_denied', callId, decidedBy: 'resolver', reason: 'no' }
      : { ...base(), type: 'tool_call_approved', callId, decidedBy: 'resolver', mode: 'allow' },
    { ...base(), type: 'tool_result', callId, ok: opts.ok ?? true, output },
  ] as MoxxyEvent[];

const grant = (site: string) => ({ kind: 'browser_site', site });

describe('siteOf', () => {
  it.each([
    ['canva.com', 'canva.com'],
    ['https://www.Canva.com./design/abc', 'canva.com'],
    ['*.canva.com', 'canva.com'],
    ['https://*.canva.com', 'canva.com'],
    ['app.example.org', 'app.example.org'],
    ['https://bücher.example', 'xn--bcher-kva.example'],
    ['localhost:3000', 'localhost'],
    ['http://[::1]:5173', '[::1]'],
    ['http://192.168.1.10/admin', '192.168.1.10'],
  ])('%s is the site %s', (input, site) => {
    expect(siteOf(input)).toBe(site);
  });

  it.each(['', '   ', 'about:blank', 'file:///etc/passwd', 'data:text/html,hi', 'com', 'javascript:alert(1)'])(
    'has no site for %j',
    (input) => {
      expect(siteOf(input)).toBeNull();
    },
  );
});

describe('siteAllows', () => {
  it('covers the site itself, its www and its subdomains', () => {
    expect(siteAllows(['canva.com'], 'https://canva.com/')).toBe(true);
    expect(siteAllows(['canva.com'], 'https://www.canva.com/design')).toBe(true);
    expect(siteAllows(['canva.com'], 'https://static.canva.com/x.png')).toBe(true);
  });

  it('does not cover a parent, a sibling or a look-alike', () => {
    expect(siteAllows(['app.canva.com'], 'https://canva.com/')).toBe(false);
    expect(siteAllows(['app.canva.com'], 'https://www.canva.com/')).toBe(false);
    expect(siteAllows(['canva.com'], 'https://evilcanva.com/')).toBe(false);
    expect(siteAllows(['canva.com'], 'https://canva.com.evil.net/')).toBe(false);
  });

  it('matches an address only exactly', () => {
    expect(siteAllows(['192.168.1.10'], 'http://192.168.1.10:8080/')).toBe(true);
    expect(siteAllows(['1.10'], 'http://192.168.1.10/')).toBe(false);
  });

  it('covers nothing that is not a web page', () => {
    expect(siteAllows(['canva.com'], 'about:blank')).toBe(false);
    expect(siteAllows([], 'https://canva.com/')).toBe(false);
  });
});

describe('sitesFromLog', () => {
  it('collects the sites the user approved, in order and once each', () => {
    const log = memoryLog([
      ...record('c1', grant('canva.com')),
      ...record('c2', grant('github.com')),
      ...record('c3', grant('canva.com')),
    ]);

    expect(sitesFromLog(log)).toEqual(['canva.com', 'github.com']);
  });

  it('ignores a denied request, a failed one, another tool and an output that is not a grant', () => {
    const log = memoryLog([
      ...record('c1', grant('denied.com'), { approved: false }),
      ...record('c2', grant('failed.com'), { ok: false }),
      ...record('c3', grant('other.com'), { name: 'browser_click' }),
      ...record('c4', { kind: 'browser_site', site: 'extra.com', also: true }),
      ...record('c5', { kind: 'computer_access', site: 'wrong.com' }),
    ]);

    expect(sitesFromLog(log)).toEqual([]);
  });
});

describe('siteRefusal', () => {
  it('names the site and the tool that asks for it', () => {
    const message = siteRefusal('https://www.canva.com/design');

    expect(message).toContain('canva.com');
    expect(message).toContain(ALLOW_SITE_TOOL);
    expect(message).toMatch(/nothing was done/);
  });

  it('says when the tab is not on a web page at all', () => {
    expect(siteRefusal('about:blank')).toMatch(/not showing a web page/);
  });
});
