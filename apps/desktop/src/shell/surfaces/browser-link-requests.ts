/**
 * Addresses a chat link asked to open in the Moxxy browser, waiting for the
 * browser pane. The pane mounts only once the workbench shows it, which is
 * after the request arrives, so the address waits here until the pane takes
 * it. Two chats with a workbench can be open at once (a workspace and a
 * channel bot); main stamps every request, so one click opens one tab.
 */

const pending: string[] = [];
const seen = new Set<string>();
const listeners = new Set<() => void>();

export function askBrowserFor(request: { readonly requestId: string; readonly url: string }): void {
  if (seen.has(request.requestId)) return;
  seen.add(request.requestId);
  pending.push(request.url);
  for (const listener of listeners) listener();
}

/** Whether an address is waiting, without taking it: the pane starts at it then, not at the home page. */
export function hasBrowserRequests(): boolean {
  return pending.length > 0;
}

/** Every waiting address, once. */
export function takeBrowserRequests(): string[] {
  return pending.splice(0);
}

/** Called each time an address starts waiting; returns the way to stop. */
export function onBrowserRequest(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
