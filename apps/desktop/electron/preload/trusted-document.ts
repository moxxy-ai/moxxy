/** Restrict preload capabilities to the document selected by the main process. */
export function isAppDocument(target: string | undefined, href: string): boolean {
  if (!target) return false;
  try {
    const app = new URL(target);
    const page = new URL(href);
    if (app.protocol === 'file:') return page.protocol === 'file:' && page.host === app.host && page.pathname === app.pathname;
    return ['https:', 'http:'].includes(app.protocol) && page.protocol === app.protocol && page.origin === app.origin;
  } catch { return false; }
}
