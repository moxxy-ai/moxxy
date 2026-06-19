import { describe, expect, it } from 'vitest';

import { renderPlist } from './launchd.js';
import { renderUnit } from './systemd.js';
import type { InstallContext, ServiceSpec } from './common.js';

const ctx: InstallContext = {
  node: '/usr/bin/node',
  cli: '/opt/moxxy/cli.js',
  log: '/home/u/.moxxy/services/relay.log',
  home: '/home/u',
};

describe('renderPlist (launchd)', () => {
  it('emits node + cli + execArgs as ProgramArguments strings and the standard env block', () => {
    const spec: ServiceSpec = {
      id: 'relay',
      description: 'relay daemon',
      execArgs: ['serve', '--port', '8080'],
      env: { TOKEN: 'abc' },
    };
    const out = renderPlist(spec, ctx);
    expect(out).toContain('<string>com.moxxy.relay</string>');
    expect(out).toContain('<string>/usr/bin/node</string>');
    expect(out).toContain('<string>/opt/moxxy/cli.js</string>');
    expect(out).toContain('<string>serve</string>');
    expect(out).toContain('<string>--port</string>');
    expect(out).toContain('<string>8080</string>');
    // PATH is always injected first, then user env entries.
    expect(out).toContain('<key>PATH</key>');
    expect(out).toContain('<key>TOKEN</key>\n    <string>abc</string>');
    expect(out).toContain('<string>/home/u</string>'); // WorkingDirectory
  });

  it('XML-escapes &, <, >, and " in args and env values', () => {
    const spec: ServiceSpec = {
      id: 'x',
      description: 'd',
      execArgs: ['--flag=a&b<c>d"e'],
      env: { K: 'v&"<>' },
    };
    const out = renderPlist(spec, ctx);
    expect(out).toContain('<string>--flag=a&amp;b&lt;c&gt;d&quot;e</string>');
    expect(out).toContain('<string>v&amp;&quot;&lt;&gt;</string>');
    // No raw unescaped metacharacter leaked into the arg payload.
    expect(out).not.toContain('a&b<c>d"e');
  });

  it("also escapes single quotes (&apos;) so the helper is safe in attribute contexts", () => {
    const spec: ServiceSpec = {
      id: 'q',
      description: 'd',
      execArgs: ["--name=o'brien"],
      env: { K: "it's" },
    };
    const out = renderPlist(spec, ctx);
    expect(out).toContain('<string>--name=o&apos;brien</string>');
    expect(out).toContain('<string>it&apos;s</string>');
    expect(out).not.toContain("o'brien");
  });
});

describe('renderUnit (systemd)', () => {
  it('builds ExecStart from node + cli + execArgs and carries Description + env lines', () => {
    const spec: ServiceSpec = {
      id: 'relay',
      description: 'relay daemon',
      execArgs: ['serve', '--port', '8080'],
      env: { TOKEN: 'abc', LEVEL: 'info' },
    };
    const out = renderUnit(spec, ctx);
    expect(out).toContain('Description=relay daemon');
    expect(out).toContain('ExecStart=/usr/bin/node /opt/moxxy/cli.js serve --port 8080');
    expect(out).toContain('WorkingDirectory=/home/u');
    expect(out).toContain('Environment=TOKEN=abc');
    expect(out).toContain('Environment=LEVEL=info');
  });

  it('quotes only ExecStart args that contain whitespace or quotes', () => {
    const spec: ServiceSpec = {
      id: 'x',
      description: 'd',
      execArgs: ['plain', 'two words', 'has"quote'],
    };
    const out = renderUnit(spec, ctx);
    expect(out).toContain('plain "two words" "has\\"quote"');
  });

  it('quotes Environment= values containing whitespace/quotes/backslashes', () => {
    const spec: ServiceSpec = {
      id: 'x',
      description: 'd',
      execArgs: ['run'],
      env: { SIMPLE: 'abc', SPACED: 'a b', QUOTED: 'a"b', PATHISH: 'c:\\x', NL: 'a\nb' },
    };
    const out = renderUnit(spec, ctx);
    // Plain value stays a single bare directive.
    expect(out).toContain('Environment=SIMPLE=abc');
    // Space, quote, backslash get a single quoted directive (not split).
    expect(out).toContain('Environment=SPACED="a b"');
    expect(out).toContain('Environment=QUOTED="a\\"b"');
    expect(out).toContain('Environment=PATHISH="c:\\\\x"');
    // A newline collapses to a space within one line — never a broken directive.
    expect(out).toContain('Environment=NL="a b"');
    // No directive ever spans two lines.
    expect(out).not.toMatch(/Environment=NL=a\nb/);
  });
});
