/**
 * Helpers for knowing which window the React tree is running in.
 *
 * The main window loads at `/`; parallel-session windows are spawned by
 * the Rust `open_session_window` command with `?window=session-<uuid>`
 * so every Tauri event/command can carry its window label without a
 * separate roundtrip.
 *
 * Falls back to `"main"` when no query param is present — robust under
 * tests + during dev.
 */
export function currentWindowLabel(): string {
  if (typeof window === 'undefined') return 'main';
  try {
    const params = new URLSearchParams(window.location.search);
    const label = params.get('window');
    return label && label.length > 0 ? label : 'main';
  } catch {
    return 'main';
  }
}

export function isMainWindow(): boolean {
  return currentWindowLabel() === 'main';
}
