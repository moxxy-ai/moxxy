// ---------- Desktop "apps" gallery: install lifecycle + anonymizer ----------
//
// Desktop apps are self-contained mini-applications shown in the Apps gallery.
// Some need local assets before first use (the document anonymizer downloads an
// on-device NER model). That fetch is the ONLY time the network is touched, it
// runs in the MAIN process, and it's gated behind an explicit "Install" click —
// at use time everything is local, so the app's offline guarantee holds.

/** Lifecycle of an installable app's local assets. */
export type AppInstallState = 'not-installed' | 'installing' | 'installed' | 'error';

export interface AppInstallStatus {
  readonly appId: string;
  readonly state: AppInstallState;
  /** Version marker of the installed assets (from the app's `installed.json`). */
  readonly version?: string;
  /** Set when `state === 'error'`. */
  readonly error?: string;
  /** Best-effort progress, present while `state === 'installing'`. */
  readonly receivedBytes?: number;
  readonly totalBytes?: number;
}

/** Streamed during `apps.install` so the gallery can show a progress bar. */
export interface AppInstallProgress {
  readonly appId: string;
  readonly phase: 'downloading' | 'verifying' | 'done' | 'error';
  readonly receivedBytes: number;
  readonly totalBytes: number;
  /** The file currently downloading (relative path), when known. */
  readonly file?: string;
  readonly error?: string;
}

/** Result of parsing a picked/workspace document to plain text. A discriminated
 *  union so a parse failure is data, not a thrown IPC error. */
export type AnonymizerParseResult = { readonly text: string } | { readonly error: string };
