const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the repo root so Metro can follow this app's workspace deps (and their
// transitive `@moxxy/*` deps, e.g. `@moxxy/e2e`, which are symlinked under
// `node_modules` but live elsewhere in the tree). The root is broad, so the
// blockList below keeps Metro from crawling the parts that aren't in this app's
// module graph — rather than a narrower `watchFolders` that would break that
// transitive resolution.
config.watchFolders = [...new Set([...(config.watchFolders ?? []), workspaceRoot])];
config.resolver.nodeModulesPaths = [
  ...new Set([
    ...(config.resolver.nodeModulesPaths ?? []),
    path.resolve(projectRoot, 'node_modules'),
    path.resolve(workspaceRoot, 'node_modules'),
  ]),
];

// Shrink the crawl: exclude trees under the repo root that are not part of
// apps/mobile's module graph. The big wins are `.git` and the multi-GB
// `.claude/worktrees`, plus the other monorepo apps (desktop/docs/…). We do NOT
// block `packages/*` — the shared `@moxxy/*` packages are consumed from their
// built `dist`, which must stay resolvable.
const blockedTrees = [
  /[\\/]\.git[\\/].*/,
  /[\\/]\.claude[\\/].*/,
  // Any app other than this one (the negative lookahead keeps `apps/mobile`).
  /[\\/]apps[\\/](?!mobile[\\/])[^\\/]+[\\/].*/,
];
const existingBlock = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(existingBlock) ? existingBlock : existingBlock ? [existingBlock] : []),
  ...blockedTrees,
];

const singletons = ['react', 'react-dom'];
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolveRequest ?? context.resolveRequest;
  if (singletons.some((s) => moduleName === s || moduleName.startsWith(`${s}/`))) {
    return resolve(
      { ...context, originModulePath: path.join(projectRoot, 'index.ts') },
      moduleName,
      platform,
    );
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
