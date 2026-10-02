/**
 * The runtimes the desktop installer carries, pinned by sha256: we ship and
 * run these, so the versions are part of the app's supply chain. Node is the
 * official build from nodejs.org (the version `@moxxy/desktop-host` would
 * otherwise download); Python is the relocatable build of
 * astral-sh/python-build-standalone. Git has no binaries from the Git project
 * itself, which publishes source only: Windows gets MinGit of Git for Windows
 * (the build git-scm.com offers), macOS and Linux get the build GitHub makes
 * for GitHub Desktop (desktop/dugite-native). Bump deliberately, with the
 * checksums from the release's own checksum list.
 */
export const NODE_VERSION = 'v22.12.0';
export const PYTHON_VERSION = '3.12.15';
const PYTHON_RELEASE = '20261001';
const GIT_VERSION = '2.53.0';
const GIT_BUILD = { tag: 'v2.53.0-4', commit: '4098283' };
const GIT_WINDOWS_VERSION = '2.56.0';

/** The Git version an installer for this target carries. */
export const gitVersion = (target) => (target.startsWith('win32') ? GIT_WINDOWS_VERSION : GIT_VERSION);

const node = (file, sha256) => ({ file, sha256, url: `https://nodejs.org/dist/${NODE_VERSION}/${file}` });
const python = (triple, sha256) => {
  const file = `cpython-${PYTHON_VERSION}+${PYTHON_RELEASE}-${triple}-install_only_stripped.tar.gz`;
  return { file, sha256, url: `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_RELEASE}/${encodeURIComponent(file)}` };
};
const git = (name, sha256) => {
  const file = `dugite-native-v${GIT_VERSION}-${GIT_BUILD.commit}-${name}.tar.gz`;
  return { file, sha256, url: `https://github.com/desktop/dugite-native/releases/download/${GIT_BUILD.tag}/${file}` };
};
const gitForWindows = (sha256) => {
  const file = `MinGit-${GIT_WINDOWS_VERSION}-64-bit.zip`;
  return { file, sha256, url: `https://github.com/git-for-windows/git/releases/download/v${GIT_WINDOWS_VERSION}.windows.1/${file}` };
};

/** Keyed by `<platform>-<arch>`, the folder name under `resources/runtimes-seed`. */
export const RUNTIME_TARGETS = {
  'darwin-arm64': {
    node: node(`node-${NODE_VERSION}-darwin-arm64.tar.gz`, '293dcc6c2408da21562d135b0412525e381bb6fe150d688edb58fe850d0f3e13'),
    python: python('aarch64-apple-darwin', '10cab8f6ed6202fdd81637aa6eda4af8d5b7eaa8fc42f9df3c6bea4923de0d93'),
    git: git('macOS-arm64', 'f9dc64635a5b62fbd7ad95db73268bbb8912255ac516d65d37bf7af22fcb8ffe'),
  },
  'darwin-x64': {
    node: node(`node-${NODE_VERSION}-darwin-x64.tar.gz`, '52bc25dd026db7247c3c00439afdb83e95087248267f02d6c1a7250d1f896173'),
    python: python('x86_64-apple-darwin', 'd101ac54bc34afff54741406261325dc896b7b646a36a58fff4845ef0a00b2ce'),
    git: git('macOS-x64', 'ae6686718aa34f4140424db16b92a47dcffd6d1f312eb8b5f3b267f7404e2680'),
  },
  'win32-x64': {
    node: node(`node-${NODE_VERSION}-win-x64.zip`, '2b8f2256382f97ad51e29ff71f702961af466c4616393f767455501e6aece9b8'),
    python: python('x86_64-pc-windows-msvc', '52124cee54126f3f360eaa378288f6f64c402c983a3c14c95eff67f4af986aaa'),
    git: gitForWindows('064b440ff870ed5198527e8f3a92cdf5bd2fd0fedf5e718af95e3fdaddeff718'),
  },
  'linux-x64': {
    node: node(`node-${NODE_VERSION}-linux-x64.tar.xz`, '22982235e1b71fa8850f82edd09cdae7e3f32df1764a9ec298c72d25ef2c164f'),
    python: python('x86_64-unknown-linux-gnu', '7bb1659e3235077b7f63d5b6eb6ce653c6fcd6c5041e9d5f73b42ce10421464d'),
    git: git('ubuntu-x64', 'cca76aa31ad9e835e771ee7f55b73934777fbd8d16757a10d307ba06de860901'),
  },
  'linux-arm64': {
    node: node(`node-${NODE_VERSION}-linux-arm64.tar.xz`, '8cfd5a8b9afae5a2e0bd86b0148ca31d2589c0ea669c2d0b11c132e35d90ed68'),
    python: python('aarch64-unknown-linux-gnu', '0b35f4dc08d58534eb82e024989e2db9873885dccd4f2a316ff55c0cec146123'),
    git: git('ubuntu-arm64', 'a161f45af4626bb7e0c688854bd4a9aee47cc514bca404cff0a5e3536ef1c0af'),
  },
};

/** The targets one installer carries: a macOS app is universal, the others are built per architecture. */
export function runtimeTargets(platform = process.platform, arch = process.arch) {
  const names = platform === 'darwin' ? ['darwin-arm64', 'darwin-x64'] : [`${platform}-${arch}`];
  return names.filter((name) => name in RUNTIME_TARGETS);
}

/** What every bundled Python must be able to import; checked when the seed is built and after an install. */
export const PYTHON_IMPORTS = ['requests', 'numpy', 'pandas', 'matplotlib', 'openpyxl', 'docx', 'pypdf', 'PIL', 'bs4', 'lxml', 'yaml'];
