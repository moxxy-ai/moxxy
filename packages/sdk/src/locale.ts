/**
 * A process started from the Dock or Finder gets no `LANG`, so every command
 * the agent runs falls back to the legacy encoding: `pbcopy` then reads UTF-8
 * as Mac Central European and "pamięć" lands in the clipboard as "pamińôńá".
 * Returns the variables to add so child processes read and write UTF-8; only
 * the character type is set, so messages keep the user's language.
 */
export function utf8Locale(
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
): Record<string, string> {
  if (platform === 'win32') return {};
  const effective = env['LC_ALL'] || env['LC_CTYPE'] || env['LANG'] || '';
  if (effective !== '' && effective !== 'C' && effective !== 'POSIX') return {};
  return { LC_CTYPE: platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8' };
}
