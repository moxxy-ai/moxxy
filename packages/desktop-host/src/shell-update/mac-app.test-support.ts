/**
 * Test support: a small real macOS app, signed for real. Built with the tools
 * the installer itself runs (`codesign`, `ditto`), so nothing here stands in
 * for them.
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const infoPlist = (version: string, identifier: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>main</string>
  <key>CFBundleIdentifier</key><string>${identifier}</string>
  <key>CFBundleName</key><string>Tiny</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>${version}</string>
</dict>
</plist>
`;

/** An unsigned app whose program is a copy of `/usr/bin/true`, with Apple's
 *  own signature taken off it. */
export function makeTinyApp(at: string, options: { version: string; identifier?: string; note?: string }): void {
  const contents = path.join(at, 'Contents');
  mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
  mkdirSync(path.join(contents, 'Resources'), { recursive: true });
  writeFileSync(path.join(contents, 'Info.plist'), infoPlist(options.version, options.identifier ?? 'ai.moxxy.tiny'));
  const program = path.join(contents, 'MacOS', 'main');
  copyFileSync('/usr/bin/true', program);
  execFileSync('/usr/bin/codesign', ['--remove-signature', program], { stdio: 'pipe' });
  writeFileSync(path.join(contents, 'Resources', 'note.txt'), options.note ?? 'tiny');
}

/** Signs without an identity ("ad hoc"): valid, and tied to these exact bytes. */
export function signAdHoc(app: string): void {
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', app], { stdio: 'pipe' });
}

/** A byte-for-byte copy, signature included. */
export function copyApp(from: string, to: string): void {
  mkdirSync(path.dirname(to), { recursive: true });
  execFileSync('/usr/bin/ditto', [from, to], { stdio: 'pipe' });
}

/** The archive a release carries: the app zipped with its folder, as electron-builder does. */
export function zipApp(app: string, archive: string): void {
  mkdirSync(path.dirname(archive), { recursive: true });
  execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, archive], { stdio: 'pipe' });
}
