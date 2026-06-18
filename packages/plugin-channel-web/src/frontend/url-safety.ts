/**
 * Render-time URL-scheme allow-list for agent-authored `href`/`src` values.
 *
 * VERBATIM COPY of `isSafeViewUrl` in `packages/sdk/src/view-renderer.ts` —
 * the canonical check the parser (`parseView`) and `validateDoc` enforce.
 * The browser bundle is built standalone (esbuild, platform: browser, see
 * `scripts/build-web.mjs`) and cannot import the sdk root, which drags in
 * node builtins — so the check is duplicated here. KEEP THE TWO IN LOCKSTEP.
 *
 * Decision (audit A44): allowed schemes are `https:`, `http:`, `mailto:`,
 * `tel:`, plus relative/fragment URLs; `data:` only as an `img src` and only
 * `data:image/*`. Everything else — notably `javascript:`, `vbscript:`,
 * `data:text/*` — is rejected. Views are shared with third parties, so a
 * `javascript:` link is click-XSS; this is the second wall in case an AST
 * ever reaches the renderer without passing the parser.
 */
export function isSafeViewUrl(url: string, attr: string): boolean {
  // Make the SAFETY DECISION on the form the browser actually resolves: the
  // HTML5 URL parser strips ALL ASCII whitespace and C0 control chars (tab,
  // newline, CR, …) from anywhere in a URL before resolving the scheme, so
  // `java\tscript:` resolves to `javascript:` on click. Collapse every
  // U+0000–U+0020 char (all ASCII whitespace + C0 controls, which also covers
  // the leading/trailing space the old `trim()` handled) before checking;
  // removing these from a genuinely-safe http/https/mailto/relative URL still
  // resolves to the same scheme, so valid links keep working. The RAW `url` is
  // still what render.tsx blocks or emits — only this gate sees the collapsed
  // form. Keep in lockstep with `packages/sdk/src/view-renderer.ts`.
  const u = url.replace(/[\u0000-\u0020]/g, '').toLowerCase();
  if (u.startsWith('javascript:') || u.startsWith('vbscript:')) return false;
  if (u.startsWith('data:')) return attr === 'src' && u.startsWith('data:image/');
  if (/^[a-z][a-z0-9+.-]*:/.test(u)) return /^(https?:|mailto:|tel:)/.test(u);
  return true; // relative / fragment
}
