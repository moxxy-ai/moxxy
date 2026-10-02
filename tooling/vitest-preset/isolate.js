import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

// Runs before every test file. Tests exercise code that reads and writes
// ~/.moxxy and the OS keychain; without this they would do it to the
// developer's real ones. HOME is what POSIX resolves the home from and
// USERPROFILE what Windows does, so both move.
const realHome = homedir();
const home = mkdtempSync(join(tmpdir(), 'moxxy-test-home-'));

// npm keeps its cache under the home on POSIX; leave it where it is so tests
// that install a package do not start from an empty cache.
if (process.platform !== 'win32') process.env.npm_config_cache ??= join(realHome, '.npm');

process.env.HOME = home;
process.env.USERPROFILE = home;
delete process.env.MOXXY_HOME;
process.env.MOXXY_NO_KEYCHAIN = '1';

process.on('exit', () => rmSync(home, { recursive: true, force: true }));
