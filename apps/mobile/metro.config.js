// Metro, made monorepo-aware so it resolves the shared `@moxxy/*` packages out
// of the pnpm workspace. SDK 54's `expo/metro-config` already follows symlinks
// and detects monorepos, so we only *extend* its defaults: watch the repo root,
// also search the hoisted node_modules, and force a single copy of React. The
// shared packages are consumed as their built `dist` (their `exports` map
// points there), so their `.js`-authored relative specifiers resolve under
// Metro exactly as under Node ESM.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [...new Set([...config.watchFolders, workspaceRoot])];
config.resolver.nodeModulesPaths = [
  ...new Set([
    ...(config.resolver.nodeModulesPaths ?? []),
    path.resolve(projectRoot, 'node_modules'),
    path.resolve(workspaceRoot, 'node_modules'),
  ]),
];

// The workspace packages keep their own (older) React in node_modules for
// their vitest suites; under pnpm Metro would resolve `react` from there and
// bundle two Reacts, breaking hooks. Pin react/react-dom to the app's copy.
const singletons = ['react', 'react-dom'];
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolveRequest ?? context.resolveRequest;
  if (singletons.some((s) => moduleName === s || moduleName.startsWith(`${s}/`))) {
    return resolve(
      { ...context, originModulePath: path.join(projectRoot, 'index.js') },
      moduleName,
      platform,
    );
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
