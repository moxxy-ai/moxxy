import { describe, expect, it } from 'vitest';
import { browserOpenCommand } from './open-browser';

// A realistic OAuth authorize URL: many `&`-separated params, which cmd.exe
// treats as command separators unless the whole URL is quoted.
const AUTH_URL =
  'https://auth.openai.com/oauth/authorize?client_id=app_x&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&response_type=code&scope=openid+profile&code_challenge=abc123&state=deadbeef';

describe('browserOpenCommand', () => {
  it('macOS uses `open` with the URL as a single arg', () => {
    expect(browserOpenCommand(AUTH_URL, 'darwin')).toEqual({ cmd: 'open', args: [AUTH_URL] });
  });

  it('Linux uses `xdg-open` with the URL as a single arg', () => {
    expect(browserOpenCommand(AUTH_URL, 'linux')).toEqual({ cmd: 'xdg-open', args: [AUTH_URL] });
  });

  it('Windows DOUBLE-QUOTES the URL so cmd.exe does not split it on `&`', () => {
    const { cmd, args, verbatim } = browserOpenCommand(AUTH_URL, 'win32');
    expect(cmd).toMatch(/cmd(\.exe)?$/i);
    expect(verbatim).toBe(true);
    expect(args.slice(0, 3)).toEqual(['/c', 'start', '""']);
    // The whole URL — every `&` included — is inside one double-quoted token.
    expect(args[3]).toBe(`"${AUTH_URL}"`);
    // Sanity: the quoted arg still contains all the params after the first `&`.
    expect(args[3]).toContain('redirect_uri');
    expect(args[3]).toContain('code_challenge');
    expect(args[3]).toContain('state=deadbeef');
  });
});
