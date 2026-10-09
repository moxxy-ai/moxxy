/** Must equal `package.json#build.appId`: the installer writes it on the app's
 *  shortcut, and Windows shows a toast only for a process that names the same id. */
export const WINDOWS_APP_ID = 'ai.moxxy.desktop';

/** Gives the process its Windows identity, so system notifications reach the screen. */
export function nameAppForWindows(
  app: { setAppUserModelId(id: string): void },
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform === 'win32') app.setAppUserModelId(WINDOWS_APP_ID);
}
