import { spawn } from 'node:child_process';

/**
 * Open a URL in the user's default browser. Platform-specific:
 *   macOS  → `open <url>`
 *   Linux  → `xdg-open <url>`
 *   Win32  → `cmd /c start "" "<url>"` (the URL DOUBLE-QUOTED + args passed
 *           verbatim — see {@link browserOpenCommand})
 *
 * Returns once the helper process is spawned — it does NOT wait for the
 * browser itself, since the user's flow continues asynchronously via
 * the OAuth callback. Failures fall back to returning the URL string
 * so the caller can print it for the user to paste manually.
 */
export async function openInBrowser(url: string): Promise<void> {
  const { cmd, args, verbatim } = browserOpenCommand(url);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: 'ignore',
      detached: true,
      // Windows only: keep cmd.exe from re-quoting our already-quoted URL,
      // which would otherwise break the `&` escaping (see below).
      ...(verbatim ? { windowsVerbatimArguments: true } : {}),
    });
    child.once('error', reject);
    // `unref` so a misbehaving opener process can't keep the moxxy
    // process alive past its own lifetime.
    child.unref();
    // Resolve after spawn — we never want to wait for the browser to
    // close. A 50ms tick is enough to surface spawn-time errors.
    setTimeout(resolve, 50);
  });
}

/**
 * Resolve the platform's "open this URL in the default browser" command.
 * Exported + `platform`-parameterized so the Windows quoting can be unit-tested
 * without actually spawning a browser.
 *
 * Windows is the tricky one: `&` (and `|`, `<`, `>`, `^`) in a URL are cmd.exe
 * command separators. `cmd /c start "" http://a?x=1&y=2` truncates the URL at
 * the first `&`, so an OAuth authorize URL loses redirect_uri / code_challenge /
 * state and the provider rejects the request ("authorization error"). Wrapping
 * the URL in double quotes makes cmd treat it as one literal token; passing the
 * args verbatim (`windowsVerbatimArguments`) stops Node from re-quoting and
 * undoing that. The empty `""` is the required `start` window-title placeholder.
 */
export function browserOpenCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): { cmd: string; args: string[]; verbatim?: boolean } {
  if (platform === 'darwin') return { cmd: 'open', args: [url] };
  if (platform === 'win32') {
    return {
      cmd: process.env.ComSpec || 'cmd.exe',
      args: ['/c', 'start', '""', `"${url}"`],
      verbatim: true,
    };
  }
  // Linux + everything else assumes a Freedesktop-compliant `xdg-open`.
  return { cmd: 'xdg-open', args: [url] };
}
