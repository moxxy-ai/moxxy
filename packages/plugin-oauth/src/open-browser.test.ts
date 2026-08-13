import { describe, expect, it } from 'vitest';
import { browserOpenCommand } from './open-browser';

// A realistic OAuth authorize URL with shell metacharacters that must remain a
// single argv value on every platform.
const AUTH_URL =
  'https://auth.openai.com/oauth/authorize?client_id=app_x&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&response_type=code&scope=openid+profile&code_challenge=abc123&state=deadbeef';

describe('browserOpenCommand', () => {
  it('macOS uses `open` with the URL as a single arg', () => {
    expect(browserOpenCommand(AUTH_URL, 'darwin')).toEqual({ cmd: 'open', args: [AUTH_URL] });
  });

  it('Linux uses `xdg-open` with the URL as a single arg', () => {
    expect(browserOpenCommand(AUTH_URL, 'linux')).toEqual({ cmd: 'xdg-open', args: [AUTH_URL] });
  });

  it('Windows bypasses the shell and passes the complete URL to Explorer', () => {
    expect(browserOpenCommand(AUTH_URL, 'win32')).toEqual({
      cmd: 'explorer.exe',
      args: [AUTH_URL],
    });
  });

  it('rejects non-web schemes and switch-shaped input before spawning', () => {
    expect(() => browserOpenCommand('file:///tmp/token', 'win32')).toThrow('non-http');
    expect(() => browserOpenCommand('javascript:alert(1)', 'win32')).toThrow('non-http');
    expect(() => browserOpenCommand('/select,C:\\secrets', 'win32')).toThrow();
  });
});
