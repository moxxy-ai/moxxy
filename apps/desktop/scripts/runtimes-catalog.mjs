/**
 * The runtimes the desktop installer carries, pinned by sha256: we ship and
 * run these, so the versions are part of the app's supply chain. Node is the
 * official build from nodejs.org (the version `@moxxy/desktop-host` would
 * otherwise download); Python is the relocatable build of
 * astral-sh/python-build-standalone. Bump deliberately, with the checksums
 * from the release's own checksum list.
 */
export const NODE_VERSION = 'v22.12.0';
export const PYTHON_VERSION = '3.12.15';
const PYTHON_RELEASE = '20261001';

const node = (file, sha256) => ({ file, sha256, url: `https://nodejs.org/dist/${NODE_VERSION}/${file}` });
const python = (triple, sha256) => {
  const file = `cpython-${PYTHON_VERSION}+${PYTHON_RELEASE}-${triple}-install_only_stripped.tar.gz`;
  return { file, sha256, url: `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_RELEASE}/${encodeURIComponent(file)}` };
};

/** Keyed by `<platform>-<arch>`, the folder name under `resources/runtimes-seed`. */
export const RUNTIME_TARGETS = {
  'darwin-arm64': {
    node: node(`node-${NODE_VERSION}-darwin-arm64.tar.gz`, '293dcc6c2408da21562d135b0412525e381bb6fe150d688edb58fe850d0f3e13'),
    python: python('aarch64-apple-darwin', '10cab8f6ed6202fdd81637aa6eda4af8d5b7eaa8fc42f9df3c6bea4923de0d93'),
  },
  'darwin-x64': {
    node: node(`node-${NODE_VERSION}-darwin-x64.tar.gz`, '52bc25dd026db7247c3c00439afdb83e95087248267f02d6c1a7250d1f896173'),
    python: python('x86_64-apple-darwin', 'd101ac54bc34afff54741406261325dc896b7b646a36a58fff4845ef0a00b2ce'),
  },
  'win32-x64': {
    node: node(`node-${NODE_VERSION}-win-x64.zip`, '2b8f2256382f97ad51e29ff71f702961af466c4616393f767455501e6aece9b8'),
    python: python('x86_64-pc-windows-msvc', '52124cee54126f3f360eaa378288f6f64c402c983a3c14c95eff67f4af986aaa'),
  },
  'linux-x64': {
    node: node(`node-${NODE_VERSION}-linux-x64.tar.xz`, '22982235e1b71fa8850f82edd09cdae7e3f32df1764a9ec298c72d25ef2c164f'),
    python: python('x86_64-unknown-linux-gnu', '7bb1659e3235077b7f63d5b6eb6ce653c6fcd6c5041e9d5f73b42ce10421464d'),
  },
  'linux-arm64': {
    node: node(`node-${NODE_VERSION}-linux-arm64.tar.xz`, '8cfd5a8b9afae5a2e0bd86b0148ca31d2589c0ea669c2d0b11c132e35d90ed68'),
    python: python('aarch64-unknown-linux-gnu', '0b35f4dc08d58534eb82e024989e2db9873885dccd4f2a316ff55c0cec146123'),
  },
};

/** The targets one installer carries: a macOS app is universal, the others are built per architecture. */
export function runtimeTargets(platform = process.platform, arch = process.arch) {
  const names = platform === 'darwin' ? ['darwin-arm64', 'darwin-x64'] : [`${platform}-${arch}`];
  return names.filter((name) => name in RUNTIME_TARGETS);
}

/** What every bundled Python must be able to import; checked when the seed is built and after an install. */
export const PYTHON_IMPORTS = ['requests', 'numpy', 'pandas', 'matplotlib', 'openpyxl', 'docx', 'pypdf', 'PIL', 'bs4', 'lxml', 'yaml'];
