// Metro, made monorepo-aware so it resolves the shared `@moxxy/*` packages out
// of the pnpm workspace. The three settings below are the standard pnpm + Metro
// recipe: watch the repo root, search both local and hoisted node_modules, and
// follow pnpm's symlinked store. The shared packages are consumed as their built
// `dist` (their `exports` map points there), so their `.js`-authored relative
// specifiers resolve under Metro exactly as under Node ESM.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.unstable_enableSymlinks = true;
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
