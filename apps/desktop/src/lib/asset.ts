/**
 * Resolve a `public/` asset URL that works in BOTH the dev server and the
 * packaged `file://` build.
 *
 * Vite serves `public/` at the dev-server root (`/avatar.gif`) but in a
 * production build the renderer is loaded from `file://…/dist/index.html`
 * with a relative base (`./`). A hard-coded absolute `"/avatar.gif"` in JSX
 * is a string literal Vite never rewrites, so under `file://` it resolves to
 * the filesystem root and 404s — that's the broken logos/avatars in the
 * packaged app. Prefixing `import.meta.env.BASE_URL` (`/` in dev, `./` in the
 * package) makes it resolve relative to the document in both.
 */
export function asset(name: string): string {
  return `${import.meta.env.BASE_URL}${name.replace(/^\/+/, '')}`;
}
