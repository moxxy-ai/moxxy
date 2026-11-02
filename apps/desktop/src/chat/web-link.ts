import { api } from '@moxxy/client-core';

/**
 * Open a web link from the chat in the user's default browser. Never through
 * `target="_blank"`: the main window turns a new window on a sign-in host
 * (github.com, accounts.google.com, …) into an in-app sign-in popup, and the
 * mini chat refuses new windows, so the link did nothing there. The host
 * checks the address is http(s) before handing it to the system.
 */
export async function openWebLink(url: string): Promise<void> {
  await api().invoke('onboarding.openExternal', { url });
}
