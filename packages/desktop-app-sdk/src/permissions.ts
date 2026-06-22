/**
 * The capability model for desktop mini-apps.
 *
 * A sandboxed app (a web bundle loaded in a cross-origin iframe from
 * `moxxy-app://`) can reach NOTHING by default — it has no Node, no IPC, no
 * filesystem. Every host service it wants must be (a) declared in its
 * `moxxy-app.json` `permissions` and (b) actually requested by the user/host at
 * install time. The host bridge refuses any bridge call whose backing permission
 * the app didn't declare, so the manifest is the complete, auditable list of
 * what an app can do.
 *
 * Keep this list SMALL and purpose-specific (capability per task, not "fs
 * access"): each permission maps to one confined host service, never a generic
 * primitive a malicious app could turn into arbitrary file/network access.
 */

/** Every capability a mini-app may declare. Closed set — the host only honours
 *  these strings; an unknown permission in a manifest is rejected. */
export const APP_PERMISSIONS = [
  /** Open a document through the native picker and receive its EXTRACTED TEXT
   *  (PDF/Office/ODF/text, parsed in the main process). The app never sees a
   *  path and cannot read arbitrary files — only what the user explicitly picks. */
  'documents.open',
  /** Save app-produced text/bytes to a user-chosen location via the native Save
   *  dialog. The app names a default; main writes ONLY where the user points. */
  'documents.save',
  /** Run the on-device `@moxxy/anonymizer` engine (pure, offline PII detection +
   *  redaction) as a host service. No network, no model — structured detectors
   *  only. (On-device NER needs no permission: an app runs its own model from
   *  its own installed assets, fetched same-origin inside its sandbox.) */
  'anonymizer.engine',
  /** Push a payload into the user's ACTIVE chat composer (review-in-composer):
   *  the text is prefilled into the composer and the chat view is shown; the
   *  user reviews/edits it and presses Send. The app cannot make the agent act
   *  on its own — nothing reaches the model without the user pressing Send. */
  'session.send',
] as const;

export type AppPermission = (typeof APP_PERMISSIONS)[number];

const PERMISSION_SET: ReadonlySet<string> = new Set(APP_PERMISSIONS);

export function isAppPermission(value: unknown): value is AppPermission {
  return typeof value === 'string' && PERMISSION_SET.has(value);
}

/** Human-readable summary of each permission, shown in the install consent UI so
 *  the user sees exactly what an app is asking for before they install it. */
export const PERMISSION_LABELS: Readonly<Record<AppPermission, string>> = {
  'documents.open': 'Open documents you choose (reads only what you pick)',
  'documents.save': 'Save its output to a location you choose',
  'anonymizer.engine': 'Detect & redact personal data on your device (offline)',
  'session.send': 'Send text into your active chat (you review it before sending)',
};
