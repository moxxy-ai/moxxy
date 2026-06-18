// ---------- Deep links (moxxy:// URLs) -------------------------------------

/** Parsed components of an opened `moxxy://` URL. `host` is the first
 *  authority segment (the "action", e.g. `open` in `moxxy://open/...`),
 *  `path` the remainder of the path, and `params` the decoded query string.
 *  General-purpose transport: notification clicks + action deep-links route
 *  through this in the renderer's DeepLinkBridge. */
export interface DeepLinkPayload {
  readonly url: string;
  readonly host: string;
  readonly path: string;
  readonly params: Record<string, string>;
}
