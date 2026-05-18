import { spawn } from 'node:child_process';

/**
 * Open a URL in the user's default browser. Platform-specific:
 *   macOS  → `open <url>`
 *   Linux  → `xdg-open <url>`
 *   Win32  → `cmd /c start "" <url>` (the empty quoted title is required
 *           so URLs starting with `"` don't confuse `start`)
 *
 * Returns once the helper process is spawned — it does NOT wait for the
 * browser itself, since the user's flow continues asynchronously via
 * the OAuth callback. Failures fall back to returning the URL string
 * so the caller can print it for the user to paste manually.
 */
export async function openInBrowser(url: string): Promise<void> {
  const { cmd, args } = chooseOpener(url);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.once('error', reject);
    // `unref` so a misbehaving opener process can't keep the moxxy
    // process alive past its own lifetime.
    child.unref();
    // Resolve after spawn — we never want to wait for the browser to
    // close. A 50ms tick is enough to surface spawn-time errors.
    setTimeout(resolve, 50);
  });
}

function chooseOpener(url: string): { cmd: string; args: string[] } {
  if (process.platform === 'darwin') return { cmd: 'open', args: [url] };
  if (process.platform === 'win32') return { cmd: 'cmd', args: ['/c', 'start', '""', url] };
  // Linux + everything else assumes a Freedesktop-compliant `xdg-open`.
  return { cmd: 'xdg-open', args: [url] };
}
